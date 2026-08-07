import { act, render, screen } from "@testing-library/react";

import type { DashboardChartQueryData } from "@/components/DashboardChartQueryAdapters/DashboardChartQueryAdapters";
import { DashboardTimelineChart } from "./DashboardTimelineChart";

const mockDesktopTimelineRuntime = jest.fn();
const mockMergedRuntime = jest.fn();

jest.mock("@/components/GlucoseTrendChart", () => ({
  GlucoseTrendChartView: () => {
    mockDesktopTimelineRuntime();
    return <div data-testid="desktop-timeline-runtime" />;
  },
}));

jest.mock("@/components/MergedGlucoseTrendChart", () => ({
  MergedGlucoseTrendChartView: ({
    presentation,
  }: {
    presentation: "mobile" | "desktop";
  }) => {
    mockMergedRuntime(presentation);
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
});
