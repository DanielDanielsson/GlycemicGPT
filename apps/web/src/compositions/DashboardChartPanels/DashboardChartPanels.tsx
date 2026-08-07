"use client";

import type { ReactNode } from "react";

import { AnimatedCard } from "@/components/AnimatedCard";
import { V2AgpChartView } from "@/components/AgpChart";
import { DashboardTimelineChart } from "@/components/DashboardTimelineChart";
import { useDashboardTimeRange } from "@/components/DashboardTimeRangeProvider";
import {
  useDashboardBolusReview,
  useDashboardGlucoseHistory,
  useDashboardPumpEvents,
} from "@/hooks/dashboard-query";
import type { ForecastReadResponse } from "@/lib/api";
import type { GlucoseUnit } from "@/lib/glucose-units";

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

export function DashboardChartPanels({
  children,
  forecast,
  hasConfiguredPump = false,
  thresholds,
  unit = "mgdl",
}: DashboardChartPanelsProps) {
  const { currentWindow } = useDashboardTimeRange();
  const glucose = useDashboardGlucoseHistory("3h", currentWindow);
  const insulin = useDashboardBolusReview("24h", currentWindow, 500);
  const pump = useDashboardPumpEvents(glucose.period, currentWindow);
  const queryData = { glucose, insulin, pump };

  return (
    <>
      <DashboardTimelineChart
        forecast={forecast}
        hasConfiguredPump={hasConfiguredPump}
        queryData={queryData}
        thresholds={thresholds}
        unit={unit}
      />
      {children}
      <AnimatedCard delay={0.2}>
        <V2AgpChartView
          queryData={glucose}
          thresholds={thresholds}
          unit={unit}
        />
      </AnimatedCard>
    </>
  );
}
