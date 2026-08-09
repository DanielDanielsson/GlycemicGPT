import { twMerge } from "@/lib/ui/twMerge";
import type { MergedChartRendererProps } from "./MergedGlucoseTrendChart.types";
import { MergedChartLegend } from "./MergedChartLegend";
import { MergedChartStatusMessages } from "./MergedChartStatusMessages";
import { MergedGlucoseTrendSurface } from "./MergedGlucoseTrendSurface";

export function MobileMergedGlucoseTrendChart({
  className,
  model,
  onPlotWidthChange,
  showLoadingStatus = true,
}: MergedChartRendererProps) {
  return (
    <div
      className={twMerge("min-w-0 px-1 py-2", className)}
      data-testid="mobile-merged-glucose-trend"
    >
      <MergedChartStatusMessages
        showLoading={showLoadingStatus}
        statuses={model.statuses}
      />
      <MergedGlucoseTrendSurface
        heightClassName="h-80"
        interactive={false}
        compactAxes
        model={model}
        onPlotWidthChange={onPlotWidthChange}
        xDomain={model.fullDomain}
      />
      <MergedChartLegend
        className="mt-3 border-t border-border-default pt-3"
        model={model}
      />
    </div>
  );
}
