import type { AgpChartPoint } from "./AgpChart.types";

const SAMPLES_PER_HOUR = 8;

export interface AgpPlotPoint {
  hour: number;
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

function sameSign(left: number, right: number): boolean {
  return (left > 0 && right > 0) || (left < 0 && right < 0);
}

function monotoneTangent(leftSlope: number, rightSlope: number): number {
  if (!sameSign(leftSlope, rightSlope)) return 0;
  return (2 * leftSlope * rightSlope) / (leftSlope + rightSlope);
}

function interpolateMonotone(
  previous: number,
  start: number,
  end: number,
  following: number,
  progress: number,
): number {
  const incoming = start - previous;
  const interval = end - start;
  const outgoing = following - end;
  const startTangent = monotoneTangent(incoming, interval);
  const endTangent = monotoneTangent(interval, outgoing);
  const squared = progress * progress;
  const cubed = squared * progress;

  return (
    (2 * cubed - 3 * squared + 1) * start +
    (cubed - 2 * squared + progress) * startTangent +
    (-2 * cubed + 3 * squared) * end +
    (cubed - squared) * endTangent
  );
}

function percentileParts(point: AgpChartPoint): number[] {
  return [
    point.p10,
    Math.max(0, point.p25 - point.p10),
    Math.max(0, point.p50 - point.p25),
    Math.max(0, point.p75 - point.p50),
    Math.max(0, point.p90 - point.p75),
  ];
}

function toPlotPoint(hour: number, parts: number[]): AgpPlotPoint {
  const p10 = parts[0];
  const p25 = p10 + Math.max(0, parts[1]);
  const p50 = p25 + Math.max(0, parts[2]);
  const p75 = p50 + Math.max(0, parts[3]);
  const p90 = p75 + Math.max(0, parts[4]);
  return { hour, p10, p25, p50, p75, p90 };
}

function emptyPlotPoint(hour: number): AgpPlotPoint {
  return { hour, p10: null, p25: null, p50: null, p75: null, p90: null };
}

/**
 * Interpolate exact hourly percentiles without overshoot or percentile crossing.
 * The 24 hour modal day is cyclic only where both adjoining buckets contain data.
 */
export function buildSmoothedAgpPlotPoints(
  points: AgpChartPoint[],
): AgpPlotPoint[] {
  const byHour = new Map(points.map((point) => [point.hour, point]));
  const output: AgpPlotPoint[] = [];

  for (let hour = 0; hour < 24; hour += 1) {
    const start = byHour.get(hour);
    const end = byHour.get((hour + 1) % 24);
    if (!start || !end || start.count === 0 || end.count === 0) {
      output.push(
        start && start.count > 0
          ? toPlotPoint(hour, percentileParts(start))
          : emptyPlotPoint(hour),
      );
      for (let sample = 1; sample < SAMPLES_PER_HOUR; sample += 1) {
        output.push(emptyPlotPoint(hour + sample / SAMPLES_PER_HOUR));
      }
      continue;
    }

    const previousCandidate = byHour.get((hour + 23) % 24);
    const followingCandidate = byHour.get((hour + 2) % 24);
    const previous =
      previousCandidate && previousCandidate.count > 0
        ? previousCandidate
        : start;
    const following =
      followingCandidate && followingCandidate.count > 0
        ? followingCandidate
        : end;
    const previousParts = percentileParts(previous);
    const startParts = percentileParts(start);
    const endParts = percentileParts(end);
    const followingParts = percentileParts(following);

    for (let sample = 0; sample < SAMPLES_PER_HOUR; sample += 1) {
      const progress = sample / SAMPLES_PER_HOUR;
      const parts = startParts.map((value, index) =>
        interpolateMonotone(
          previousParts[index],
          value,
          endParts[index],
          followingParts[index],
          progress,
        ),
      );
      output.push(toPlotPoint(hour + progress, parts));
    }
  }

  const midnight = byHour.get(0);
  output.push(
    midnight && midnight.count > 0
      ? toPlotPoint(24, percentileParts(midnight))
      : emptyPlotPoint(24),
  );
  return output;
}
