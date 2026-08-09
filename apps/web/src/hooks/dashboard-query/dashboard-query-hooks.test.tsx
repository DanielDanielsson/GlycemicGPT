import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";

import {
  getBolusReviewByDateRange,
  getDashboardGlucoseSummaryByDateRange,
  getGlucoseHistoryByDateRange,
  getGlucosePercentilesByDateRange,
  getPumpEventHistory,
  type GlucoseHistoryResponse,
} from "@/lib/api";
import { useOptionalDashboardTimeRange } from "@/components/DashboardTimeRangeProvider";
import { useUserContext } from "@/providers/user-provider";

import {
  useDashboardBolusReview,
  useDashboardGlucoseHistory,
  useDashboardGlucosePercentiles,
  useDashboardGlucoseSummary,
  useDashboardPumpEvents,
} from "./dashboard-query-hooks";

jest.mock("@/lib/api", () => ({
  getBolusReviewByDateRange: jest.fn(),
  getDashboardGlucoseSummaryByDateRange: jest.fn(),
  getGlucoseHistoryByDateRange: jest.fn(),
  getGlucosePercentilesByDateRange: jest.fn(),
  getPumpEventHistory: jest.fn(),
}));
jest.mock("@/providers/user-provider", () => ({
  useUserContext: jest.fn(),
}));
jest.mock("@/components/DashboardTimeRangeProvider", () => ({
  useOptionalDashboardTimeRange: jest.fn(),
}));

const mockGetGlucoseHistoryByDateRange = jest.mocked(
  getGlucoseHistoryByDateRange,
);
const mockGetDashboardGlucoseSummaryByDateRange = jest.mocked(
  getDashboardGlucoseSummaryByDateRange,
);
const mockGetGlucosePercentilesByDateRange = jest.mocked(
  getGlucosePercentilesByDateRange,
);
const mockGetBolusReviewByDateRange = jest.mocked(getBolusReviewByDateRange);
const mockGetPumpEventHistory = jest.mocked(getPumpEventHistory);
const mockUseUserContext = jest.mocked(useUserContext);
const mockUseOptionalDashboardTimeRange = jest.mocked(
  useOptionalDashboardTimeRange,
);
const firstWindow = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-02T00:00:00.000Z",
};
const secondWindow = {
  from: "2026-07-31T00:00:00.000Z",
  to: "2026-08-02T00:00:00.000Z",
};
const firstResponse: GlucoseHistoryResponse = {
  count: 1,
  readings: [
    {
      value: 110,
      reading_timestamp: "2026-08-01T12:00:00.000Z",
      trend: "Flat",
      trend_rate: 0,
      received_at: "2026-08-01T12:00:01.000Z",
      source: "test",
    },
  ],
};

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function createStrictWrapper(queryClient: QueryClient) {
  return function StrictWrapper({ children }: { children: React.ReactNode }) {
    return (
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </StrictMode>
    );
  };
}

describe("V2 dashboard query hooks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseUserContext.mockReturnValue({
      user: { id: "user-1" },
      isLoading: false,
      error: null,
      refreshUser: jest.fn(),
    } as unknown as ReturnType<typeof useUserContext>);
    mockUseOptionalDashboardTimeRange.mockReturnValue(null);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("deduplicates concurrent consumers and reuses fresh data after remount", async () => {
    mockGetGlucoseHistoryByDateRange.mockResolvedValue(firstResponse);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);
    const first = renderHook(
      () => [
        useDashboardGlucoseHistory("24h", firstWindow),
        useDashboardGlucoseHistory("24h", firstWindow),
      ],
      { wrapper },
    );
    await waitFor(() =>
      expect(first.result.current[0].readings).toHaveLength(1),
    );
    expect(mockGetGlucoseHistoryByDateRange).toHaveBeenCalledTimes(1);
    first.unmount();

    const revisit = renderHook(
      () => useDashboardGlucoseHistory("24h", firstWindow),
      { wrapper },
    );
    expect(revisit.result.current.readings).toHaveLength(1);
    expect(mockGetGlucoseHistoryByDateRange).toHaveBeenCalledTimes(1);
  });

  it("keeps the initial request alive through a development Strict Mode remount", async () => {
    mockGetGlucoseHistoryByDateRange.mockResolvedValue(firstResponse);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const view = renderHook(
      () => useDashboardGlucoseHistory("24h", firstWindow),
      { wrapper: createStrictWrapper(queryClient) },
    );

    await waitFor(() => expect(view.result.current.readings).toHaveLength(1));
    expect(mockGetGlucoseHistoryByDateRange).toHaveBeenCalledTimes(1);
  });

  it("loads compact percentile buckets for the exact dashboard range", async () => {
    mockGetGlucosePercentilesByDateRange.mockResolvedValue({
      buckets: [
        { hour: 0, p10: 80, p25: 90, p50: 110, p75: 130, p90: 150, count: 8 },
      ],
      period_days: 1,
      readings_count: 8,
      is_truncated: false,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(() => useDashboardGlucosePercentiles(firstWindow), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(view.result.current.buckets).toHaveLength(1));
    expect(mockGetGlucosePercentilesByDateRange).toHaveBeenCalledWith(
      firstWindow.from,
      firstWindow.to,
      expect.any(String),
    );
    expect(mockGetGlucoseHistoryByDateRange).not.toHaveBeenCalled();
  });

  it("loads statistics and time in range from one atomic summary request", async () => {
    mockGetDashboardGlucoseSummaryByDateRange.mockResolvedValue({
      statistics: {
        mean_glucose: 110,
        std_dev: 20,
        min_glucose: 70,
        max_glucose: 180,
        cv_pct: 18.2,
        gmi: 5.9,
        cgm_active_pct: 99.3,
        readings_count: 286,
        period_minutes: 1440,
      },
      time_in_range: {
        buckets: [],
        readings_count: 286,
        previous_buckets: [],
        previous_readings_count: 288,
        thresholds: {
          urgent_low: 55,
          low: 70,
          high: 180,
          urgent_high: 250,
        },
      },
      metadata: {
        applied_window: { start: firstWindow.from, end: firstWindow.to },
        comparison_window: {
          start: "2026-07-31T00:00:00.000Z",
          end: firstWindow.from,
        },
        time_zone: "UTC",
        readings_count: 286,
        is_truncated: false,
        glucose_revision: "a".repeat(64),
        target_range_revision: "b".repeat(64),
        calculation_revision: "c".repeat(64),
        source_selection: { requested: "primary", excluded_sources: [] },
        target_range: {
          urgent_low: 55,
          low: 70,
          high: 180,
          urgent_high: 250,
        },
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(() => useDashboardGlucoseSummary(firstWindow), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() =>
      expect(view.result.current.statistics?.readings_count).toBe(286),
    );
    expect(view.result.current.timeInRange?.readings_count).toBe(286);
    expect(mockGetDashboardGlucoseSummaryByDateRange).toHaveBeenCalledWith(
      firstWindow.from,
      firstWindow.to,
      expect.any(String),
    );
  });

  it("issues one initial request for each shared timeline resource", async () => {
    mockGetGlucoseHistoryByDateRange.mockResolvedValue(firstResponse);
    mockGetBolusReviewByDateRange.mockResolvedValue({
      boluses: [],
      period_days: 1,
      total_count: 0,
    });
    mockGetPumpEventHistory.mockResolvedValue({ count: 0, events: [] });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const view = renderHook(
      () => ({
        glucose: useDashboardGlucoseHistory("3h", firstWindow),
        insulin: useDashboardBolusReview("24h", firstWindow, 500),
        pump: useDashboardPumpEvents("3h", firstWindow),
      }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(view.result.current.glucose.isLoading).toBe(false);
      expect(view.result.current.insulin.isLoading).toBe(false);
      expect(view.result.current.pump.isLoading).toBe(false);
    });
    expect(mockGetGlucoseHistoryByDateRange).toHaveBeenCalledTimes(1);
    expect(mockGetBolusReviewByDateRange).toHaveBeenCalledTimes(1);
    expect(mockGetPumpEventHistory).toHaveBeenCalledTimes(1);
  });

  it("keeps previous data visible while a new range loads", async () => {
    let resolveSecond: ((value: GlucoseHistoryResponse) => void) | undefined;
    mockGetGlucoseHistoryByDateRange
      .mockResolvedValueOnce(firstResponse)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);
    const view = renderHook(
      ({ window }) => useDashboardGlucoseHistory("24h", window),
      { initialProps: { window: firstWindow }, wrapper },
    );
    await waitFor(() => expect(view.result.current.readings).toHaveLength(1));

    view.rerender({ window: secondWindow });
    await waitFor(() => expect(view.result.current.isUpdating).toBe(true));
    expect(view.result.current.isPreviousData).toBe(true);
    expect(view.result.current.readings[0]?.value).toBe(110);

    await act(async () => {
      resolveSecond?.({ count: 0, readings: [] });
    });
    await waitFor(() => expect(view.result.current.isUpdating).toBe(false));
  });

  it("keeps cached data visible when a background refresh fails", async () => {
    mockGetGlucoseHistoryByDateRange.mockResolvedValueOnce(firstResponse);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      () => useDashboardGlucoseHistory("24h", firstWindow),
      { wrapper: createWrapper(queryClient) },
    );
    await waitFor(() => expect(view.result.current.readings).toHaveLength(1));

    mockGetGlucoseHistoryByDateRange.mockRejectedValueOnce(
      new Error("Refresh failed"),
    );
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["dashboard", "user-1", "glucose-history"],
      });
    });

    await waitFor(() =>
      expect(view.result.current.hasBackgroundError).toBe(true),
    );
    expect(view.result.current.readings).toEqual(firstResponse.readings);
    expect(view.result.current.error).toBe("Refresh failed");
    expect(view.result.current.isLoading).toBe(false);
  });

  it("keeps an obsolete range request alive while loading the new range", async () => {
    const resolveRequests: Array<(value: GlucoseHistoryResponse) => void> = [];
    mockGetGlucoseHistoryByDateRange.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequests.push(resolve);
        }),
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      ({ window }) => useDashboardGlucoseHistory("24h", window),
      {
        initialProps: { window: firstWindow },
        wrapper: createWrapper(queryClient),
      },
    );
    await waitFor(() =>
      expect(mockGetGlucoseHistoryByDateRange).toHaveBeenCalledTimes(1),
    );

    view.rerender({ window: secondWindow });
    await waitFor(() =>
      expect(mockGetGlucoseHistoryByDateRange).toHaveBeenCalledTimes(2),
    );
    expect(mockGetGlucoseHistoryByDateRange.mock.calls[0]).toHaveLength(3);
    expect(mockGetGlucoseHistoryByDateRange.mock.calls[1]).toHaveLength(3);

    await act(async () => {
      resolveRequests.forEach((resolve) => resolve(firstResponse));
    });
  });

  it("evicts inactive dashboard data after five minutes", async () => {
    jest.useFakeTimers();
    mockGetGlucoseHistoryByDateRange.mockResolvedValue(firstResponse);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      () => useDashboardGlucoseHistory("24h", firstWindow),
      { wrapper: createWrapper(queryClient) },
    );
    await act(async () => {
      await Promise.resolve();
    });
    view.unmount();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);

    act(() => {
      jest.advanceTimersByTime(5 * 60 * 1000);
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("restarts the five minute eviction timer after a revisit", async () => {
    jest.useFakeTimers();
    mockGetGlucoseHistoryByDateRange.mockResolvedValue(firstResponse);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);
    const firstVisit = renderHook(
      () => useDashboardGlucoseHistory("24h", firstWindow),
      { wrapper },
    );
    await act(async () => {
      await Promise.resolve();
    });
    firstVisit.unmount();

    act(() => {
      jest.advanceTimersByTime(4 * 60 * 1000);
    });
    const revisit = renderHook(
      () => useDashboardGlucoseHistory("24h", firstWindow),
      { wrapper },
    );
    act(() => {
      jest.advanceTimersByTime(2 * 60 * 1000);
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);

    revisit.unmount();
    act(() => {
      jest.advanceTimersByTime(5 * 60 * 1000 - 1);
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("reuses a preset cache entry when its resolved now window changes", async () => {
    const firstSevenDayWindow = {
      from: "2026-07-26T00:00:00.000Z",
      to: "2026-08-02T00:00:00.000Z",
    };
    const shiftedSevenDayWindow = {
      from: "2026-07-26T00:01:00.000Z",
      to: "2026-08-02T00:01:00.000Z",
    };
    let currentWindow = firstSevenDayWindow;
    mockUseOptionalDashboardTimeRange.mockImplementation(
      () =>
        ({
          currentWindow,
          label: "Last 7 days",
          selection: { kind: "preset", range: "7d" },
          setSelection: jest.fn(),
          timeZone: "UTC",
        }) as ReturnType<typeof useOptionalDashboardTimeRange>,
    );
    mockGetGlucoseHistoryByDateRange.mockResolvedValue(firstResponse);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = createWrapper(queryClient);
    const firstVisit = renderHook(
      () => useDashboardGlucoseHistory("24h", currentWindow),
      { wrapper },
    );
    await waitFor(() =>
      expect(firstVisit.result.current.readings).toHaveLength(1),
    );
    firstVisit.unmount();

    currentWindow = shiftedSevenDayWindow;
    const revisit = renderHook(
      () => useDashboardGlucoseHistory("24h", currentWindow),
      { wrapper },
    );

    expect(revisit.result.current.readings).toHaveLength(1);
    expect(mockGetGlucoseHistoryByDateRange).toHaveBeenCalledTimes(1);
  });
});
