import type {
  PairAlphaActionState,
  PairV2AlphaResult,
  PairV2Confidence,
  PairV2HistoricalSnapshot,
  PairV2RiskState,
  PairV2ScoringCandidate,
} from "./types.js";

export const PAIR_V2_ALPHA_MODEL_VERSION = "pair-v2-alpha-v2.0.0";
export const PAIR_ALPHA_MODEL_VERSION = "pair-alpha-v1.0.0";

interface Feature {
  value: number | null;
  weight: number;
  label: string;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function ratioChange(current: number | null, previous: number | null): number | null {
  if (
    current === null ||
    previous === null ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    previous <= 0
  ) {
    return null;
  }
  return clamp((current / previous - 1) * 100, -95, 500);
}

function snapshotChange(
  current: number | null,
  snapshot: PairV2HistoricalSnapshot | null | undefined,
  read: (value: PairV2HistoricalSnapshot) => number | null,
): number | null {
  return snapshot ? ratioChange(current, read(snapshot)) : null;
}

function usableSnapshot(
  snapshot: PairV2HistoricalSnapshot | null | undefined,
  now: Date,
  minimumAgeMinutes: number,
  maximumAgeMinutes: number,
): PairV2HistoricalSnapshot | null {
  if (!snapshot) return null;
  const observedMs = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(observedMs)) return null;
  const ageMinutes = (now.valueOf() - observedMs) / 60_000;
  return ageMinutes >= minimumAgeMinutes && ageMinutes <= maximumAgeMinutes ? snapshot : null;
}

function signedGrowthScore(changePercent: number | null, scale = 25): number | null {
  if (changePercent === null) return null;
  return clamp(50 + 50 * Math.tanh(changePercent / scale));
}

function liquidityHealth(liquidity: number | null, marketCap: number | null): number | null {
  if (liquidity === null || marketCap === null || marketCap <= 0) return null;
  const ratio = liquidity / marketCap;
  return clamp((Math.log10(1 + ratio * 100) / Math.log10(26)) * 100);
}

function weighted(features: Feature[]): {
  score: number | null;
  availableWeight: number;
  used: string[];
} {
  const available = features.filter(
    (feature): feature is Feature & { value: number } =>
      feature.value !== null && Number.isFinite(feature.value),
  );
  const availableWeight = available.reduce((sum, feature) => sum + feature.weight, 0);
  if (availableWeight === 0) return { score: null, availableWeight: 0, used: [] };
  return {
    score: round(
      available.reduce((sum, feature) => sum + clamp(feature.value) * feature.weight, 0) /
        availableWeight,
    ),
    availableWeight,
    used: available.map((feature) => feature.label),
  };
}

function profileCompleteness(candidate: PairV2ScoringCandidate): number {
  const profile = candidate.token.profile;
  let score = candidate.token.creator ? 20 : 0;
  if (profile?.descriptionPresent) score += 30;
  if (profile?.websiteUrl) score += 25;
  if (profile?.twitterUrl) score += 25;
  return score;
}

function pressureScore(buys: number | null, sells: number | null): number | null {
  if (buys === null || sells === null || buys + sells <= 0) return null;
  const balance = (buys - sells) / (buys + sells);
  return clamp(50 + 50 * Math.tanh(balance * 1.6));
}

function volumeAccelerationScore(volume5m: number | null, volume1h: number | null): number | null {
  if (volume5m === null || volume1h === null || volume1h <= 0) return null;
  const paceRatio = (volume5m * 12) / volume1h;
  return clamp(50 + 50 * Math.tanh((paceRatio - 1) / 1.5));
}

function priceHeatScore(changePercent: number | null): number | null {
  if (changePercent === null) return null;
  if (changePercent <= 5) return 0;
  return clamp(((changePercent - 5) / 25) * 100);
}

function confidenceLabel(value: number): PairV2Confidence {
  if (value >= 85) return "high";
  if (value >= 55) return "medium";
  return "low";
}

function maxRisk(left: PairV2RiskState, right: PairV2RiskState): PairV2RiskState {
  const order: PairV2RiskState[] = ["low", "medium", "high", "critical"];
  return order.indexOf(left) >= order.indexOf(right) ? left : right;
}

export function percentileRanks(values: Array<number | null>): Array<number | null> {
  const observed = values
    .flatMap((value, index) => (value !== null && Number.isFinite(value) ? [{ value, index }] : []))
    .sort((left, right) => left.value - right.value);
  const result = values.map(() => null as number | null);
  if (observed.length === 1) {
    const only = observed[0];
    if (only) result[only.index] = 50;
    return result;
  }
  for (let start = 0; start < observed.length; ) {
    let end = start + 1;
    while (end < observed.length && observed[end]?.value === observed[start]?.value) end += 1;
    const averageRank = (start + end - 1) / 2;
    const percentile = (averageRank / (observed.length - 1)) * 100;
    for (let index = start; index < end; index += 1) {
      const item = observed[index];
      if (item) result[item.index] = round(percentile);
    }
    start = end;
  }
  return result;
}

export function scorePairV2Candidate(candidate: PairV2ScoringCandidate): PairV2AlphaResult {
  const { token, launch, now } = candidate;
  const requireCurrentRelease = candidate.requireCurrentRelease ?? true;
  const identityEvidence =
    candidate.identityEvidence ?? (launch ? "current_release_event" : "unknown");
  const identityVerified =
    launch !== null || (!requireCurrentRelease && identityEvidence === "pair_official_api");
  const previous15m = usableSnapshot(candidate.previous15m ?? candidate.previous, now, 12, 45);
  const previous5m = usableSnapshot(candidate.previous5m, now, 4, 20);
  const short = token.shortWindow ?? null;
  const qualityReasons: string[] = [];
  const qualityMissing: string[] = [];
  const signalReasons: string[] = [];
  const signalMissing: string[] = [];
  const heatReasons: string[] = [];
  const platformReasons: string[] = [];
  const tokenReasons: string[] = [];
  const evidenceAvailable: string[] = [];
  const evidenceMissing: string[] = [];

  const marketAgeMinutes = token.marketDataUpdatedAt
    ? (now.valueOf() - Date.parse(token.marketDataUpdatedAt)) / 60_000
    : Number.POSITIVE_INFINITY;
  const marketFresh =
    Number.isFinite(marketAgeMinutes) && marketAgeMinutes >= -5 && marketAgeMinutes <= 10;
  const marketCapChange5m = snapshotChange(
    token.marketCapUsd,
    previous5m,
    (value) => value.marketCapUsd,
  );
  const marketCapChange15m = snapshotChange(
    token.marketCapUsd,
    previous15m,
    (value) => value.marketCapUsd,
  );
  const holderChange15m = snapshotChange(
    token.holderCount,
    previous15m,
    (value) => value.holderCount,
  );
  const liquidityChange15m = snapshotChange(
    token.liquidityUsd,
    previous15m,
    (value) => value.liquidityUsd,
  );
  const liquidityScore = liquidityHealth(token.liquidityUsd, token.marketCapUsd);
  const liquidityRatio =
    token.liquidityUsd !== null && token.marketCapUsd !== null && token.marketCapUsd > 0
      ? token.liquidityUsd / token.marketCapUsd
      : null;
  const profileScore = profileCompleteness(candidate);
  const buyPressure5m = pressureScore(short?.buys5m ?? null, short?.sells5m ?? null);
  const buyPressure1h = pressureScore(short?.buys1h ?? null, short?.sells1h ?? null);

  const adoption = weighted([
    { value: candidate.holderPercentile ?? null, weight: 0.45, label: "同龄持有人广度" },
    { value: signedGrowthScore(holderChange15m, 20), weight: 0.3, label: "持有人增长" },
    { value: candidate.buyActivityPercentile ?? null, weight: 0.25, label: "交易采用代理" },
  ]);
  const quality = weighted([
    { value: liquidityScore, weight: 0.45, label: "可执行流动性" },
    { value: adoption.score, weight: 0.35, label: "采用广度" },
    { value: profileScore, weight: 0.2, label: "资料可核验度" },
  ]);

  if (profileScore >= 80) qualityReasons.push("官网、项目社交与说明资料较完整");
  else qualityMissing.push("完整项目资料");
  if (liquidityScore === null) qualityMissing.push("可执行流动性");
  else if (liquidityRatio !== null && liquidityRatio >= 0.05) {
    qualityReasons.push("流动性相对市值具备基础承接");
  }
  if (adoption.score === null || adoption.availableWeight < 0.45) {
    qualityMissing.push("持有人或交易采用证据");
  } else if (adoption.score >= 60) {
    qualityReasons.push("持有人与交易采用位于同龄项目上游");
  }

  let platformRisk: PairV2RiskState = "low";
  if (candidate.unverifiedProductionGraph) {
    platformRisk = "high";
    platformReasons.push("生产合约图尚未完成源码与公开审计闭环");
  }

  let tokenRisk: PairV2RiskState = "low";
  if (!identityVerified) {
    tokenRisk = "critical";
    tokenReasons.push("未取得可接受的 PAIR 发行身份锚点");
  } else if (!launch) {
    tokenRisk = maxRisk(tokenRisk, "medium");
    tokenReasons.push("由 PAIR 官方目录确认，但尚未回填当前 release 链上事件");
  }
  if (token.hidden || token.flagged) {
    tokenRisk = "critical";
    tokenReasons.push("官方索引标记为隐藏或风险代币");
  }
  if (!marketFresh) {
    tokenRisk = maxRisk(tokenRisk, "high");
    tokenReasons.push("市场数据过期或缺失");
  }
  if (liquidityRatio === null) {
    tokenRisk = maxRisk(tokenRisk, "high");
    tokenReasons.push("流动性深度未知");
  } else if (liquidityRatio < 0.01) {
    tokenRisk = maxRisk(tokenRisk, "high");
    tokenReasons.push("流动性/市值低于 1%");
  } else if (liquidityRatio < 0.02) {
    tokenRisk = maxRisk(tokenRisk, "medium");
    tokenReasons.push("流动性/市值低于 2%");
  }
  if (
    short?.buys1h !== null &&
    short?.buys1h !== undefined &&
    short.sells1h !== null &&
    short.sells1h >= 4 &&
    short.sells1h >= short.buys1h * 2
  ) {
    tokenRisk = maxRisk(tokenRisk, "medium");
    tokenReasons.push("过去 1H 卖出笔数显著高于买入");
  }

  const hardRejected = !identityVerified || token.hidden || token.flagged;
  let qualityState: PairV2AlphaResult["quality"]["state"] = "unknown";
  if (hardRejected || (liquidityRatio !== null && liquidityRatio < 0.01)) {
    qualityState = "unqualified";
  } else if (
    liquidityScore !== null &&
    adoption.score !== null &&
    adoption.availableWeight >= 0.45 &&
    marketFresh
  ) {
    qualityState =
      (quality.score ?? 0) >= 60 && !["high", "critical"].includes(tokenRisk)
        ? "qualified"
        : "unqualified";
  }

  const attention = weighted([
    { value: candidate.volume5mPercentile ?? null, weight: 0.3, label: "5m 成交分位" },
    { value: candidate.volume1hPercentile ?? null, weight: 0.25, label: "1H 成交分位" },
    { value: candidate.turnoverPercentile, weight: 0.15, label: "1H 换手分位" },
    { value: candidate.buyActivityPercentile ?? null, weight: 0.15, label: "买入笔数分位" },
    { value: buyPressure1h, weight: 0.15, label: "1H 买卖笔数方向" },
  ]);
  const attentionScore = attention.availableWeight >= 0.45 ? attention.score : null;
  if (attentionScore === null) signalMissing.push("短周期成交与买卖方向");
  else if (attentionScore >= 70) signalReasons.push("短周期活跃度进入同龄项目上游");

  const acceleration = volumeAccelerationScore(
    short?.volume5mUsd ?? null,
    short?.volume1hUsd ?? null,
  );
  const timing = weighted([
    { value: signedGrowthScore(marketCapChange15m, 18), weight: 0.3, label: "15m 市值动量" },
    {
      value: buyPressure5m ?? buyPressure1h,
      weight: 0.25,
      label: buyPressure5m === null ? "1H 买卖方向" : "5m 买卖方向",
    },
    { value: signedGrowthScore(holderChange15m, 15), weight: 0.2, label: "15m 持有人增长" },
    { value: signedGrowthScore(liquidityChange15m, 12), weight: 0.15, label: "15m 流动性变化" },
    { value: acceleration, weight: 0.1, label: "5m 成交加速度" },
  ]);
  const signalScore = timing.availableWeight >= 0.5 ? timing.score : null;
  if (marketCapChange15m === null) signalMissing.push("15m 市值基线");
  if (buyPressure5m === null && buyPressure1h === null) signalMissing.push("短周期买卖笔数");
  if (holderChange15m === null) signalMissing.push("15m 持有人基线");
  if (liquidityChange15m === null) signalMissing.push("15m 流动性基线");
  if (signalScore !== null && signalScore >= 58) signalReasons.push("量价与采用证据正在形成承接");
  if (buyPressure5m !== null && buyPressure5m >= 60) signalReasons.push("最近 5m 买入笔数占优");
  if (holderChange15m !== null && holderChange15m > 0) signalReasons.push("持有人数量继续增长");

  const shortPriceHeat = Math.max(
    priceHeatScore(short?.priceChange1hPct ?? null) ?? 0,
    priceHeatScore(
      short?.priceChange5mPct === null || short?.priceChange5mPct === undefined
        ? null
        : short.priceChange5mPct * 3,
    ) ?? 0,
  );
  const heat = weighted([
    { value: shortPriceHeat, weight: 0.35, label: "5m/1H 涨幅" },
    { value: candidate.volume5mPercentile ?? null, weight: 0.25, label: "5m 成交拥挤" },
    { value: candidate.turnoverPercentile, weight: 0.2, label: "1H 换手拥挤" },
    {
      value: liquidityScore === null ? null : clamp(100 - liquidityScore),
      weight: 0.2,
      label: "薄流动性压力",
    },
  ]);
  const heatScore = heat.score ?? 0;
  const heatState: PairV2AlphaResult["heat"]["state"] =
    heatScore >= 80 ? "overheated" : heatScore >= 60 ? "hot" : "normal";
  if (heatState === "overheated") heatReasons.push("价格与成交拥挤已进入过热区");
  else if (heatState === "hot") heatReasons.push("短周期交易开始拥挤");
  if ((short?.priceChange1hPct ?? 0) >= 30) heatReasons.push("过去 1H 涨幅超过 30%");

  if (launch) evidenceAvailable.push("当前 release 发行事件");
  else if (identityEvidence === "pair_official_api") {
    evidenceAvailable.push("PAIR 官方目录身份");
    evidenceMissing.push("当前 release 发行事件");
  } else {
    evidenceMissing.push("PAIR 发行身份锚点");
  }
  if (marketFresh) evidenceAvailable.push("新鲜市场价格与市值");
  else evidenceMissing.push("新鲜市场价格与市值");
  if (token.pools.some((pool) => pool.poolId)) evidenceAvailable.push("官方 poolId");
  else evidenceMissing.push("官方 poolId");
  if (short) evidenceAvailable.push("5m/1H 官方池行情");
  else evidenceMissing.push("5m/1H 官方池行情");
  if (token.liquidityUsd !== null) evidenceAvailable.push("流动性深度");
  else evidenceMissing.push("流动性深度");
  if (token.holderCount !== null) evidenceAvailable.push("持有人数量");
  else evidenceMissing.push("持有人数量");
  if (previous15m) evidenceAvailable.push("历史基线");
  else evidenceMissing.push("历史基线");

  let completeness = 0;
  if (launch) completeness += 20;
  else if (identityEvidence === "pair_official_api") completeness += 15;
  if (marketFresh) completeness += 15;
  if (token.pools.some((pool) => pool.poolId)) completeness += 15;
  if (short) completeness += 20;
  if (token.liquidityUsd !== null) completeness += 15;
  if (token.holderCount !== null) completeness += 10;
  if (previous15m) completeness += 5;
  if (!short || token.liquidityUsd === null) completeness = Math.min(completeness, 69);
  if (!identityVerified) completeness = Math.min(completeness, 40);
  else if (!launch) completeness = Math.min(completeness, 84);
  const confidence = confidenceLabel(completeness);

  const researchEligible =
    qualityState === "qualified" &&
    signalScore !== null &&
    signalScore >= 58 &&
    (attentionScore ?? 0) >= 65 &&
    heatState !== "overheated" &&
    tokenRisk !== "high" &&
    tokenRisk !== "critical";
  let signalState: PairV2AlphaResult["signal"]["state"] = "watch";
  if (hardRejected) signalState = "rejected";
  else if (
    researchEligible &&
    signalScore !== null &&
    signalScore >= 68 &&
    (buyPressure5m ?? 0) >= 55 &&
    (short?.volume5mUsd ?? 0) > 0 &&
    confidence === "high"
  ) {
    signalState = "confirmed";
  } else if (researchEligible) signalState = "forming";
  else if ((attentionScore ?? 0) >= 70) signalState = "attention";

  const transactionCount5m = (short?.buys5m ?? 0) + (short?.sells5m ?? 0);
  const explosiveMove =
    (short?.priceChange5mPct ?? 0) >= 25 ||
    (short?.priceChange1hPct ?? 0) >= 80 ||
    (short?.priceChange6hPct ?? 0) >= 80 ||
    (short?.priceChange24hPct ?? 0) >= 200;
  const ignitionEvidence =
    (attentionScore ?? 0) >= 70 ||
    ((short?.volume5mUsd ?? 0) >= 1_000 && transactionCount5m >= 8 && (acceleration ?? 0) >= 55);
  const retestEvidence =
    (short?.priceChange1hPct ?? 0) <= -15 &&
    (short?.volume5mUsd ?? 0) > 0 &&
    (buyPressure5m ?? 0) >= 55;
  let actionState: PairAlphaActionState = "cold_watch";
  const actionReasons: string[] = [];
  if (hardRejected || tokenRisk === "critical") {
    actionState = "risk_halt";
    actionReasons.push("身份或官方风险闸门未通过");
  } else if (heatState === "overheated" || explosiveMove) {
    actionState = "no_chase";
    actionReasons.push("短周期涨幅或拥挤度已越过追涨闸门");
  } else if (signalState === "confirmed") {
    actionState = "confirmed";
    actionReasons.push("质量、承接与时机证据同时通过");
  } else if (researchEligible) {
    actionState = "probe_eligible";
    actionReasons.push("满足研究候选门槛，仍需人工核验执行条件");
  } else if (retestEvidence) {
    actionState = "retest_watch";
    actionReasons.push("回撤后出现新的短周期买盘承接");
  } else if (ignitionEvidence) {
    actionState = "ignition_watch";
    actionReasons.push("成交速度或同龄分位出现点火信号");
  } else if (!marketFresh || !short || confidence === "low") {
    actionState = "evidence_wait";
    actionReasons.push("短周期行情或证据完整度不足");
  } else {
    actionReasons.push("已进入观察池，但尚未形成可研究的催化组合");
  }

  // Shadow decisions can be reviewed, but they are never trade-ready.
  const tradeReady = false;
  const allMissing = unique([...qualityMissing, ...signalMissing, ...evidenceMissing]);
  const allReasons = unique([...qualityReasons, ...signalReasons, ...heatReasons]);
  const allRisks = unique([...platformReasons, ...tokenReasons]);
  const displayedQualityScore = qualityState === "unknown" ? null : quality.score;

  return {
    modelVersion: PAIR_V2_ALPHA_MODEL_VERSION,
    modelStatus: "shadow",
    quality: {
      score: displayedQualityScore,
      state: qualityState,
      profileScore: round(profileScore),
      liquidityScore,
      adoptionScore: adoption.score,
      reasons: unique(qualityReasons),
      missing: unique(qualityMissing),
    },
    signal: {
      score: signalScore,
      state: signalState,
      researchEligible,
      reasons: unique(signalReasons),
      missing: unique(signalMissing),
    },
    heat: {
      score: round(heatScore),
      state: heatState,
      reasons: unique(heatReasons),
    },
    riskProfile: {
      platform: platformRisk,
      token: tokenRisk,
      tradeReady,
      platformReasons: unique(platformReasons),
      tokenReasons: unique(tokenReasons),
    },
    evidence: {
      confidence,
      completenessPercent: completeness,
      available: unique(evidenceAvailable),
      missing: unique(evidenceMissing),
    },
    action: {
      state: actionState,
      label: {
        risk_halt: "风险停止",
        no_chase: "过热勿追",
        confirmed: "信号确认",
        probe_eligible: "可研究试探",
        retest_watch: "回踩观察",
        ignition_watch: "点火观察",
        evidence_wait: "等待证据",
        cold_watch: "冷启动观察",
      }[actionState],
      informationalOnly: true,
      reasons: actionReasons,
    },
    metrics: {
      marketCapChange5mPct: marketCapChange5m,
      marketCapChange15mPct: marketCapChange15m,
      holderChange15mPct: holderChange15m,
      liquidityChange15mPct: liquidityChange15m,
      volume5mUsd: short?.volume5mUsd ?? null,
      volume1hUsd: short?.volume1hUsd ?? null,
      buys5m: short?.buys5m ?? null,
      sells5m: short?.sells5m ?? null,
      buys1h: short?.buys1h ?? null,
      sells1h: short?.sells1h ?? null,
      buyPressure5m,
      buyPressure1h,
      priceChange1hPct: short?.priceChange1hPct ?? null,
    },
    discoveryScore: attentionScore ?? 0,
    confirmationScore: signalScore,
    heatScore: round(heatScore),
    stage: signalState,
    risk: tokenRisk,
    confidence,
    confidenceScore: completeness,
    reasons: allReasons,
    risks: allRisks,
    missing: allMissing,
  };
}
