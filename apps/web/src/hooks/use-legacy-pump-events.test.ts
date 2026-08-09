import { renderHook, waitFor } from "@testing-library/react";
import { getPumpEventHistory } from "@/lib/api";
import { useLegacyPumpEvents } from "./use-legacy-pump-events";

jest.mock("@/lib/api", () => ({
  getPumpEventHistory: jest.fn(),
}));

const mockGetPumpEventHistory = jest.mocked(getPumpEventHistory);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPumpEventHistory.mockResolvedValue({ events: [], count: 0 });
});

describe("useLegacyPumpEvents", () => {
  it("keeps a 24 hour request inside the selected legacy chart period", async () => {
    const { result } = renderHook(() => useLegacyPumpEvents("24h"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockGetPumpEventHistory).toHaveBeenCalledWith(1440, 1000);
  });
});
