import { render, screen } from "@testing-library/react";

import { DashboardChartPanels } from "./DashboardChartPanels";

const mockUseDashboardBolusReview = jest.fn();
const mockUseDashboardGlucoseHistory = jest.fn();
const mockUseDashboardPumpEvents = jest.fn();
const mockTimelineChart = jest.fn();
const mockAgpChart = jest.fn();

jest.mock("@/hooks/dashboard-query", () => ({
  useDashboardBolusReview: (...args: unknown[]) =>
    mockUseDashboardBolusReview(...args),
  useDashboardGlucoseHistory: (...args: unknown[]) =>
    mockUseDashboardGlucoseHistory(...args),
  useDashboardPumpEvents: (...args: unknown[]) =>
    mockUseDashboardPumpEvents(...args),
}));

jest.mock("@/components/DashboardTimeRangeProvider", () => ({
  useDashboardTimeRange: () => ({
    currentWindow: {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-04T00:00:00.000Z",
    },
  }),
}));

jest.mock("@/components/DashboardTimelineChart", () => ({
  DashboardTimelineChart: (props: unknown) => {
    mockTimelineChart(props);
    return <div data-testid="timeline-chart" />;
  },
}));

jest.mock("@/components/AgpChart", () => ({
  V2AgpChartView: (props: unknown) => {
    mockAgpChart(props);
    return <div data-testid="agp-chart" />;
  },
}));

describe("DashboardChartPanels", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDashboardGlucoseHistory.mockReturnValue({ period: "3h" });
    mockUseDashboardBolusReview.mockReturnValue({ data: { boluses: [] } });
    mockUseDashboardPumpEvents.mockReturnValue({ events: [] });
  });

  it("loads timeline resources once and shares glucose history with AGP", () => {
    render(
      <DashboardChartPanels>
        <div data-testid="summary-panels" />
      </DashboardChartPanels>,
    );

    const window = {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-04T00:00:00.000Z",
    };
    expect(mockUseDashboardGlucoseHistory).toHaveBeenCalledTimes(1);
    expect(mockUseDashboardGlucoseHistory).toHaveBeenCalledWith("3h", window);
    expect(mockUseDashboardBolusReview).toHaveBeenCalledTimes(1);
    expect(mockUseDashboardBolusReview).toHaveBeenCalledWith(
      "24h",
      window,
      500,
    );
    expect(mockUseDashboardPumpEvents).toHaveBeenCalledTimes(1);
    expect(mockUseDashboardPumpEvents).toHaveBeenCalledWith("3h", window);

    const timelineProps = mockTimelineChart.mock.calls[0][0];
    const agpProps = mockAgpChart.mock.calls[0][0];
    expect(timelineProps.queryData.glucose).toBe(
      mockUseDashboardGlucoseHistory.mock.results[0].value,
    );
    expect(agpProps.queryData).toBe(timelineProps.queryData.glucose);
    expect(screen.getByTestId("summary-panels")).toBeInTheDocument();
  });
});
