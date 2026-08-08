import { renderHook, waitFor } from "@testing-library/react";
import { createElement, StrictMode } from "react";

import { getUnreadInsightsCount } from "@/lib/api";

import {
  clearUnreadInsightsCountCache,
  useUnreadInsightsCount,
} from "./use-unread-insights-count";

jest.mock("@/lib/api", () => ({
  getUnreadInsightsCount: jest.fn(),
}));

const mockGetUnreadInsightsCount =
  getUnreadInsightsCount as jest.MockedFunction<typeof getUnreadInsightsCount>;

beforeEach(() => {
  mockGetUnreadInsightsCount.mockReset();
  clearUnreadInsightsCountCache();
});

describe("useUnreadInsightsCount", () => {
  it("fetches the unread count when enabled", async () => {
    mockGetUnreadInsightsCount.mockResolvedValue(7);

    const { result } = renderHook(() => useUnreadInsightsCount(true, "user-1"));

    await waitFor(() => expect(result.current).toBe(7));
    expect(mockGetUnreadInsightsCount).toHaveBeenCalledTimes(1);
  });

  it("does not fetch when disabled", () => {
    const { result } = renderHook(() =>
      useUnreadInsightsCount(false, "user-1"),
    );

    expect(result.current).toBe(0);
    expect(mockGetUnreadInsightsCount).not.toHaveBeenCalled();
  });

  it("shares one initial request across navigation consumers and Strict Mode", async () => {
    mockGetUnreadInsightsCount.mockResolvedValue(4);

    const { result } = renderHook(
      () => [
        useUnreadInsightsCount(true, "user-1"),
        useUnreadInsightsCount(true, "user-1"),
      ],
      {
        wrapper: ({ children }) => createElement(StrictMode, null, children),
      },
    );

    await waitFor(() => expect(result.current).toEqual([4, 4]));
    expect(mockGetUnreadInsightsCount).toHaveBeenCalledTimes(1);
  });

  it("does not reuse an unread count across users", async () => {
    mockGetUnreadInsightsCount
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(2);

    const { result, rerender } = renderHook(
      ({ userId }: { userId: string }) => useUnreadInsightsCount(true, userId),
      { initialProps: { userId: "user-1" } },
    );

    await waitFor(() => expect(result.current).toBe(7));

    rerender({ userId: "user-2" });
    expect(result.current).toBe(0);
    await waitFor(() => expect(result.current).toBe(2));
    expect(mockGetUnreadInsightsCount).toHaveBeenCalledTimes(2);
  });
});
