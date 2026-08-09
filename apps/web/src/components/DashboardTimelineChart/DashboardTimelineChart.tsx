"use client";

import { useEffect, useSyncExternalStore } from "react";

import { AnimatedCard } from "@/components/AnimatedCard";
import type { DashboardChartQueryData } from "@/components/DashboardChartQueryAdapters/DashboardChartQueryAdapters";
import { GlucoseTrendChartView } from "@/components/GlucoseTrendChart";
import { LumoseLoadingLogo } from "@/components/LumoseLoadingLogo";
import { MergedGlucoseTrendChartView } from "@/components/MergedGlucoseTrendChart";
import { Panel } from "@/components/Panel";
import type { ForecastReadResponse } from "@/lib/api";
import type { ChartZoomChangeHandler } from "@/lib/charts/chart-zoom";
import type { GlucoseUnit } from "@/lib/glucose-units";

const MEDIUM_BREAKPOINT_QUERY = "(min-width: 768px)";
const LARGE_BREAKPOINT_QUERY = "(min-width: 1024px)";

export type DashboardTimelineVariant =
  "mobile-merged" | "desktop-merged" | "desktop-timeline";

interface DashboardTimelineChartProps {
  forecast?: ForecastReadResponse | null;
  hasConfiguredPump?: boolean;
  onPlotWidthChange?: (width: number) => void;
  onZoomDomainChange?: ChartZoomChangeHandler;
  queryData: DashboardChartQueryData;
  thresholds?: {
    urgentLow: number;
    low: number;
    high: number;
    urgentHigh: number;
  };
  unit?: GlucoseUnit;
}

function getBrowserVariant(): DashboardTimelineVariant | null {
  if (typeof window === "undefined" || !window.matchMedia) return null;
  if (window.matchMedia(LARGE_BREAKPOINT_QUERY).matches) {
    return "desktop-timeline";
  }
  if (window.matchMedia(MEDIUM_BREAKPOINT_QUERY).matches) {
    return "desktop-merged";
  }
  return "mobile-merged";
}

function subscribeToBreakpoints(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) {
    return () => undefined;
  }

  const mediaQueries = [
    window.matchMedia(MEDIUM_BREAKPOINT_QUERY),
    window.matchMedia(LARGE_BREAKPOINT_QUERY),
  ];

  for (const mediaQuery of mediaQueries) {
    mediaQuery.addEventListener("change", onStoreChange);
  }

  return () => {
    for (const mediaQuery of mediaQueries) {
      mediaQuery.removeEventListener("change", onStoreChange);
    }
  };
}

export function useDashboardTimelineVariant(): DashboardTimelineVariant | null {
  return useSyncExternalStore(
    subscribeToBreakpoints,
    getBrowserVariant,
    () => null,
  );
}

export function DashboardTimelineChart({
  forecast,
  hasConfiguredPump = false,
  onPlotWidthChange,
  onZoomDomainChange,
  queryData,
  thresholds,
  unit = "mgdl",
}: DashboardTimelineChartProps) {
  const variant = useDashboardTimelineVariant();

  useEffect(() => {
    if (variant === "mobile-merged") {
      onZoomDomainChange?.(null);
    }
  }, [onZoomDomainChange, variant]);

  if (variant === null) {
    return (
      <AnimatedCard delay={0.1}>
        <Panel heading="Glucose Trend" bodyClassName="p-0 sm:p-0">
          <div className="flex h-80 items-center justify-center">
            <LumoseLoadingLogo label="Loading glucose trend chart" />
          </div>
        </Panel>
      </AnimatedCard>
    );
  }

  if (variant === "desktop-timeline") {
    return (
      <AnimatedCard delay={0.12}>
        <Panel
          bodyClassName="p-0 sm:p-0"
          className="min-w-0"
          heading="Glucose Trend"
        >
          <GlucoseTrendChartView
            embedded
            forecast={forecast}
            hasConfiguredPump={hasConfiguredPump}
            onPlotWidthChange={onPlotWidthChange}
            onZoomDomainChange={onZoomDomainChange}
            queryData={queryData}
            showUpdatingStatus={false}
            thresholds={thresholds}
            unit={unit}
          />
        </Panel>
      </AnimatedCard>
    );
  }

  return (
    <AnimatedCard delay={0.1}>
      <Panel
        bodyClassName="p-0 sm:p-0"
        className="min-w-0"
        disableHeaderMobile
        fullWidthMobile
        heading="Merged Glucose Trend"
      >
        <MergedGlucoseTrendChartView
          forecast={forecast}
          hasConfiguredPump={hasConfiguredPump}
          onPlotWidthChange={onPlotWidthChange}
          onZoomDomainChange={onZoomDomainChange}
          presentation={variant === "mobile-merged" ? "mobile" : "desktop"}
          queryData={queryData}
          showUpdatingStatus={false}
          thresholds={thresholds}
          unit={unit}
        />
      </Panel>
    </AnimatedCard>
  );
}
