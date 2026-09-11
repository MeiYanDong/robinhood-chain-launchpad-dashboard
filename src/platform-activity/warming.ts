export type PairWarmingSignalState = "cold" | "watch" | "warming" | "strong";
export type PairWarmingQualityStatus =
  | "ok"
  | "stale"
  | "source_unavailable"
  | "unstable_coverage"
  | "insufficient_history";

export interface PairRollingVolumeSnapshot {
  runId: number;
  observedAt: string;
  tokenCount: number;
  volumeObservedCount: number;
  volume24hUsd: number;
  sourceStatus: "ok" | "degraded" | "failed";
}

export interface PairCompletedDailyVolume {
  date: string;
  valueUsd: number;
}

export interface PairWarmingAlertSettings {
  enabled: boolean;
  oneHourThresholdPct: number;
  sixHourLowThresholdPct: number;
  consecutiveSamples: number;
  rearmSamples: number;
  upgradeThresholdPct: number;
  freshnessMinutes: number;
  tokenCountDriftPct: number;
  observedCountDriftPct: number;
  materialMedianPct: number;
}

export const DEFAULT_PAIR_WARMING_ALERT_SETTINGS: PairWarmingAlertSettings = {
  enabled: true,
  oneHourThresholdPct: 15,
  sixHourLowThresholdPct: 25,
  consecutiveSamples: 2,
  rearmSamples: 4,
  upgradeThresholdPct: 30,
  freshnessMinutes: 30,
  tokenCountDriftPct: 2,
  observedCountDriftPct: 5,
  materialMedianPct: 5,
};

export interface PairWarmingEvaluationSnapshot {
  qualityStatus: PairWarmingQualityStatus;
  reason: string;
  observedAt: string | null;
  currentValueUsd: number | null;
  oneHourChangePct: number | null;
  sixHourLowChangePct: number | null;
  latestCompleteDate: string | null;
  latestCompleteValueUsd: number | null;
  currentVsLatestCompletePct: number | null;
  sevenDayMedianValueUsd: number | null;
  currentVsSevenDayMedianPct: number | null;
  materialChangeUsd: number | null;
  materialRequiredUsd: number | null;
  tokenCount: number | null;
  volumeObservedCount: number | null;
}

export interface PairWarmingStateRecord extends PairWarmingEvaluationSnapshot {
  state: PairWarmingSignalState;
  candidateStreak: number;
  clearStreak: number;
  episodeStartedAt: string | null;
  episodePeakValueUsd: number | null;
  notifiedValueUsd: number | null;
  lastEvaluatedAt: string | null;
  updatedAt: string;
}

export interface PairWarmingAlert {
  dedupeKey: string;
  level: "warming" | "strong";
  observedAt: string;
  currentValueUsd: number;
  oneHourChangePct: number | null;
  sixHourLowChangePct: number | null;
  latestCompleteDate: string | null;
  latestCompleteValueUsd: number | null;
  sevenDayMedianValueUsd: number | null;
  currentVsSevenDayMedianPct: number | null;
  tokenCount: number;
  volumeObservedCount: number;
  triggerReason: string;
  createdAt: string;
}

export interface PairWarmingPlan {
  status: "cold" | "watch" | "sent_or_queued" | "data_unreliable" | "duplicate";
  nextState: PairWarmingStateRecord;
  alert: PairWarmingAlert | null;
}

interface SignalEvaluation extends PairWarmingEvaluationSnapshot {
  candidate: boolean;
}

function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint] ?? null;
  const left = sorted[midpoint - 1];
  const right = sorted[midpoint];
  return left === undefined || right === undefined ? null : (left + right) / 2;
}

function absoluteDriftPct(current: number, previous: number): number {
  if (previous <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs((current - previous) / previous) * 100;
}

function closestReference(
  snapshots: PairRollingVolumeSnapshot[],
  index: number,
  minimumMinutes: number,
  maximumMinutes: number,
): PairRollingVolumeSnapshot | null {
  const current = snapshots[index];
  if (!current) return null;
  const currentAt = Date.parse(current.observedAt);
  let selected: PairRollingVolumeSnapshot | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;
  const targetMinutes = (minimumMinutes + maximumMinutes) / 2;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = snapshots[cursor];
    if (!candidate) continue;
    const minutes = (currentAt - Date.parse(candidate.observedAt)) / 60_000;
    if (minutes > maximumMinutes) break;
    if (minutes < minimumMinutes) continue;
    const distance = Math.abs(minutes - targetMinutes);
    if (distance < selectedDistance) {
      selected = candidate;
      selectedDistance = distance;
    }
  }
  return selected;
}

function lowReference(
  snapshots: PairRollingVolumeSnapshot[],
  index: number,
  maximumMinutes: number,
): PairRollingVolumeSnapshot | null {
  const current = snapshots[index];
  if (!current) return null;
  const currentAt = Date.parse(current.observedAt);
  const candidates: PairRollingVolumeSnapshot[] = [];
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = snapshots[cursor];
    if (!candidate) continue;
    const minutes = (currentAt - Date.parse(candidate.observedAt)) / 60_000;
    if (minutes > maximumMinutes) break;
    if (minutes > 0) candidates.push(candidate);
  }
  return candidates.sort((left, right) => left.volume24hUsd - right.volume24hUsd)[0] ?? null;
}

function emptyEvaluation(reason: string): PairWarmingEvaluationSnapshot {
  return {
    qualityStatus: "insufficient_history",
    reason,
    observedAt: null,
    currentValueUsd: null,
    oneHourChangePct: null,
    sixHourLowChangePct: null,
    latestCompleteDate: null,
    latestCompleteValueUsd: null,
    currentVsLatestCompletePct: null,
    sevenDayMedianValueUsd: null,
    currentVsSevenDayMedianPct: null,
    materialChangeUsd: null,
    materialRequiredUsd: null,
    tokenCount: null,
    volumeObservedCount: null,
  };
}

export function initialPairWarmingState(now: string): PairWarmingStateRecord {
  return {
    state: "cold",
    candidateStreak: 0,
    clearStreak: 0,
    episodeStartedAt: null,
    episodePeakValueUsd: null,
    notifiedValueUsd: null,
    lastEvaluatedAt: null,
    updatedAt: now,
    ...emptyEvaluation("waiting_for_first_snapshot"),
  };
}

function evaluateSignal(input: {
  snapshots: PairRollingVolumeSnapshot[];
  index: number;
  daily: PairCompletedDailyVolume[];
  settings: PairWarmingAlertSettings;
  nowMs: number;
  enforceFreshness: boolean;
}): SignalEvaluation {
  const current = input.snapshots[input.index];
  const previous = input.snapshots[input.index - 1];
  const daily = input.daily
    .filter((item) => Number.isFinite(item.valueUsd) && item.valueUsd >= 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  const latestComplete = daily.at(-1) ?? null;
  const sevenDayMedian = median(daily.slice(-7).map((item) => item.valueUsd));
  const base: PairWarmingEvaluationSnapshot = {
    qualityStatus: "insufficient_history",
    reason: "insufficient_snapshot_history",
    observedAt: current?.observedAt ?? null,
    currentValueUsd: current?.volume24hUsd ?? null,
    oneHourChangePct: null,
    sixHourLowChangePct: null,
    latestCompleteDate: latestComplete?.date ?? null,
    latestCompleteValueUsd: latestComplete?.valueUsd ?? null,
    currentVsLatestCompletePct:
      current && latestComplete
        ? percentChange(current.volume24hUsd, latestComplete.valueUsd)
        : null,
    sevenDayMedianValueUsd: sevenDayMedian,
    currentVsSevenDayMedianPct:
      current && sevenDayMedian ? (current.volume24hUsd / sevenDayMedian) * 100 : null,
    materialChangeUsd: null,
    materialRequiredUsd:
      sevenDayMedian === null ? null : (sevenDayMedian * input.settings.materialMedianPct) / 100,
    tokenCount: current?.tokenCount ?? null,
    volumeObservedCount: current?.volumeObservedCount ?? null,
  };

  if (
    !current ||
    !previous ||
    !Number.isFinite(current.volume24hUsd) ||
    current.volume24hUsd <= 0
  ) {
    return { ...base, candidate: false };
  }
  if (current.sourceStatus !== "ok") {
    return {
      ...base,
      qualityStatus: "source_unavailable",
      reason: "pair_official_volume_source_unavailable",
      candidate: false,
    };
  }
  const currentAt = Date.parse(current.observedAt);
  if (!Number.isFinite(currentAt)) return { ...base, candidate: false };
  if (
    input.enforceFreshness &&
    input.nowMs - currentAt > input.settings.freshnessMinutes * 60_000
  ) {
    return { ...base, qualityStatus: "stale", reason: "latest_snapshot_stale", candidate: false };
  }
  const previousAt = Date.parse(previous.observedAt);
  const cadenceMinutes = (currentAt - previousAt) / 60_000;
  const stableCoverage =
    Number.isFinite(cadenceMinutes) &&
    cadenceMinutes >= 5 &&
    cadenceMinutes <= 45 &&
    absoluteDriftPct(current.tokenCount, previous.tokenCount) <=
      input.settings.tokenCountDriftPct &&
    absoluteDriftPct(current.volumeObservedCount, previous.volumeObservedCount) <=
      input.settings.observedCountDriftPct;
  if (!stableCoverage) {
    return {
      ...base,
      qualityStatus: "unstable_coverage",
      reason: "snapshot_cadence_or_coverage_changed",
      candidate: false,
    };
  }

  const oneHour = closestReference(input.snapshots, input.index, 45, 90);
  const sixHourLow = lowReference(input.snapshots, input.index, 360);
  if (!oneHour || !sixHourLow || sevenDayMedian === null || daily.length < 3) {
    return { ...base, candidate: false };
  }
  const oneHourChangePct = percentChange(current.volume24hUsd, oneHour.volume24hUsd);
  const sixHourLowChangePct = percentChange(current.volume24hUsd, sixHourLow.volume24hUsd);
  const referenceValue = Math.min(oneHour.volume24hUsd, sixHourLow.volume24hUsd);
  const materialChangeUsd = current.volume24hUsd - referenceValue;
  const materialRequiredUsd = (sevenDayMedian * input.settings.materialMedianPct) / 100;
  const fast = (oneHourChangePct ?? Number.NEGATIVE_INFINITY) >= input.settings.oneHourThresholdPct;
  const slow =
    (sixHourLowChangePct ?? Number.NEGATIVE_INFINITY) >= input.settings.sixHourLowThresholdPct;
  const material = materialChangeUsd >= materialRequiredUsd;
  const reasons = [
    fast ? `one_hour_up_${input.settings.oneHourThresholdPct}` : null,
    slow ? `six_hour_low_up_${input.settings.sixHourLowThresholdPct}` : null,
    material ? "material_move" : "move_below_material_floor",
  ].filter((item): item is string => item !== null);
  return {
    ...base,
    qualityStatus: "ok",
    reason: reasons.join("+"),
    oneHourChangePct,
    sixHourLowChangePct,
    materialChangeUsd,
    materialRequiredUsd,
    candidate: material && (fast || slow),
  };
}

export function planPairVolumeWarming(input: {
  snapshots: PairRollingVolumeSnapshot[];
  daily: PairCompletedDailyVolume[];
  previousState: PairWarmingStateRecord;
  settings: PairWarmingAlertSettings;
  now: Date;
}): PairWarmingPlan {
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
        ...emptyEvaluation("no_pair_volume_snapshots"),
        updatedAt: nowIso,
      },
      alert: null,
    };
  }
  if (input.previousState.lastEvaluatedAt === latest.observedAt) {
    return { status: "duplicate", nextState: input.previousState, alert: null };
  }

  const latestSignal = evaluateSignal({
    snapshots,
    index: latestIndex,
    daily: input.daily,
    settings: input.settings,
    nowMs: input.now.valueOf(),
    enforceFreshness: true,
  });
  const { candidate: latestCandidate, ...latestEvaluation } = latestSignal;
  const nextState: PairWarmingStateRecord = {
    ...input.previousState,
    ...latestEvaluation,
    lastEvaluatedAt: latest.observedAt,
    updatedAt: nowIso,
  };
  if (latestSignal.qualityStatus !== "ok") {
    return { status: "data_unreliable", nextState, alert: null };
  }

  let candidateStreak = 0;
  let episodeStartedAt = latest.observedAt;
  for (let index = latestIndex; index >= 0; index -= 1) {
    const signal = evaluateSignal({
      snapshots,
      index,
      daily: input.daily,
      settings: input.settings,
      nowMs: input.now.valueOf(),
      enforceFreshness: false,
    });
    if (!signal.candidate || signal.qualityStatus !== "ok") break;
    candidateStreak += 1;
    episodeStartedAt = signal.observedAt ?? episodeStartedAt;
    if (candidateStreak >= input.settings.consecutiveSamples) break;
  }
  nextState.candidateStreak = candidateStreak;

  if (!latestCandidate) {
    nextState.candidateStreak = 0;
    if (input.previousState.state === "warming" || input.previousState.state === "strong") {
      nextState.clearStreak = input.previousState.clearStreak + 1;
      if (nextState.clearStreak >= input.settings.rearmSamples) {
        nextState.state = "cold";
        nextState.clearStreak = 0;
        nextState.episodeStartedAt = null;
        nextState.episodePeakValueUsd = null;
        nextState.notifiedValueUsd = null;
      }
    } else {
      nextState.state = "cold";
      nextState.clearStreak = 0;
      nextState.episodeStartedAt = null;
      nextState.episodePeakValueUsd = null;
      nextState.notifiedValueUsd = null;
    }
    return { status: "cold", nextState, alert: null };
  }

  nextState.clearStreak = 0;
  nextState.episodeStartedAt = input.previousState.episodeStartedAt ?? episodeStartedAt;
  nextState.episodePeakValueUsd = Math.max(
    input.previousState.episodePeakValueUsd ?? 0,
    latestSignal.currentValueUsd ?? 0,
  );
  if (candidateStreak < input.settings.consecutiveSamples) {
    nextState.state = "watch";
    return { status: "watch", nextState, alert: null };
  }

  let level: PairWarmingAlert["level"] | null = null;
  if (input.previousState.state === "cold" || input.previousState.state === "watch") {
    nextState.state = "warming";
    nextState.notifiedValueUsd = latestSignal.currentValueUsd;
    level = "warming";
  } else if (
    input.previousState.state === "warming" &&
    input.previousState.notifiedValueUsd !== null &&
    (latestSignal.currentValueUsd ?? 0) >=
      input.previousState.notifiedValueUsd * (1 + input.settings.upgradeThresholdPct / 100)
  ) {
    nextState.state = "strong";
    nextState.notifiedValueUsd = latestSignal.currentValueUsd;
    level = "strong";
  } else {
    nextState.state = input.previousState.state;
  }

  if (!level || latestSignal.currentValueUsd === null) {
    return { status: "watch", nextState, alert: null };
  }
  const dedupeEpisode = nextState.episodeStartedAt ?? latest.observedAt;
  return {
    status: "sent_or_queued",
    nextState,
    alert: {
      dedupeKey: `pair-volume-warming:${dedupeEpisode}:${level}`,
      level,
      observedAt: latest.observedAt,
      currentValueUsd: latestSignal.currentValueUsd,
      oneHourChangePct: latestSignal.oneHourChangePct,
      sixHourLowChangePct: latestSignal.sixHourLowChangePct,
      latestCompleteDate: latestSignal.latestCompleteDate,
      latestCompleteValueUsd: latestSignal.latestCompleteValueUsd,
      sevenDayMedianValueUsd: latestSignal.sevenDayMedianValueUsd,
      currentVsSevenDayMedianPct: latestSignal.currentVsSevenDayMedianPct,
      tokenCount: latestSignal.tokenCount ?? 0,
      volumeObservedCount: latestSignal.volumeObservedCount ?? 0,
      triggerReason: latestSignal.reason,
      createdAt: nowIso,
    },
  };
}
