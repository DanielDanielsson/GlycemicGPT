import type { GlucoseSeriesReductionMode } from "@/lib/api";

const MIN_POINT_SPACING_PX = 5;

export type GlucoseRenderMode = "line" | "points";

export function resolveGlucoseRenderMode(
  dataLength: number,
  plotWidth: number,
  resolutionMode?: GlucoseSeriesReductionMode | null,
): GlucoseRenderMode {
  if (resolutionMode === "reduced") {
    return "line";
  }

  return dataLength > Math.max(1, Math.floor(plotWidth / MIN_POINT_SPACING_PX))
    ? "line"
    : "points";
}
