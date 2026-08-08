import { act, render, screen } from "@testing-library/react";

import type { DashboardChartQueryData } from "@/components/DashboardChartQueryAdapters/DashboardChartQueryAdapters";
import { DashboardTimelineChart } from "./DashboardTimelineChart";

const mockDesktopTimelineRuntime = jest.fn();
const mockMergedRuntime = jest.fn();

jest.mock("@/components/GlucoseTrendChart", () => ({
  GlucoseTrendChartView: (props: unknown) => {
    mockDesktopTimelineRuntime(props);
    return <div data-testid="desktop-timeline-runtime" />;
  },
}));

jest.mock("@/components/MergedGlucoseTrendChart", () => ({
  MergedGlucoseTrendChartView: ({
    presentation,
    ...props
  }: {
    presentation: "mobile" | "desktop";
    onPlotWidthChange?: (width: number) => void;
  }) => {
    mockMergedRuntime(presentation, props);
    return <div data-testid={`${presentation}-merged-runtime`} />;
  },
}));

const queryData = {} as DashboardChartQueryData;

function installMatchMedia(initialWidth: number) {
  let width = initialWidth;
  const listeners = new Set<() => void>();

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: jest.fn((query: string) => ({
      matches:
        query === "(min-width: 1024px)"
          ? width >= 1024
          : query === "(min-width: 768px)"
            ? width >= 768
            : false,
      media: query,
      onchange: null,
      addEventListener: (_event: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_event: string, listener: () => void) => {
        listeners.delete(listener);
      },
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });

  return (nextWidth: number) => {
    width = nextWidth;
    act(() => {
      for (const listener of listeners) listener();
    });
  };
}

describe("DashboardTimelineChart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    [390, "mobile-merged-runtime"],
    [800, "desktop-merged-runtime"],
    [1200, "desktop-timeline-runtime"],
  ])("mounts only the active runtime at %ipx", (width, expectedTestId) => {
    installMatchMedia(width as number);

    render(<DashboardTimelineChart queryData={queryData} />);

    expect(screen.getByTestId(expectedTestId as string)).toBeInTheDocument();
    expect(
      screen.queryAllByTestId(/(?:merged|timeline)-runtime$/),
    ).toHaveLength(1);
  });

  it("switches runtimes without retaining hidden presentations", () => {
    const resizeTo = installMatchMedia(390);

    render(<DashboardTimelineChart queryData={queryData} />);
    expect(screen.getByTestId("mobile-merged-runtime")).toBeInTheDocument();

    resizeTo(800);
    expect(screen.getByTestId("desktop-merged-runtime")).toBeInTheDocument();
    expect(
      screen.queryByTestId("mobile-merged-runtime"),
    ).not.toBeInTheDocument();

    resizeTo(1200);
    expect(screen.getByTestId("desktop-timeline-runtime")).toBeInTheDocument();
    expect(
      screen.queryByTestId("desktop-merged-runtime"),
    ).not.toBeInTheDocument();
    expect(mockMergedRuntime).toHaveBeenCalledTimes(2);
    expect(mockDesktopTimelineRuntime).toHaveBeenCalledTimes(1);
  });

  it.each([
    [390, "merged"],
    [800, "merged"],
    [1200, "desktop"],
  ])("hides the loading status at %ipx", (width, runtime) => {
    installMatchMedia(width as number);

    render(<DashboardTimelineChart queryData={queryData} />);

    if (runtime === "merged") {
      expect(mockMergedRuntime.mock.calls[0][1].showUpdatingStatus).toBe(false);
    } else {
      expect(
        mockDesktopTimelineRuntime.mock.calls[0][0].showUpdatingStatus,
      ).toBe(false);
    }
  });

  it("renders no expensive runtime before a browser breakpoint is available", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });

    render(<DashboardTimelineChart queryData={queryData} />);

    expect(
      screen.getByLabelText("Loading glucose trend chart"),
    ).toBeInTheDocument();
    expect(mockMergedRuntime).not.toHaveBeenCalled();
    expect(mockDesktopTimelineRuntime).not.toHaveBeenCalled();
  });

  it.each([
    [390, "merged"],
    [800, "merged"],
    [1200, "desktop"],
  ])(
    "forwards plot measurement at %ipx to the active runtime",
    (width, runtime) => {
      installMatchMedia(width as number);
      const onPlotWidthChange = jest.fn();

      render(
        <DashboardTimelineChart
          onPlotWidthChange={onPlotWidthChange}
          queryData={queryData}
        />,
      );

      if (runtime === "merged") {
        expect(mockMergedRuntime.mock.calls[0][1].onPlotWidthChange).toBe(
          onPlotWidthChange,
        );
      } else {
        expect(
          mockDesktopTimelineRuntime.mock.calls[0][0].onPlotWidthChange,
        ).toBe(onPlotWidthChange);
      }
    },
  );

  it.each([
    [800, "merged"],
    [1200, "desktop"],
  ])(
    "forwards zoom changes at %ipx to the active desktop runtime",
    (width, runtime) => {
      installMatchMedia(width as number);
      const onZoomDomainChange = jest.fn();

      render(
        <DashboardTimelineChart
          onZoomDomainChange={onZoomDomainChange}
          queryData={queryData}
        />,
      );

      if (runtime === "merged") {
        expect(mockMergedRuntime.mock.calls[0][1].onZoomDomainChange).toBe(
          onZoomDomainChange,
        );
      } else {
        expect(
          mockDesktopTimelineRuntime.mock.calls[0][0].onZoomDomainChange,
        ).toBe(onZoomDomainChange);
      }
    },
  );

  it("clears the zoom query when the chart switches to mobile", () => {
    const resizeTo = installMatchMedia(1200);
    const onZoomDomainChange = jest.fn();

    render(
      <DashboardTimelineChart
        onZoomDomainChange={onZoomDomainChange}
        queryData={queryData}
      />,
    );
    expect(onZoomDomainChange).not.toHaveBeenCalled();

    resizeTo(390);
    expect(onZoomDomainChange).toHaveBeenLastCalledWith(null);
  });
});
