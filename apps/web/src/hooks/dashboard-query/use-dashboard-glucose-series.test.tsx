import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";

import { getGlucoseSeries, type GlucoseSeriesResponse } from "@/lib/api";
import type { DashboardGlucoseSeriesData } from "@/lib/glucose/series-resolution";
import {
  DASHBOARD_HISTORICAL_STALE_TIME,
  dashboardQueryKeys,
} from "@/lib/query/dashboard";
import { useUserContext } from "@/providers/user-provider";

import { useDashboardGlucoseSeries } from "./use-dashboard-glucose-series";

jest.mock("@/lib/api", () => ({
  getGlucoseSeries: jest.fn(),
}));
jest.mock("@/providers/user-provider", () => ({
  useUserContext: jest.fn(),
}));

const mockGetGlucoseSeries = jest.mocked(getGlucoseSeries);
const mockUseUserContext = jest.mocked(useUserContext);
const fullWindow = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-02T00:00:00.000Z",
};
const targetWindow = {
  from: "2026-08-01T10:00:00.000Z",
  to: "2026-08-01T12:00:00.000Z",
};

function reading(timestamp: string, value = 110) {
  return {
    value,
    reading_timestamp: timestamp,
    trend: "flat",
    trend_rate: 0,
    received_at: timestamp,
    source: "dexcom",
  };
}

function response(
  overrides: Partial<GlucoseSeriesResponse["metadata"]> = {},
): GlucoseSeriesResponse {
  const readings = [reading("2026-08-01T11:00:00.000Z")];
  return {
    readings,
    metadata: {
      requested_max_data_points: 320,
      raw_reading_count: readings.length,
      returned_point_count: readings.length,
      reduction_mode: "raw",
      bucket_interval_ms: null,
      timeline_revision: "a".repeat(64),
      applied_window: { start: fullWindow.from, end: fullWindow.to },
      source_selection: {
        requested: "primary",
        excluded_sources: [],
      },
      continuity: { max_gap_ms: 900_000, gaps: [] },
      ...overrides,
    },
  };
}

function cachedData(
  overrides: Partial<DashboardGlucoseSeriesData> = {},
): DashboardGlucoseSeriesData {
  return {
    readings: [reading("2026-08-01T11:00:00.000Z")],
    requestedWindow: fullWindow,
    coverageWindow: fullWindow,
    maxDataPoints: 320,
    resolutionMode: "raw",
    bucketIntervalMs: null,
    timelineRevision: "a".repeat(64),
    sourceSelection: "primary",
    sourceRawReadingCount: 1,
    continuity: { max_gap_ms: 900_000, gaps: [] },
    ...overrides,
  };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useDashboardGlucoseSeries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseUserContext.mockReturnValue({
      user: { id: "user-1" },
      isLoading: false,
      error: null,
      refreshUser: jest.fn(),
    } as unknown as ReturnType<typeof useUserContext>);
  });

  it("waits for width and requests no more than the measured CSS pixels", async () => {
    mockGetGlucoseSeries.mockResolvedValue(response());
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      ({ width }) => useDashboardGlucoseSeries(width, "3h", fullWindow),
      {
        initialProps: { width: null as number | null },
        wrapper: createWrapper(queryClient),
      },
    );

    expect(mockGetGlucoseSeries).not.toHaveBeenCalled();
    expect(view.result.current.isLoading).toBe(true);

    view.rerender({ width: 320.9 });
    await waitFor(() => expect(mockGetGlucoseSeries).toHaveBeenCalledTimes(1));
    expect(view.result.current.resolutionMode).toBe("raw");
    expect(mockGetGlucoseSeries).toHaveBeenCalledWith(
      fullWindow.from,
      fullWindow.to,
      320,
    );
  });

  it("waits for the initial layout to settle before requesting a series", async () => {
    mockGetGlucoseSeries.mockResolvedValue(
      response({ requested_max_data_points: 640 }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      ({ width }) => useDashboardGlucoseSeries(width, "3h", fullWindow),
      {
        initialProps: { width: 320 },
        wrapper: createWrapper(queryClient),
      },
    );

    view.rerender({ width: 640 });

    await waitFor(() => expect(mockGetGlucoseSeries).toHaveBeenCalledTimes(1));
    expect(mockGetGlucoseSeries.mock.calls[0]?.[2]).toBe(640);
  });

  it("reuses a relative range cache while its live edge remains fresh", async () => {
    mockGetGlucoseSeries.mockResolvedValueOnce(response());
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);
    const relativeRange = { from: "now-24h", to: "now" };
    const first = renderHook(
      () => useDashboardGlucoseSeries(320, "3h", fullWindow, relativeRange),
      { wrapper },
    );
    await waitFor(() => expect(first.result.current.readings).toHaveLength(1));
    first.unmount();

    const shiftedWindow = {
      from: "2026-08-01T00:01:00.000Z",
      to: "2026-08-02T00:01:00.000Z",
    };
    const second = renderHook(
      () => useDashboardGlucoseSeries(320, "3h", shiftedWindow, relativeRange),
      { wrapper },
    );

    await waitFor(() => expect(second.result.current.readings).toHaveLength(1));
    expect(mockGetGlucoseSeries).toHaveBeenCalledTimes(1);
    expect(second.result.current.isUpdating).toBe(false);
  });

  it("reuses raw data on shrink and growth without another request", async () => {
    mockGetGlucoseSeries.mockResolvedValue(response());
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      ({ width }) => useDashboardGlucoseSeries(width, "3h", fullWindow),
      {
        initialProps: { width: 320 },
        wrapper: createWrapper(queryClient),
      },
    );
    await waitFor(() => expect(view.result.current.readings).toHaveLength(1));

    view.rerender({ width: 200 });
    view.rerender({ width: 640 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    expect(mockGetGlucoseSeries).toHaveBeenCalledTimes(1);
  });

  it("fetches finer data after meaningful growth when reduced data is insufficient", async () => {
    mockGetGlucoseSeries
      .mockResolvedValueOnce(
        response({
          reduction_mode: "reduced",
          bucket_interval_ms: 1_800_000,
          raw_reading_count: 1_000,
        }),
      )
      .mockResolvedValueOnce(
        response({
          requested_max_data_points: 640,
          reduction_mode: "reduced",
          bucket_interval_ms: 600_000,
          raw_reading_count: 1_000,
        }),
      );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      ({ width }) => useDashboardGlucoseSeries(width, "3h", fullWindow),
      {
        initialProps: { width: 320 },
        wrapper: createWrapper(queryClient),
      },
    );
    await waitFor(() => expect(view.result.current.readings).toHaveLength(1));

    view.rerender({ width: 640 });
    await waitFor(() => expect(mockGetGlucoseSeries).toHaveBeenCalledTimes(2), {
      timeout: 1_000,
    });
    expect(mockGetGlucoseSeries.mock.calls[1]?.[2]).toBe(640);
  });

  it("slices fresh sufficient covering cache without a request", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      dashboardQueryKeys.detail("user-1", "glucose-series", {
        maxDataPoints: 320,
        range: fullWindow,
        sourceSelection: "server-primary",
      }),
      cachedData(),
    );

    const view = renderHook(
      () => useDashboardGlucoseSeries(320, "3h", targetWindow),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(view.result.current.readings).toHaveLength(1));
    expect(mockGetGlucoseSeries).not.toHaveBeenCalled();
    expect(view.result.current.metadata?.requestedWindow).toEqual(targetWindow);
  });

  it("reuses a fresh raw relative superset for a shorter range", async () => {
    mockGetGlucoseSeries.mockResolvedValueOnce(response());
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);
    const view = renderHook(
      ({ cacheRange, window }) =>
        useDashboardGlucoseSeries(320, "3h", window, cacheRange),
      {
        initialProps: {
          cacheRange: { from: "now-24h", to: "now" },
          window: fullWindow,
        },
        wrapper,
      },
    );
    await waitFor(() => expect(view.result.current.readings).toHaveLength(1));

    const shorterWindow = {
      from: "2026-08-01T10:00:00.000Z",
      to: "2026-08-02T00:00:05.000Z",
    };
    view.rerender({
      cacheRange: { from: "now-6h", to: "now" },
      window: shorterWindow,
    });

    expect(view.result.current.isLoading).toBe(false);
    expect(view.result.current.readings).toHaveLength(1);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    expect(mockGetGlucoseSeries).toHaveBeenCalledTimes(1);
    expect(view.result.current.metadata?.requestedWindow).toEqual(
      shorterWindow,
    );

    view.rerender({
      cacheRange: { from: "now-24h", to: "now" },
      window: fullWindow,
    });

    expect(view.result.current.isLoading).toBe(false);
    expect(view.result.current.readings).toHaveLength(1);
    expect(mockGetGlucoseSeries).toHaveBeenCalledTimes(1);
  });

  it("refreshes a shorter relative range when the raw superset is stale", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      dashboardQueryKeys.detail("user-1", "glucose-series", {
        maxDataPoints: 320,
        range: { from: "now-24h", to: "now" },
        sourceSelection: "server-primary",
      }),
      cachedData(),
      { updatedAt: Date.now() - DASHBOARD_HISTORICAL_STALE_TIME - 1 },
    );
    mockGetGlucoseSeries.mockReturnValue(new Promise(() => undefined));
    const shorterWindow = {
      from: "2026-08-01T10:00:00.000Z",
      to: "2026-08-02T00:00:05.000Z",
    };

    const view = renderHook(
      () =>
        useDashboardGlucoseSeries(320, "3h", shorterWindow, {
          from: "now-6h",
          to: "now",
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(mockGetGlucoseSeries).toHaveBeenCalledTimes(1));
    expect(mockGetGlucoseSeries).toHaveBeenCalledWith(
      shorterWindow.from,
      shorterWindow.to,
      320,
    );
    expect(view.result.current.readings).toHaveLength(1);
    expect(view.result.current.isLoading).toBe(false);
    expect(view.result.current.isPreviousData).toBe(true);
    expect(view.result.current.isUpdating).toBe(true);
  });

  it("shows insufficient covering data while the required request loads", async () => {
    mockGetGlucoseSeries.mockReturnValue(new Promise(() => undefined));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      dashboardQueryKeys.detail("user-1", "glucose-series", {
        maxDataPoints: 320,
        range: fullWindow,
        sourceSelection: "server-primary",
      }),
      cachedData({
        resolutionMode: "reduced",
        bucketIntervalMs: 21_600_000,
      }),
    );

    const view = renderHook(
      () => useDashboardGlucoseSeries(320, "3h", targetWindow),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(mockGetGlucoseSeries).toHaveBeenCalledTimes(1));
    expect(mockGetGlucoseSeries).toHaveBeenCalledWith(
      targetWindow.from,
      targetWindow.to,
      320,
    );
    expect(view.result.current.readings).toHaveLength(1);
    expect(view.result.current.isPreviousData).toBe(true);
    expect(view.result.current.isUpdating).toBe(true);
  });

  it("never displays cached readings from a disjoint window", async () => {
    const disjointWindow = {
      from: "2026-08-03T00:00:00.000Z",
      to: "2026-08-04T00:00:00.000Z",
    };
    mockGetGlucoseSeries
      .mockResolvedValueOnce(response())
      .mockReturnValueOnce(new Promise(() => undefined));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      ({ window }) => useDashboardGlucoseSeries(320, "3h", window),
      {
        initialProps: { window: fullWindow },
        wrapper: createWrapper(queryClient),
      },
    );
    await waitFor(() => expect(view.result.current.readings).toHaveLength(1));

    view.rerender({ window: disjointWindow });

    await waitFor(() => expect(mockGetGlucoseSeries).toHaveBeenCalledTimes(2));
    expect(view.result.current.readings).toHaveLength(0);
  });

  it("exposes optimized endpoint errors without a legacy fallback", async () => {
    mockGetGlucoseSeries.mockRejectedValue(new Error("Series unavailable"));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      () => useDashboardGlucoseSeries(320, "3h", fullWindow),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() =>
      expect(view.result.current.error).toBe("Series unavailable"),
    );
    expect(mockGetGlucoseSeries).toHaveBeenCalledTimes(1);
  });
});
