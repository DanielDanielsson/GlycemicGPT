export const MAX_CONTINUOUS_GLUCOSE_INTERVAL_MS = 15 * 60 * 1000;

export interface GlucoseContinuityGap {
  start: string;
  end: string;
}

export interface GlucoseContinuity {
  gaps: readonly GlucoseContinuityGap[];
}

function pairCrossesGap(
  fromTimestampMs: number,
  toTimestampMs: number,
  gaps: readonly GlucoseContinuityGap[],
): boolean {
  return gaps.some((gap) => {
    const gapStartMs = new Date(gap.start).getTime();
    const gapEndMs = new Date(gap.end).getTime();
    return (
      Number.isFinite(gapStartMs) &&
      Number.isFinite(gapEndMs) &&
      fromTimestampMs <= gapStartMs &&
      toTimestampMs >= gapEndMs
    );
  });
}

export function getContinuousGlucosePairs<T>(
  points: readonly T[],
  getTimestampMs: (point: T) => number,
  continuity?: GlucoseContinuity | null,
): Array<readonly [T, T]> {
  const pairs: Array<readonly [T, T]> = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const intervalMs = getTimestampMs(current) - getTimestampMs(previous);

    const isContinuous = continuity
      ? !pairCrossesGap(
          getTimestampMs(previous),
          getTimestampMs(current),
          continuity.gaps,
        )
      : intervalMs <= MAX_CONTINUOUS_GLUCOSE_INTERVAL_MS;

    if (Number.isFinite(intervalMs) && intervalMs >= 0 && isContinuous) {
      pairs.push([previous, current]);
    }
  }

  return pairs;
}
