export const PAIR_PROTOCOL_TOKEN_ADDRESS = "0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be";

export type PairTokenMomentumSignalState = "cold" | "watch" | "active";
export type PairTokenMomentumQualityStatus =
  | "ok"
  | "stale"
  | "source_unavailable"
  | "insufficient_history"
  | "invalid_snapshot";

export interface PairTokenMomentumSnapshot {
  runId: number;
  observedAt: string;
  tokenAddress: string;
  priceUsd: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  liquidityDepthUsd: number | null;
  marketDataUpdatedAt: string | null;
  sourceStatus: "ok" | "degraded" | "failed";
}

export interface PairTokenMomentumSettings {
  enabled: boolean;
  priceOneHourThresholdPct: number;
  volumeOneHourThresholdPct: number;
  minimumVolumeDeltaUsd: number;
  consecutiveSamples: number;
  rearmSamples: number;
  freshnessMinutes: number;
}

export const DEFAULT_PAIR_TOKEN_MOMENTUM_SETTINGS: PairTokenMomentumSettings = {
  enabled: true,
  priceOneHourThresholdPct: 8,
  volumeOneHourThresholdPct: 20,
  minimumVolumeDeltaUsd: 25_000,
  consecutiveSamples: 2,
  rearmSamples: 4,
  freshnessMinutes: 30,
};

export interface PairTokenMomentumEvaluationSnapshot {
  qualityStatus: PairTokenMomentumQualityStatus;
  reason: string;
  observedAt: string | null;
  currentPriceUsd: number | null;
  currentVolume24hUsd: number | null;
  currentMarketCapUsd: number | null;
  currentLiquidityDepthUsd: number | null;
  referenceObservedAt: string | null;
  referencePriceUsd: number | null;
  referenceVolume24hUsd: number | null;
  priceOneHourChangePct: number | null;
  volumeOneHourChangePct: number | null;
  volumeDeltaUsd: number | null;
}

export interface PairTokenMomentumStateRecord extends PairTokenMomentumEvaluationSnapshot {
  state: PairTokenMomentumSignalState;
  candidateStreak: number;
  clearStreak: number;
  episodeStartedAt: string | null;
  lastEvaluatedAt: string | null;
  notifiedAt: string | null;
  updatedAt: string;
}

export interface PairTokenMomentumAlert {
  dedupeKey: string;
  observedAt: string;
  currentPriceUsd: number;
  currentVolume24hUsd: number;
  currentMarketCapUsd: number | null;
  currentLiquidityDepthUsd: number | null;
  referenceObservedAt: string;
  referencePriceUsd: number;
  referenceVolume24hUsd: number;
  priceOneHourChangePct: number;
  volumeOneHourChangePct: number;
  volumeDeltaUsd: number;
  triggerReason: string;
  createdAt: string;
}

export interface PairTokenMomentumPlan {
  status:
    | "baseline"
    | "cold"
    | "watch"
    | "active"
    | "sent_or_queued"
    | "data_unreliable"
    | "duplicate";
  nextState: PairTokenMomentumStateRecord;
  alert: PairTokenMomentumAlert | null;
}

interface SignalEvaluation extends PairTokenMomentumEvaluationSnapshot {
  candidate: boolean;
}

function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function emptyEvaluation(reason: string): PairTokenMomentumEvaluationSnapshot {
  return {
    qualityStatus: "insufficient_history",
    reason,
    observedAt: null,
    currentPriceUsd: null,
    currentVolume24hUsd: null,
    currentMarketCapUsd: null,
    currentLiquidityDepthUsd: null,
    referenceObservedAt: null,
    referencePriceUsd: null,
    referenceVolume24hUsd: null,
    priceOneHourChangePct: null,
    volumeOneHourChangePct: null,
    volumeDeltaUsd: null,
  };
}

export function initialPairTokenMomentumState(now: string): PairTokenMomentumStateRecord {
  return {
    state: "cold",
    candidateStreak: 0,
    clearStreak: 0,
    episodeStartedAt: null,
    lastEvaluatedAt: null,
    notifiedAt: null,
    updatedAt: now,
    ...emptyEvaluation("waiting_for_first_snapshot"),
  };
}

function closestOneHourReference(
  snapshots: PairTokenMomentumSnapshot[],
  index: number,
): PairTokenMomentumSnapshot | null {
  const current = snapshots[index];
  if (!current) return null;
  const currentAt = Date.parse(current.observedAt);
  let selected: PairTokenMomentumSnapshot | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = snapshots[cursor];
    if (!candidate) continue;
    const minutes = (currentAt - Date.parse(candidate.observedAt)) / 60_000;
    if (minutes > 90) break;
    if (minutes < 45) continue;
    const distance = Math.abs(minutes - 60);
    if (distance < selectedDistance) {
      selected = candidate;
      selectedDistance = distance;
    }
  }
  return selected;
}

function evaluateSignal(input: {
  snapshots: PairTokenMomentumSnapshot[];
  index: number;
  settings: PairTokenMomentumSettings;
  nowMs: number;
}): SignalEvaluation {
  const current = input.snapshots[input.index];
  const previous = input.snapshots[input.index - 1];
  const reference = closestOneHourReference(input.snapshots, input.index);
  const base: PairTokenMomentumEvaluationSnapshot = {
    qualityStatus: "insufficient_history",
    reason: "insufficient_snapshot_history",
    observedAt: current?.observedAt ?? null,
    currentPriceUsd: current?.priceUsd ?? null,
    currentVolume24hUsd: current?.volume24hUsd ?? null,
    currentMarketCapUsd: current?.marketCapUsd ?? null,
    currentLiquidityDepthUsd: current?.liquidityDepthUsd ?? null,
    referenceObservedAt: reference?.observedAt ?? null,
    referencePriceUsd: reference?.priceUsd ?? null,
    referenceVolume24hUsd: reference?.volume24hUsd ?? null,
    priceOneHourChangePct: null,
    volumeOneHourChangePct: null,
    volumeDeltaUsd: null,
  };

  if (!current || !previous || !reference) return { ...base, candidate: false };
  if (current.sourceStatus !== "ok") {
    return {
      ...base,
      qualityStatus: "source_unavailable",
      reason: "pair_official_token_source_unavailable",
      candidate: false,
    };
  }
  if (
    current.priceUsd === null ||
    current.volume24hUsd === null ||
    reference.priceUsd === null ||
    reference.volume24hUsd === null ||
    current.priceUsd <= 0 ||
    current.volume24hUsd <= 0 ||
    reference.priceUsd <= 0 ||
    reference.volume24hUsd <= 0
  ) {
    return {
      ...base,
      qualityStatus: "invalid_snapshot",
      reason: "pair_token_price_or_volume_missing",
      candidate: false,
    };
  }

  const currentAt = Date.parse(current.observedAt);
  const previousAt = Date.parse(previous.observedAt);
  const marketUpdatedAt = Date.parse(current.marketDataUpdatedAt ?? "");
  if (!Number.isFinite(currentAt) || !Number.isFinite(previousAt)) {
    return {
      ...base,
      qualityStatus: "invalid_snapshot",
      reason: "invalid_timestamp",
      candidate: false,
    };
  }
  const cadenceMinutes = (currentAt - previousAt) / 60_000;
  if (!Number.isFinite(cadenceMinutes) || cadenceMinutes < 5 || cadenceMinutes > 45) {
    return {
      ...base,
      qualityStatus: "insufficient_history",
      reason: "snapshot_cadence_gap",
      candidate: false,
    };
  }
  const freshnessMs = input.settings.freshnessMinutes * 60_000;
  if (
    input.nowMs - currentAt > freshnessMs ||
    !Number.isFinite(marketUpdatedAt) ||
    input.nowMs - marketUpdatedAt > freshnessMs
  ) {
    return {
      ...base,
      qualityStatus: "stale",
      reason: "latest_token_snapshot_stale",
      candidate: false,
    };
  }

  const priceOneHourChangePct = percentChange(current.priceUsd, reference.priceUsd);
  const volumeOneHourChangePct = percentChange(current.volume24hUsd, reference.volume24hUsd);
  const volumeDeltaUsd = current.volume24hUsd - reference.volume24hUsd;
  const priceQualified =
    (priceOneHourChangePct ?? Number.NEGATIVE_INFINITY) >= input.settings.priceOneHourThresholdPct;
  const volumeQualified =
    (volumeOneHourChangePct ?? Number.NEGATIVE_INFINITY) >=
    input.settings.volumeOneHourThresholdPct;
  const material = volumeDeltaUsd >= input.settings.minimumVolumeDeltaUsd;
  const reasons = [
    priceQualified ? `price_one_hour_up_${input.settings.priceOneHourThresholdPct}` : null,
    volumeQualified ? `volume_one_hour_up_${input.settings.volumeOneHourThresholdPct}` : null,
    material ? `volume_delta_${input.settings.minimumVolumeDeltaUsd}` : "volume_delta_below_floor",
  ].filter((item): item is string => item !== null);
  return {
    ...base,
    qualityStatus: "ok",
    reason: reasons.join("+"),
    priceOneHourChangePct,
    volumeOneHourChangePct,
    volumeDeltaUsd,
    candidate: priceQualified && volumeQualified && material,
  };
}

function baselineState(
  previousState: PairTokenMomentumStateRecord,
  signal: SignalEvaluation,
  nowIso: string,
): PairTokenMomentumStateRecord {
  const { candidate, ...evaluation } = signal;
  return {
    ...previousState,
    ...evaluation,
    state: candidate ? "watch" : "cold",
    candidateStreak: candidate ? 1 : 0,
    clearStreak: 0,
    episodeStartedAt: candidate ? signal.observedAt : null,
    lastEvaluatedAt: signal.observedAt,
    notifiedAt: null,
    updatedAt: nowIso,
  };
}

export function planPairTokenMomentum(input: {
  snapshots: PairTokenMomentumSnapshot[];
  previousState: PairTokenMomentumStateRecord;
  settings: PairTokenMomentumSettings;
  now: Date;
}): PairTokenMomentumPlan {
  const nowIso = input.now.toISOString();
  const snapshots = input.snapshots
    .filter((item) => Number.isFinite(Date.parse(item.observedAt)))
    .sort((left, right) => left.observedAt.localeCompare(right.observedAt));
  const latestIndex = snapshots.length - 1;
  const latest = snapshots[latestIndex];
  if (!latest) {
    return {
      status: "data_unreliable",
      nextState: {
        ...input.previousState,
        ...emptyEvaluation("no_pair_token_snapshots"),
        updatedAt: nowIso,
      },
      alert: null,
    };
  }
  if (input.previousState.lastEvaluatedAt === latest.observedAt) {
    return { status: "duplicate", nextState: input.previousState, alert: null };
  }

  const signal = evaluateSignal({
    snapshots,
    index: latestIndex,
    settings: input.settings,
    nowMs: input.now.valueOf(),
  });
  if (signal.qualityStatus !== "ok") {
    const { candidate: _candidate, ...evaluation } = signal;
    return {
      status: "data_unreliable",
      nextState: {
        ...input.previousState,
        ...evaluation,
        candidateStreak: 0,
        lastEvaluatedAt: latest.observedAt,
        updatedAt: nowIso,
      },
      alert: null,
    };
  }

  const previousEvaluationAt = Date.parse(input.previousState.lastEvaluatedAt ?? "");
  const currentAt = Date.parse(latest.observedAt);
  const sequentialMinutes = (currentAt - previousEvaluationAt) / 60_000;
  if (
    input.previousState.lastEvaluatedAt === null ||
    !Number.isFinite(sequentialMinutes) ||
    sequentialMinutes < 5 ||
    sequentialMinutes > 45
  ) {
    return {
      status: "baseline",
      nextState: baselineState(input.previousState, signal, nowIso),
      alert: null,
    };
  }

  const { candidate, ...evaluation } = signal;
  const nextState: PairTokenMomentumStateRecord = {
    ...input.previousState,
    ...evaluation,
    lastEvaluatedAt: latest.observedAt,
    updatedAt: nowIso,
  };
  if (!candidate) {
    nextState.candidateStreak = 0;
    if (input.previousState.state === "active") {
      nextState.clearStreak = input.previousState.clearStreak + 1;
      if (nextState.clearStreak >= input.settings.rearmSamples) {
        nextState.state = "cold";
        nextState.clearStreak = 0;
        nextState.episodeStartedAt = null;
        nextState.notifiedAt = null;
      }
    } else {
      nextState.state = "cold";
      nextState.clearStreak = 0;
      nextState.episodeStartedAt = null;
      nextState.notifiedAt = null;
    }
    return { status: "cold", nextState, alert: null };
  }

  nextState.clearStreak = 0;
  if (input.previousState.state === "active") {
    nextState.state = "active";
    return { status: "active", nextState, alert: null };
  }
  nextState.state = "watch";
  nextState.episodeStartedAt = input.previousState.episodeStartedAt ?? latest.observedAt;
  nextState.candidateStreak =
    input.previousState.state === "watch" ? input.previousState.candidateStreak + 1 : 1;
  if (nextState.candidateStreak < input.settings.consecutiveSamples) {
    return { status: "watch", nextState, alert: null };
  }

  if (
    signal.currentPriceUsd === null ||
    signal.currentVolume24hUsd === null ||
    signal.referenceObservedAt === null ||
    signal.referencePriceUsd === null ||
    signal.referenceVolume24hUsd === null ||
    signal.priceOneHourChangePct === null ||
    signal.volumeOneHourChangePct === null ||
    signal.volumeDeltaUsd === null
  ) {
    return { status: "data_unreliable", nextState, alert: null };
  }
  nextState.state = "active";
  nextState.notifiedAt = nowIso;
  const episodeStartedAt = nextState.episodeStartedAt ?? latest.observedAt;
  return {
    status: "sent_or_queued",
    nextState,
    alert: {
      dedupeKey: `pair-token-momentum:${episodeStartedAt}`,
      observedAt: latest.observedAt,
      currentPriceUsd: signal.currentPriceUsd,
      currentVolume24hUsd: signal.currentVolume24hUsd,
      currentMarketCapUsd: signal.currentMarketCapUsd,
      currentLiquidityDepthUsd: signal.currentLiquidityDepthUsd,
      referenceObservedAt: signal.referenceObservedAt,
      referencePriceUsd: signal.referencePriceUsd,
      referenceVolume24hUsd: signal.referenceVolume24hUsd,
      priceOneHourChangePct: signal.priceOneHourChangePct,
      volumeOneHourChangePct: signal.volumeOneHourChangePct,
      volumeDeltaUsd: signal.volumeDeltaUsd,
      triggerReason: signal.reason,
      createdAt: nowIso,
    },
  };
}
