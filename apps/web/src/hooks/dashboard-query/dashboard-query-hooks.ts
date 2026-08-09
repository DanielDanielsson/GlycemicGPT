"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useOptionalDashboardTimeRange } from "@/components/DashboardTimeRangeProvider";
import type { DashboardTimeRangeContextValue } from "@/components/DashboardTimeRangeProvider";
import {
  getBolusReview,
  getBolusReviewByDateRange,
  getCgmSources,
  getDashboardGlucoseSummaryByDateRange,
  getForecast,
  getGlookoStatus,
  getGlucoseHistory,
  getGlucoseHistoryByDateRange,
  getGlucosePercentilesByDateRange,
  getGlucoseStats,
  getGlucoseStatsByDateRange,
  getInsulinSummary,
  getInsulinSummaryByDateRange,
  getMedtronicConnectStatus,
  getPumpEventHistory,
  getPumpStatus,
  getTargetGlucoseRange,
  getTimeInRangeDetailByDateRange,
  getTimeInRangeDetailStats,
  listIntegrations,
  listNightscoutConnections,
  type CgmSourcesResponse,
  type ForecastReadResponse,
  type GlookoStatus,
  type GlucoseStats,
  type IntegrationResponse,
  type MedtronicConnectStatus,
  type NightscoutConnectionResponse,
  type PumpStatusResponse,
  type TimeInRangeDetailStats,
} from "@/lib/api";
import { type ChartTimePeriod, PERIOD_TO_MINUTES } from "@/lib/chart-periods";
import type { HistoryWindow } from "@/lib/glucose/history-selection";
import {
  getRawTimeRangeForSelection,
  windowsMatch,
} from "@/lib/glucose/dashboard-time-range-url";
import {
  DASHBOARD_CONNECTION_POLL_INTERVAL,
  DASHBOARD_HISTORICAL_STALE_TIME,
  DASHBOARD_LIVE_STALE_TIME,
  DASHBOARD_SERVER_SOURCE,
  dashboardQueryKeys,
  normalizeHistoryWindow,
} from "@/lib/query/dashboard";
import {
  calculatePumpEventsRequest,
  filterPumpEventsForWindow,
} from "@/hooks/use-pump-events";
import { useUserContext } from "@/providers/user-provider";

const PERIOD_TO_HISTORY_LIMIT: Record<ChartTimePeriod, number> = {
  "3h": 36,
  "6h": 72,
  "12h": 144,
  "24h": 288,
  "3d": 864,
  "7d": 2016,
  "14d": 4032,
  "30d": 8640,
};

const PERIOD_TO_MINUTES_STATS = {
  "24h": 1440,
  "3d": 4320,
  "7d": 10080,
  "14d": 20160,
  "30d": 43200,
} as const;

const PERIOD_TO_DAYS = {
  "24h": 1,
  "3d": 3,
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "90d": 90,
} as const;

export type DashboardStatsPeriod = keyof typeof PERIOD_TO_MINUTES_STATS;
export type DashboardInsulinPeriod = keyof typeof PERIOD_TO_DAYS;
export type DashboardBolusPeriod = Exclude<DashboardInsulinPeriod, "90d">;

// These V2 query functions intentionally do not consume React Query's abort
// signal. Next development Strict Mode unmounts and remounts effects once;
// consuming the signal aborts every first request and forces a duplicate.
// Query keys isolate range changes, so an older response cannot replace data
// for the newly selected range.

function useDashboardQueryIdentity() {
  const { user } = useUserContext();
  const dashboardTimeRange = useOptionalDashboardTimeRange();
  return {
    dashboardTimeRange,
    userId: user?.id ?? "",
    timeZone:
      dashboardTimeRange?.timeZone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      "UTC",
  };
}

function resolveDashboardQueryRange(
  window: HistoryWindow | null | undefined,
  dashboardTimeRange: DashboardTimeRangeContextValue | null,
  timeZone: string,
) {
  const normalizedWindow = normalizeHistoryWindow(window);
  const usesDashboardSelection = windowsMatch(
    normalizedWindow,
    dashboardTimeRange?.currentWindow,
  );
  const rawRange =
    usesDashboardSelection && dashboardTimeRange
      ? getRawTimeRangeForSelection(dashboardTimeRange.selection)
      : normalizedWindow;

  return {
    key: rawRange
      ? {
          from: rawRange.from,
          timeZone,
          to: rawRange.to,
        }
      : null,
    normalizedWindow,
  };
}

function errorMessage(error: Error | null, fallback: string): string | null {
  return error ? error.message || fallback : null;
}

function useVoidRefetch(refetch: () => Promise<unknown>): () => void {
  return useCallback(() => {
    void refetch();
  }, [refetch]);
}

export function useDashboardGlucoseHistory(
  initialPeriod: ChartTimePeriod = "3h",
  window?: HistoryWindow | null,
) {
  const { dashboardTimeRange, timeZone, userId } = useDashboardQueryIdentity();
  const [period, setPeriod] = useState<ChartTimePeriod>(initialPeriod);
  const { key: range, normalizedWindow } = resolveDashboardQueryRange(
    window,
    dashboardTimeRange,
    timeZone,
  );
  const windowDurationMs = normalizedWindow
    ? new Date(normalizedWindow.to).getTime() -
      new Date(normalizedWindow.from).getTime()
    : 0;
  const limit = normalizedWindow
    ? Math.min(
        8640,
        Math.max(36, Math.ceil(windowDurationMs / (5 * 60 * 1000))),
      )
    : PERIOD_TO_HISTORY_LIMIT[period];
  const minutes = normalizedWindow ? null : PERIOD_TO_MINUTES[period];
  const query = useQuery({
    queryKey: dashboardQueryKeys.detail(userId, "glucose-history", {
      limit,
      minutes,
      range,
      sourceSelection: DASHBOARD_SERVER_SOURCE,
    }),
    queryFn: () =>
      normalizedWindow
        ? getGlucoseHistoryByDateRange(
            normalizedWindow.from,
            normalizedWindow.to,
            limit,
          )
        : getGlucoseHistory(minutes ?? PERIOD_TO_MINUTES[period], limit),
    enabled: Boolean(userId),
    gcTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnReconnect: false,
    staleTime: DASHBOARD_HISTORICAL_STALE_TIME,
  });
  const refetch = useVoidRefetch(query.refetch);
  const hasData = query.data !== undefined;

  return {
    readings: query.data?.readings ?? [],
    isLoading: query.isPending && query.fetchStatus === "fetching",
    isUpdating: query.isFetching && hasData,
    isPreviousData: query.isPlaceholderData,
    error: errorMessage(query.error, "Failed to load history"),
    hasBackgroundError: Boolean(query.error && hasData),
    period,
    setPeriod,
    refetch,
  };
}

export function useDashboardGlucosePercentiles(window?: HistoryWindow | null) {
  const { dashboardTimeRange, timeZone, userId } = useDashboardQueryIdentity();
  const { key: range, normalizedWindow } = resolveDashboardQueryRange(
    window,
    dashboardTimeRange,
    timeZone,
  );
  const query = useQuery({
    queryKey: dashboardQueryKeys.detail(userId, "glucose-percentiles", {
      range,
      sourceSelection: DASHBOARD_SERVER_SOURCE,
      timeZone,
    }),
    queryFn: () => {
      if (!normalizedWindow) {
        throw new Error("Glucose percentiles require a date range");
      }
      return getGlucosePercentilesByDateRange(
        normalizedWindow.from,
        normalizedWindow.to,
        timeZone,
      );
    },
    enabled: Boolean(userId && normalizedWindow),
    placeholderData: keepPreviousData,
    refetchOnReconnect: false,
    staleTime: DASHBOARD_HISTORICAL_STALE_TIME,
  });
  const refetch = useVoidRefetch(query.refetch);
  const hasData = query.data !== undefined;

  return {
    buckets: query.data?.buckets ?? [],
    metadata: query.data?.metadata ?? null,
    isLoading: query.isPending && query.fetchStatus === "fetching",
    isUpdating: query.isFetching && hasData,
    isPreviousData: query.isPlaceholderData,
    error: errorMessage(query.error, "Failed to load glucose percentiles"),
    hasBackgroundError: Boolean(query.error && hasData),
    refetch,
  };
}

export function useDashboardGlucoseSummary(window?: HistoryWindow | null) {
  const { dashboardTimeRange, timeZone, userId } = useDashboardQueryIdentity();
  const { key: range, normalizedWindow } = resolveDashboardQueryRange(
    window,
    dashboardTimeRange,
    timeZone,
  );
  const query = useQuery({
    queryKey: dashboardQueryKeys.detail(userId, "glucose-summary", {
      range,
      sourceSelection: DASHBOARD_SERVER_SOURCE,
      timeZone,
    }),
    queryFn: () => {
      if (!normalizedWindow) {
        throw new Error("Dashboard glucose summary requires a date range");
      }
      return getDashboardGlucoseSummaryByDateRange(
        normalizedWindow.from,
        normalizedWindow.to,
        timeZone,
      );
    },
    enabled: Boolean(userId && normalizedWindow),
    placeholderData: keepPreviousData,
    refetchOnReconnect: false,
    staleTime: DASHBOARD_HISTORICAL_STALE_TIME,
  });
  const hasData = query.data !== undefined;
  const refetch = useVoidRefetch(query.refetch);

  return {
    statistics: query.data?.statistics ?? null,
    timeInRange: query.data?.time_in_range ?? null,
    metadata: query.data?.metadata ?? null,
    isLoading: query.isPending && query.fetchStatus === "fetching",
    isUpdating: query.isFetching && hasData,
    isPreviousData: query.isPlaceholderData,
    error: errorMessage(
      query.error,
      "Failed to load dashboard glucose summary",
    ),
    hasBackgroundError: Boolean(query.error && hasData),
    refetch,
  };
}

export function useDashboardGlucoseStats(
  initialPeriod: DashboardStatsPeriod = "24h",
  window?: HistoryWindow | null,
) {
  const { dashboardTimeRange, timeZone, userId } = useDashboardQueryIdentity();
  const [period, setPeriod] = useState(initialPeriod);
  const { key: range, normalizedWindow } = resolveDashboardQueryRange(
    window,
    dashboardTimeRange,
    timeZone,
  );
  const minutes = normalizedWindow ? null : PERIOD_TO_MINUTES_STATS[period];
  const query = useQuery({
    queryKey: dashboardQueryKeys.detail(userId, "glucose-stats", {
      minutes,
      range,
      sourceSelection: DASHBOARD_SERVER_SOURCE,
    }),
    queryFn: () =>
      normalizedWindow
        ? getGlucoseStatsByDateRange(normalizedWindow.from, normalizedWindow.to)
        : getGlucoseStats(minutes ?? PERIOD_TO_MINUTES_STATS[period]),
    enabled: Boolean(userId),
    placeholderData: keepPreviousData,
    refetchOnReconnect: false,
    staleTime: DASHBOARD_HISTORICAL_STALE_TIME,
  });
  const refetch = useVoidRefetch(query.refetch);
  return {
    stats: (query.data as GlucoseStats | undefined) ?? null,
    isLoading: query.isPending && query.fetchStatus === "fetching",
    isUpdating: query.isFetching && query.data !== undefined,
    isPreviousData: query.isPlaceholderData,
    error: errorMessage(query.error, "Failed to load glucose stats"),
    hasBackgroundError: Boolean(query.error && query.data),
    period,
    setPeriod,
    refetch,
  };
}

export function useDashboardTimeInRangeStats(
  initialPeriod: DashboardStatsPeriod = "24h",
  window?: HistoryWindow | null,
) {
  const { dashboardTimeRange, timeZone, userId } = useDashboardQueryIdentity();
  const [period, setPeriod] = useState(initialPeriod);
  const { key: range, normalizedWindow } = resolveDashboardQueryRange(
    window,
    dashboardTimeRange,
    timeZone,
  );
  const minutes = normalizedWindow ? null : PERIOD_TO_MINUTES_STATS[period];
  const query = useQuery({
    queryKey: dashboardQueryKeys.detail(userId, "time-in-range", {
      minutes,
      range,
      sourceSelection: DASHBOARD_SERVER_SOURCE,
    }),
    queryFn: () =>
      normalizedWindow
        ? getTimeInRangeDetailByDateRange(
            normalizedWindow.from,
            normalizedWindow.to,
          )
        : getTimeInRangeDetailStats(minutes ?? PERIOD_TO_MINUTES_STATS[period]),
    enabled: Boolean(userId),
    placeholderData: keepPreviousData,
    refetchOnReconnect: false,
    staleTime: DASHBOARD_HISTORICAL_STALE_TIME,
  });
  const refetch = useVoidRefetch(query.refetch);
  return {
    stats: (query.data as TimeInRangeDetailStats | undefined) ?? null,
    isLoading: query.isPending && query.fetchStatus === "fetching",
    isUpdating: query.isFetching && query.data !== undefined,
    isPreviousData: query.isPlaceholderData,
    error: errorMessage(query.error, "Failed to load TIR detail"),
    hasBackgroundError: Boolean(query.error && query.data),
    period,
    setPeriod,
    refetch,
  };
}

export function useDashboardBolusReview(
  initialPeriod: DashboardBolusPeriod = "7d",
  window?: HistoryWindow | null,
  limit = 100,
) {
  const { dashboardTimeRange, userId, timeZone } = useDashboardQueryIdentity();
  const [period, setPeriod] = useState(initialPeriod);
  const { key: range, normalizedWindow } = resolveDashboardQueryRange(
    window,
    dashboardTimeRange,
    timeZone,
  );
  const days = normalizedWindow ? null : PERIOD_TO_DAYS[period];
  const offset = 0;
  const query = useQuery({
    queryKey: dashboardQueryKeys.detail(userId, "bolus-review", {
      days,
      limit,
      offset,
      range,
      sourceSelection: DASHBOARD_SERVER_SOURCE,
      timeZone,
    }),
    queryFn: () =>
      normalizedWindow
        ? getBolusReviewByDateRange(
            normalizedWindow.from,
            normalizedWindow.to,
            limit,
            timeZone,
          )
        : getBolusReview(
            days ?? PERIOD_TO_DAYS[period],
            limit,
            offset,
            timeZone,
          ),
    enabled: Boolean(userId),
    placeholderData: keepPreviousData,
    refetchOnReconnect: false,
    staleTime: DASHBOARD_HISTORICAL_STALE_TIME,
  });
  const refetch = useVoidRefetch(query.refetch);
  return {
    data: query.data ?? null,
    isLoading: query.isPending && query.fetchStatus === "fetching",
    isUpdating: query.isFetching && query.data !== undefined,
    isPreviousData: query.isPlaceholderData,
    error: errorMessage(query.error, "Failed to load bolus review"),
    hasBackgroundError: Boolean(query.error && query.data),
    period,
    setPeriod,
    refetch,
  };
}

export function useDashboardPumpEvents(
  period: ChartTimePeriod,
  window?: HistoryWindow | null,
) {
  const { dashboardTimeRange, timeZone, userId } = useDashboardQueryIdentity();
  const { key: range, normalizedWindow } = resolveDashboardQueryRange(
    window,
    dashboardTimeRange,
    timeZone,
  );
  const normalizedNow =
    Math.floor(Date.now() / (5 * 60 * 1000)) * 5 * 60 * 1000;
  const request = calculatePumpEventsRequest(
    period,
    normalizedWindow,
    range?.to === "now" && normalizedWindow
      ? new Date(normalizedWindow.to).getTime()
      : normalizedNow,
  );
  const query = useQuery({
    queryKey: dashboardQueryKeys.detail(userId, "pump-events", {
      limit: request.limit,
      minutes: request.minutes,
      range,
      sourceSelection: DASHBOARD_SERVER_SOURCE,
    }),
    queryFn: () => getPumpEventHistory(request.minutes, request.limit),
    enabled: Boolean(userId),
    placeholderData: keepPreviousData,
    refetchOnReconnect: false,
    staleTime: DASHBOARD_HISTORICAL_STALE_TIME,
  });
  const refetch = useVoidRefetch(query.refetch);
  const events = filterPumpEventsForWindow(
    query.data?.events ?? [],
    normalizedWindow,
  );
  const hasPumpHistory = (query.data?.events ?? []).some((event) =>
    ["basal", "suspend", "resume"].includes(event.event_type),
  );
  return {
    events,
    count: events.length,
    hasPumpHistory,
    isPossiblyTruncated:
      request.isRangeLimited || (query.data?.count ?? 0) >= request.limit,
    isLoading: query.isPending && query.fetchStatus === "fetching",
    isUpdating: query.isFetching && query.data !== undefined,
    isPreviousData: query.isPlaceholderData,
    error: errorMessage(query.error, "Failed to load pump events"),
    hasBackgroundError: Boolean(query.error && query.data),
    refetch,
  };
}

export function useDashboardInsulinSummary(
  initialPeriod: DashboardInsulinPeriod = "14d",
  window?: HistoryWindow | null,
) {
  const { dashboardTimeRange, userId, timeZone } = useDashboardQueryIdentity();
  const [period, setPeriod] = useState(initialPeriod);
  const { key: range, normalizedWindow } = resolveDashboardQueryRange(
    window,
    dashboardTimeRange,
    timeZone,
  );
  const days = normalizedWindow ? null : PERIOD_TO_DAYS[period];
  const query = useQuery({
    queryKey: dashboardQueryKeys.detail(userId, "insulin-summary", {
      days,
      range,
      sourceSelection: DASHBOARD_SERVER_SOURCE,
      timeZone,
    }),
    queryFn: () =>
      normalizedWindow
        ? getInsulinSummaryByDateRange(
            normalizedWindow.from,
            normalizedWindow.to,
            timeZone,
          )
        : getInsulinSummary(days ?? PERIOD_TO_DAYS[period], timeZone),
    enabled: Boolean(userId),
    placeholderData: keepPreviousData,
    refetchOnReconnect: false,
    staleTime: DASHBOARD_HISTORICAL_STALE_TIME,
  });
  const refetch = useVoidRefetch(query.refetch);
  return {
    data: query.data ?? null,
    isLoading: query.isPending && query.fetchStatus === "fetching",
    isUpdating: query.isFetching && query.data !== undefined,
    isPreviousData: query.isPlaceholderData,
    error: errorMessage(query.error, "Failed to load insulin summary"),
    hasBackgroundError: Boolean(query.error && query.data),
    period,
    setPeriod,
    refetch,
  };
}

export function useDashboardPumpStatus() {
  const { userId } = useDashboardQueryIdentity();
  const query = useQuery({
    queryKey: dashboardQueryKeys.resource(userId, "pump-status"),
    queryFn: () => getPumpStatus(),
    enabled: Boolean(userId),
    refetchOnReconnect: true,
    staleTime: DASHBOARD_LIVE_STALE_TIME,
  });
  const data: PumpStatusResponse | undefined = query.data;
  return {
    basal: data?.basal ?? null,
    battery: data?.battery ?? null,
    reservoir: data?.reservoir ?? null,
    loopStatus: data?.loop_status ?? null,
    override: data?.override ?? null,
    cobGrams: data?.cob_grams ?? null,
    isLoading: query.isPending && query.fetchStatus === "fetching",
    isUpdating: query.isFetching && data !== undefined,
    error: query.error,
    hasBackgroundError: Boolean(query.error && data),
  };
}

export function useDashboardForecast() {
  const { userId } = useDashboardQueryIdentity();
  const query = useQuery({
    queryKey: dashboardQueryKeys.resource(userId, "forecast"),
    queryFn: () => getForecast(),
    enabled: Boolean(userId),
    refetchOnReconnect: true,
    staleTime: DASHBOARD_LIVE_STALE_TIME,
  });
  const refetch = query.refetch;
  const refresh = useCallback(async () => {
    await refetch({ throwOnError: true });
  }, [refetch]);
  return {
    forecast: (query.data as ForecastReadResponse | undefined) ?? null,
    isLoading: query.isPending && query.fetchStatus === "fetching",
    isUpdating: query.isFetching && query.data !== undefined,
    error: query.error,
    hasBackgroundError: Boolean(query.error && query.data),
    refresh,
  };
}

const DEFAULT_THRESHOLDS = {
  urgentLow: 55,
  low: 70,
  high: 180,
  urgentHigh: 250,
};

export function useDashboardGlucoseRange() {
  const { userId } = useDashboardQueryIdentity();
  const query = useQuery({
    queryKey: dashboardQueryKeys.resource(userId, "glucose-range"),
    queryFn: () => getTargetGlucoseRange(),
    enabled: Boolean(userId),
    refetchOnReconnect: false,
    staleTime: DASHBOARD_HISTORICAL_STALE_TIME,
  });
  const thresholds = query.data
    ? {
        urgentLow: query.data.urgent_low,
        low: query.data.low_target,
        high: query.data.high_target,
        urgentHigh: query.data.urgent_high,
      }
    : DEFAULT_THRESHOLDS;

  return {
    ...thresholds,
    isUpdating: query.isFetching && query.data !== undefined,
    hasBackgroundError: Boolean(query.error && query.data),
  };
}

const connectionQueryOptions = {
  refetchInterval: DASHBOARD_CONNECTION_POLL_INTERVAL,
  refetchIntervalInBackground: false,
  refetchOnReconnect: true,
  staleTime: DASHBOARD_LIVE_STALE_TIME,
} as const;

export function useDashboardConnectionFreshness() {
  const { userId } = useDashboardQueryIdentity();
  const enabled = Boolean(userId);
  const integrations = useQuery({
    queryKey: dashboardQueryKeys.resource(userId, "integrations"),
    queryFn: () => listIntegrations(),
    enabled,
    ...connectionQueryOptions,
  });
  const nightscout = useQuery({
    queryKey: dashboardQueryKeys.resource(userId, "nightscout-connections"),
    queryFn: () => listNightscoutConnections(),
    enabled,
    ...connectionQueryOptions,
  });
  const cgm = useQuery({
    queryKey: dashboardQueryKeys.resource(userId, "cgm-sources"),
    queryFn: () => getCgmSources(),
    enabled,
    ...connectionQueryOptions,
  });
  const glooko = useQuery({
    queryKey: dashboardQueryKeys.resource(userId, "glooko-status"),
    queryFn: () => getGlookoStatus(),
    enabled,
    ...connectionQueryOptions,
  });
  const medtronic = useQuery({
    queryKey: dashboardQueryKeys.resource(userId, "medtronic-status"),
    queryFn: () => getMedtronicConnectStatus(),
    enabled,
    ...connectionQueryOptions,
  });
  const queries = [integrations, nightscout, cgm, glooko, medtronic];
  const hasAnyData = queries.some((query) => query.data !== undefined);

  return {
    nightscoutConnections:
      (nightscout.data?.connections as
        NightscoutConnectionResponse[] | undefined) ?? [],
    dexcomIntegration:
      (integrations.data?.integrations.find(
        (integration) => integration.integration_type === "dexcom",
      ) as IntegrationResponse | undefined) ?? null,
    tandemIntegration:
      (integrations.data?.integrations.find(
        (integration) => integration.integration_type === "tandem",
      ) as IntegrationResponse | undefined) ?? null,
    cgmSources: (cgm.data as CgmSourcesResponse | undefined) ?? null,
    glookoStatus: (glooko.data as GlookoStatus | undefined) ?? null,
    medtronicStatus:
      (medtronic.data as MedtronicConnectStatus | undefined) ?? null,
    isLoading: queries.some(
      (query) => query.isPending && query.fetchStatus === "fetching",
    ),
    isUpdating: queries.some(
      (query) => query.isFetching && query.data !== undefined,
    ),
    sourcesLoadFailed:
      !hasAnyData && queries.every((query) => Boolean(query.error)),
    hasBackgroundError:
      hasAnyData && queries.some((query) => Boolean(query.error)),
  };
}
