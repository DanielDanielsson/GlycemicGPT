"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AnimatedCard } from "@/components/AnimatedCard";
import { V2AgpChart } from "@/components/AgpChart";
import { DashboardTimelineChart } from "@/components/DashboardTimelineChart";
import { useDashboardTimeRange } from "@/components/DashboardTimeRangeProvider";
import {
  useDashboardBolusReview,
  useDashboardGlucoseSeries,
  useDashboardPumpEvents,
} from "@/hooks/dashboard-query";
import type { ForecastReadResponse } from "@/lib/api";
import type { ChartZoomDomain } from "@/lib/charts/chart-zoom";
import { getRawTimeRangeForSelection } from "@/lib/glucose/dashboard-time-range-url";
import type { GlucoseUnit } from "@/lib/glucose-units";

interface GlucoseZoomSelection {
  dashboardWindowKey: string;
  window: { from: string; to: string };
}

function historyWindowKey(window: { from: string; to: string } | null): string {
  return window ? `${window.from}\u0000${window.to}` : "";
}

interface DashboardChartPanelsProps {
  children: ReactNode;
  forecast?: ForecastReadResponse | null;
  hasConfiguredPump?: boolean;
  thresholds?: {
    urgentLow: number;
    low: number;
    high: number;
    urgentHigh: number;
  };
  unit?: GlucoseUnit;
}

function DeferredV2AgpChart({
  thresholds,
  unit,
}: Pick<DashboardChartPanelsProps, "thresholds" | "unit">) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef}>
      {shouldLoad ? (
        <AnimatedCard delay={0.2}>
          <V2AgpChart thresholds={thresholds} unit={unit} />
        </AnimatedCard>
      ) : null}
    </div>
  );
}

export function DashboardChartPanels({
  children,
  forecast,
  hasConfiguredPump = false,
  thresholds,
  unit = "mgdl",
}: DashboardChartPanelsProps) {
  const { currentWindow, selection } = useDashboardTimeRange();
  const dashboardWindowKey = historyWindowKey(currentWindow);
  const [timelinePlotWidth, setTimelinePlotWidth] = useState<number | null>(
    null,
  );
  const [glucoseZoomSelection, setGlucoseZoomSelection] =
    useState<GlucoseZoomSelection | null>(null);
  const activeGlucoseZoom =
    glucoseZoomSelection?.dashboardWindowKey === dashboardWindowKey
      ? glucoseZoomSelection.window
      : null;
  const glucoseWindow = activeGlucoseZoom ?? currentWindow;
  const glucoseCacheRange =
    activeGlucoseZoom ?? getRawTimeRangeForSelection(selection);
  const handleZoomDomainChange = useCallback(
    (domain: ChartZoomDomain | null) => {
      if (!domain) {
        setGlucoseZoomSelection(null);
        return;
      }

      setGlucoseZoomSelection({
        dashboardWindowKey,
        window: {
          from: new Date(domain[0]).toISOString(),
          to: new Date(domain[1]).toISOString(),
        },
      });
    },
    [dashboardWindowKey],
  );

  useEffect(() => {
    setGlucoseZoomSelection(null);
  }, [dashboardWindowKey]);

  const glucose = useDashboardGlucoseSeries(
    timelinePlotWidth,
    "3h",
    glucoseWindow,
    glucoseCacheRange,
  );
  const insulin = useDashboardBolusReview("24h", currentWindow, 500);
  const pump = useDashboardPumpEvents(glucose.period, currentWindow);
  const queryData = { glucose, insulin, pump };

  return (
    <>
      <DashboardTimelineChart
        forecast={forecast}
        hasConfiguredPump={hasConfiguredPump}
        onPlotWidthChange={setTimelinePlotWidth}
        onZoomDomainChange={handleZoomDomainChange}
        queryData={queryData}
        thresholds={thresholds}
        unit={unit}
      />
      {children}
      <DeferredV2AgpChart thresholds={thresholds} unit={unit} />
    </>
  );
}
