import type {
  GlucoseHistoryReading,
  GlucoseSeriesResponse,
  GlucoseSeriesReductionMode,
  GlucoseSeriesContinuity,
} from "@/lib/api";
import type { NormalizedHistoryWindow } from "@/lib/query/dashboard";

export const MIN_GLUCOSE_SERIES_DATA_POINTS = 4;
export const MAX_GLUCOSE_SERIES_DATA_POINTS = 2_000;
export const GLUCOSE_SERIES_POINTS_PER_BUCKET = 4;
export const GLUCOSE_SERIES_RESIZE_DEBOUNCE_MS = 150;
export const GLUCOSE_SERIES_GROWTH_THRESHOLD_PX = 16;

const DAY_MS = 86_400_000;
const NICE_INTERVALS_MS = [
  1, 10, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 30_000, 60_000,
  120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000,
  21_600_000, 43_200_000, 86_400_000,
] as const;

export interface DashboardGlucoseSeriesData {
  readings: GlucoseHistoryReading[];
  requestedWindow: NormalizedHistoryWindow;
  coverageWindow: NormalizedHistoryWindow;
  maxDataPoints: number;
  resolutionMode: GlucoseSeriesReductionMode;
  bucketIntervalMs: number | null;
  timelineRevision: string;
  sourceSelection: "primary" | "primary_and_secondary";
  sourceRawReadingCount: number;
  continuity: GlucoseSeriesContinuity;
}

function timestampMs(value: string): number {
  return new Date(value).getTime();
}

function glucoseReadingKey(reading: GlucoseHistoryReading): string {
  return `${reading.reading_timestamp}|${reading.value}|${reading.source}`;
}

export function normalizeGlucoseSeriesPointBudget(
  plotWidth: number | null | undefined,
): number | null {
  if (!Number.isFinite(plotWidth) || plotWidth == null) return null;
  const width = Math.floor(plotWidth);
  if (width < MIN_GLUCOSE_SERIES_DATA_POINTS) return null;
  return Math.min(width, MAX_GLUCOSE_SERIES_DATA_POINTS);
}

export function roundNiceSeriesIntervalMsUp(intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 1;

  for (const candidate of NICE_INTERVALS_MS) {
    if (candidate >= intervalMs) return candidate;
  }

  return Math.ceil(intervalMs / DAY_MS) * DAY_MS;
}

export function resolveGlucoseSeriesIntervalMs(
  window: NormalizedHistoryWindow,
  maxDataPoints: number,
): number {
  const durationMs = Math.max(
    1,
    timestampMs(window.to) - timestampMs(window.from),
  );
  const bucketBudget = Math.max(
    1,
    Math.floor(maxDataPoints / GLUCOSE_SERIES_POINTS_PER_BUCKET),
  );
  return roundNiceSeriesIntervalMsUp(Math.ceil(durationMs / bucketBudget));
}

export function windowCovers(
  covering: NormalizedHistoryWindow,
  target: NormalizedHistoryWindow,
): boolean {
  return (
    timestampMs(covering.from) <= timestampMs(target.from) &&
    timestampMs(covering.to) >= timestampMs(target.to)
  );
}

export function isGlucoseSeriesSufficient(
  data: DashboardGlucoseSeriesData,
  targetWindow: NormalizedHistoryWindow,
  targetMaxDataPoints: number,
): boolean {
  if (!windowCovers(data.coverageWindow, targetWindow)) return false;
  if (data.resolutionMode === "raw") return true;
  if (data.bucketIntervalMs == null) return false;
  return (
    data.bucketIntervalMs <=
    resolveGlucoseSeriesIntervalMs(targetWindow, targetMaxDataPoints)
  );
}

function selectExcursionCandidates(
  readings: GlucoseHistoryReading[],
  window: NormalizedHistoryWindow,
  intervalMs: number,
): GlucoseHistoryReading[] {
  const startMs = timestampMs(window.from);
  const buckets = new Map<number, GlucoseHistoryReading[]>();

  for (const reading of readings) {
    const bucketIndex = Math.floor(
      (timestampMs(reading.reading_timestamp) - startMs) / intervalMs,
    );
    const bucket = buckets.get(bucketIndex) ?? [];
    bucket.push(reading);
    buckets.set(bucketIndex, bucket);
  }

  const selected = new Map<string, GlucoseHistoryReading>();
  for (const bucket of buckets.values()) {
    const sorted = [...bucket].sort(
      (left, right) =>
        timestampMs(left.reading_timestamp) -
        timestampMs(right.reading_timestamp),
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    let minimum = first;
    let maximum = first;

    for (const reading of sorted) {
      if (reading.value < minimum.value) minimum = reading;
      if (reading.value > maximum.value) maximum = reading;
    }

    for (const reading of [first, minimum, maximum, last]) {
      selected.set(glucoseReadingKey(reading), reading);
    }
  }

  return [...selected.values()].sort(
    (left, right) =>
      timestampMs(left.reading_timestamp) -
      timestampMs(right.reading_timestamp),
  );
}

export function toDashboardGlucoseSeriesData(
  response: GlucoseSeriesResponse,
  requestedWindow: NormalizedHistoryWindow,
): DashboardGlucoseSeriesData {
  return {
    readings: response.readings,
    requestedWindow,
    coverageWindow: {
      from: new Date(response.metadata.applied_window.start).toISOString(),
      to: new Date(response.metadata.applied_window.end).toISOString(),
    },
    maxDataPoints: response.metadata.requested_max_data_points,
    resolutionMode: response.metadata.reduction_mode,
    bucketIntervalMs: response.metadata.bucket_interval_ms,
    timelineRevision: response.metadata.timeline_revision,
    sourceSelection: response.metadata.source_selection.requested,
    sourceRawReadingCount: response.metadata.raw_reading_count,
    continuity: response.metadata.continuity,
  };
}

export function deriveGlucoseSeriesForWindow(
  data: DashboardGlucoseSeriesData,
  targetWindow: NormalizedHistoryWindow,
  targetMaxDataPoints: number,
): DashboardGlucoseSeriesData {
  const fromMs = timestampMs(targetWindow.from);
  const toMs = timestampMs(targetWindow.to);
  let readings = data.readings.filter((reading) => {
    const readingMs = timestampMs(reading.reading_timestamp);
    return readingMs >= fromMs && readingMs < toMs;
  });
  let resolutionMode = data.resolutionMode;
  let bucketIntervalMs = data.bucketIntervalMs;

  if (readings.length > targetMaxDataPoints) {
    bucketIntervalMs = resolveGlucoseSeriesIntervalMs(
      targetWindow,
      targetMaxDataPoints,
    );
    readings = selectExcursionCandidates(
      readings,
      targetWindow,
      bucketIntervalMs,
    );
    resolutionMode = "reduced";
  }

  return {
    ...data,
    readings,
    requestedWindow: targetWindow,
    coverageWindow: targetWindow,
    maxDataPoints: targetMaxDataPoints,
    resolutionMode,
    bucketIntervalMs,
    continuity: {
      ...data.continuity,
      gaps: data.continuity.gaps.filter((gap) => {
        const gapStartMs = timestampMs(gap.start);
        const gapEndMs = timestampMs(gap.end);
        return gapEndMs > fromMs && gapStartMs < toMs;
      }),
    },
  };
}
