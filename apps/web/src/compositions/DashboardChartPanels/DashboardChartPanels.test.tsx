import { act, render, screen } from "@testing-library/react";

import { DashboardChartPanels } from "./DashboardChartPanels";

const mockUseDashboardBolusReview = jest.fn();
const mockUseDashboardGlucoseSeries = jest.fn();
const mockUseDashboardPumpEvents = jest.fn();
const mockTimelineChart = jest.fn();
const mockAgpChart = jest.fn();

jest.mock("@/hooks/dashboard-query", () => ({
  useDashboardBolusReview: (...args: unknown[]) =>
    mockUseDashboardBolusReview(...args),
  useDashboardGlucoseSeries: (...args: unknown[]) =>
    mockUseDashboardGlucoseSeries(...args),
  useDashboardPumpEvents: (...args: unknown[]) =>
    mockUseDashboardPumpEvents(...args),
}));

jest.mock("@/components/DashboardTimeRangeProvider", () => ({
  useDashboardTimeRange: () => ({
    selection: { kind: "preset", range: "7d" },
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
  V2AgpChart: (props: unknown) => {
    mockAgpChart(props);
    return <div data-testid="agp-chart" />;
  },
}));

describe("DashboardChartPanels", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDashboardGlucoseSeries.mockReturnValue({ period: "3h" });
    mockUseDashboardBolusReview.mockReturnValue({ data: { boluses: [] } });
    mockUseDashboardPumpEvents.mockReturnValue({ events: [] });
  });

  it("loads the timeline from the measured series while AGP stays independent", () => {
    render(
      <DashboardChartPanels>
        <div data-testid="summary-panels" />
      </DashboardChartPanels>,
    );

    const window = {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-04T00:00:00.000Z",
    };
    expect(mockUseDashboardGlucoseSeries).toHaveBeenCalledWith(
      null,
      "3h",
      window,
      { from: "now-168h", to: "now" },
    );
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
      mockUseDashboardGlucoseSeries.mock.results[0].value,
    );
    expect(agpProps.queryData).toBeUndefined();

    act(() => timelineProps.onPlotWidthChange(641.8));
    expect(mockUseDashboardGlucoseSeries).toHaveBeenLastCalledWith(
      641.8,
      "3h",
      window,
      { from: "now-168h", to: "now" },
    );

    const zoomWindow = {
      from: "2026-08-02T10:00:00.000Z",
      to: "2026-08-02T13:00:00.000Z",
    };
    act(() => {
      timelineProps.onZoomDomainChange([
        Date.parse(zoomWindow.from),
        Date.parse(zoomWindow.to),
      ]);
    });
    expect(mockUseDashboardGlucoseSeries).toHaveBeenLastCalledWith(
      641.8,
      "3h",
      zoomWindow,
      zoomWindow,
    );

    act(() => timelineProps.onZoomDomainChange(null));
    expect(mockUseDashboardGlucoseSeries).toHaveBeenLastCalledWith(
      641.8,
      "3h",
      window,
      { from: "now-168h", to: "now" },
    );
    expect(screen.getByTestId("summary-panels")).toBeInTheDocument();
  });
});
