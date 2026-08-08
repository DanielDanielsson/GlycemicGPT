"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { useUserContext } from "@/providers/user-provider";
import { getGlucoseSeries } from "@/lib/api";
import { type ChartTimePeriod } from "@/lib/chart-periods";
import type { HistoryWindow } from "@/lib/glucose/history-selection";
import type { RawTimeRangeInput } from "@/lib/glucose/time-range-expressions";
import {
  deriveGlucoseSeriesForWindow,
  GLUCOSE_SERIES_GROWTH_THRESHOLD_PX,
  GLUCOSE_SERIES_RESIZE_DEBOUNCE_MS,
  isGlucoseSeriesSufficient,
  normalizeGlucoseSeriesPointBudget,
  toDashboardGlucoseSeriesData,
  windowCovers,
  type DashboardGlucoseSeriesData,
} from "@/lib/glucose/series-resolution";
import {
  DASHBOARD_HISTORICAL_STALE_TIME,
  DASHBOARD_QUERY_GC_TIME,
  DASHBOARD_SERVER_SOURCE,
  dashboardQueryKeys,
  normalizeHistoryWindow,
} from "@/lib/query/dashboard";

interface CachedSeriesCandidate {
  data: DashboardGlucoseSeriesData;
  updatedAt: number;
}

interface RequestedBudgetState {
  windowKey: string;
  value: number;
}

function cachedSeriesCoversTarget(
  data: DashboardGlucoseSeriesData,
  targetWindow: NonNullable<ReturnType<typeof normalizeHistoryWindow>>,
  endToleranceMs: number,
  allowRawPartialLiveTail: boolean,
): boolean {
  if (windowCovers(data.coverageWindow, targetWindow)) return true;
  if (data.resolutionMode !== "raw") return false;

  const coverageFromMs = new Date(data.coverageWindow.from).getTime();
  const coverageToMs = new Date(data.coverageWindow.to).getTime();
  const targetFromMs = new Date(targetWindow.from).getTime();
  const targetToMs = new Date(targetWindow.to).getTime();

  if (
    allowRawPartialLiveTail &&
    coverageFromMs <= targetFromMs &&
    coverageToMs > targetFromMs
  ) {
    return true;
  }

  if (endToleranceMs <= 0) return false;

  return (
    coverageFromMs <= targetFromMs &&
    coverageToMs < targetToMs &&
    targetToMs - coverageToMs <= endToleranceMs
  );
}

// Do not consume React Query's abort signal in this V2 hook. Development
// Strict Mode remounts would otherwise cancel the first series request and
// immediately issue the same request again. Range specific keys keep late
// responses isolated from the active selection.

function normalizedWindowKey(window: HistoryWindow | null): string | null {
  return window ? `${window.from}\u0000${window.to}` : null;
}

function findCachedSeries(
  queryClient: ReturnType<typeof useQueryClient>,
  userId: string,
  targetWindow: NonNullable<ReturnType<typeof normalizeHistoryWindow>>,
  targetMaxDataPoints: number,
  options: {
    allowRawPartialLiveTail: boolean;
    endToleranceMs: number;
    freshnessMs: number;
    requireFresh: boolean;
    requireSufficient: boolean;
  },
): CachedSeriesCandidate | null {
  const now = Date.now();
  const candidates = queryClient
    .getQueryCache()
    .findAll({
      queryKey: dashboardQueryKeys.resource(userId, "glucose-series"),
    })
    .flatMap<CachedSeriesCandidate>((query) => {
      const data = query.state.data as DashboardGlucoseSeriesData | undefined;
      if (!data || data.sourceSelection !== "primary") return [];
      if (
        !cachedSeriesCoversTarget(
          data,
          targetWindow,
          options.endToleranceMs,
          options.allowRawPartialLiveTail,
        )
      ) {
        return [];
      }
      if (
        options.requireFresh &&
        now - query.state.dataUpdatedAt > options.freshnessMs
      ) {
        return [];
      }
      if (
        options.requireSufficient &&
        data.resolutionMode !== "raw" &&
        !isGlucoseSeriesSufficient(data, targetWindow, targetMaxDataPoints)
      ) {
        return [];
      }
      return [{ data, updatedAt: query.state.dataUpdatedAt }];
    });

  candidates.sort((left, right) => {
    const leftDuration =
      new Date(left.data.coverageWindow.to).getTime() -
      new Date(left.data.coverageWindow.from).getTime();
    const rightDuration =
      new Date(right.data.coverageWindow.to).getTime() -
      new Date(right.data.coverageWindow.from).getTime();
    return leftDuration - rightDuration || right.updatedAt - left.updatedAt;
  });
  return candidates[0] ?? null;
}

export function useDashboardGlucoseSeries(
  plotWidth: number | null,
  initialPeriod: ChartTimePeriod = "3h",
  window?: HistoryWindow | null,
  cacheRange?: RawTimeRangeInput | null,
) {
  const { user } = useUserContext();
  const userId = user?.id ?? "";
  const queryClient = useQueryClient();
  const normalizedWindow = normalizeHistoryWindow(window);
  const windowKey = normalizedWindowKey(normalizedWindow);
  const usesRelativeCacheRange = Boolean(
    cacheRange &&
    (cacheRange.from.includes("now") || cacheRange.to.includes("now")),
  );
  const measuredBudget = normalizeGlucoseSeriesPointBudget(plotWidth);
  const [period, setPeriod] = useState<ChartTimePeriod>(initialPeriod);
  const [requestedBudget, setRequestedBudget] =
    useState<RequestedBudgetState | null>(null);
  const activeBudget =
    requestedBudget?.windowKey === windowKey
      ? requestedBudget.value
      : requestedBudget && measuredBudget != null
        ? measuredBudget
        : null;

  const reusable = useMemo(() => {
    if (!userId || !normalizedWindow || activeBudget == null) return null;
    return findCachedSeries(
      queryClient,
      userId,
      normalizedWindow,
      activeBudget,
      {
        allowRawPartialLiveTail: false,
        endToleranceMs: usesRelativeCacheRange
          ? DASHBOARD_HISTORICAL_STALE_TIME
          : 0,
        freshnessMs: DASHBOARD_HISTORICAL_STALE_TIME,
        requireFresh: true,
        requireSufficient: true,
      },
    );
  }, [
    activeBudget,
    normalizedWindow,
    queryClient,
    userId,
    usesRelativeCacheRange,
  ]);

  const query = useQuery({
    queryKey: dashboardQueryKeys.detail(userId, "glucose-series", {
      maxDataPoints: activeBudget,
      range: cacheRange ?? normalizedWindow,
      sourceSelection: DASHBOARD_SERVER_SOURCE,
    }),
    queryFn: async () => {
      if (!normalizedWindow || activeBudget == null) {
        throw new Error("Glucose series requires a measured chart window");
      }
      const response = await getGlucoseSeries(
        normalizedWindow.from,
        normalizedWindow.to,
        activeBudget,
      );
      return toDashboardGlucoseSeriesData(response, normalizedWindow);
    },
    enabled: Boolean(userId && normalizedWindow && activeBudget != null),
    gcTime: DASHBOARD_QUERY_GC_TIME,
    initialData: reusable
      ? deriveGlucoseSeriesForWindow(
          reusable.data,
          normalizedWindow!,
          activeBudget!,
        )
      : undefined,
    initialDataUpdatedAt: reusable?.updatedAt,
    placeholderData: () => {
      if (!userId || !normalizedWindow || activeBudget == null) {
        return undefined;
      }
      const covering = findCachedSeries(
        queryClient,
        userId,
        normalizedWindow,
        activeBudget,
        {
          allowRawPartialLiveTail: usesRelativeCacheRange,
          endToleranceMs: usesRelativeCacheRange
            ? DASHBOARD_HISTORICAL_STALE_TIME
            : 0,
          freshnessMs: DASHBOARD_HISTORICAL_STALE_TIME,
          requireFresh: false,
          requireSufficient: false,
        },
      );
      return covering
        ? deriveGlucoseSeriesForWindow(
            covering.data,
            normalizedWindow,
            activeBudget,
          )
        : undefined;
    },
    refetchOnMount: usesRelativeCacheRange ? true : false,
    refetchOnReconnect: false,
    select: (data) =>
      normalizedWindow && activeBudget != null
        ? deriveGlucoseSeriesForWindow(data, normalizedWindow, activeBudget)
        : data,
    staleTime: usesRelativeCacheRange
      ? reusable
        ? DASHBOARD_HISTORICAL_STALE_TIME
        : 0
      : DASHBOARD_HISTORICAL_STALE_TIME,
  });

  useEffect(() => {
    if (!windowKey || measuredBudget == null) return undefined;

    if (
      requestedBudget?.windowKey === windowKey &&
      measuredBudget <=
        requestedBudget.value + GLUCOSE_SERIES_GROWTH_THRESHOLD_PX
    ) {
      return undefined;
    }

    const timeout = globalThis.setTimeout(() => {
      if (
        requestedBudget?.windowKey === windowKey &&
        query.data &&
        normalizedWindow &&
        isGlucoseSeriesSufficient(query.data, normalizedWindow, measuredBudget)
      ) {
        return;
      }
      setRequestedBudget({ windowKey, value: measuredBudget });
    }, GLUCOSE_SERIES_RESIZE_DEBOUNCE_MS);

    return () => globalThis.clearTimeout(timeout);
  }, [
    measuredBudget,
    normalizedWindow,
    query.data,
    requestedBudget,
    windowKey,
  ]);

  const hasData = query.data !== undefined;
  const isMeasuring = Boolean(normalizedWindow && activeBudget == null);

  return {
    readings: query.data?.readings ?? [],
    metadata: query.data ?? null,
    continuity: query.data?.continuity ?? null,
    resolutionMode: query.data?.resolutionMode ?? null,
    isLoading:
      isMeasuring || (query.isPending && query.fetchStatus === "fetching"),
    isUpdating: query.isFetching && hasData,
    isPreviousData: query.isPlaceholderData,
    error: query.error
      ? query.error.message || "Failed to load glucose series"
      : null,
    hasBackgroundError: Boolean(query.error && hasData),
    period,
    setPeriod,
    refetch: () => {
      void query.refetch();
    },
  };
}
