import type { PumpEventReading } from "@/lib/api";
import {
  buildLegacyBasalAreaSeries,
  buildLegacyBasalChartData,
  buildLegacyBasalModeOverlays,
} from "./glucose-trend-chart";

function makeBasalEvent(index: number, mode: string): PumpEventReading {
  const timestamp = new Date(
    Date.UTC(2026, 6, 1) + index * 5 * 60 * 1000,
  ).toISOString();

  return {
    event_type: "basal",
    event_timestamp: timestamp,
    units: 0.8 + Math.sin(index / 20) * 0.25,
    duration_minutes: 5,
    is_automated: true,
    control_iq_reason: "scheduled",
    pump_activity_mode: mode,
    basal_adjustment_pct: null,
    iob_at_event: null,
    cob_at_event: null,
    bg_at_event: null,
    received_at: timestamp,
    source: "tandem",
  };
}

describe("legacy glucose trend chart performance", () => {
  it("bounds dense basal history while retaining mode transitions", () => {
    const events = Array.from({ length: 5_000 }, (_, index) => {
      const mode =
        Math.floor(index / 144) % 3 === 0
          ? "sleep"
          : Math.floor(index / 144) % 3 === 1
            ? "normal"
            : "exercise";
      return makeBasalEvent(index, mode);
    });

    const points = buildLegacyBasalChartData(events);
    const transitionTimestamps = events
      .filter(
        (event, index) =>
          index === 0 ||
          event.pump_activity_mode !== events[index - 1].pump_activity_mode,
      )
      .map((event) => new Date(event.event_timestamp).getTime());

    expect(points).toHaveLength(500);
    expect(points[0].timestamp).toBe(
      new Date(events[0].event_timestamp).getTime(),
    );
    expect(points.at(-1)?.timestamp).toBe(
      new Date(events.at(-1)!.event_timestamp).getTime(),
    );
    const renderedTimestamps = new Set(points.map((point) => point.timestamp));
    for (const timestamp of transitionTimestamps) {
      expect(renderedTimestamps).toContain(timestamp);
    }

    const series = buildLegacyBasalAreaSeries(
      points,
      points.at(-1)!.timestamp + 5 * 60 * 1000,
    );
    expect(series).toHaveLength(3);
  });

  it("coalesces adjacent activity samples into bounded overlay regions", () => {
    const events = Array.from({ length: 5_000 }, (_, index) =>
      makeBasalEvent(index, index < 2_500 ? "sleep" : "exercise"),
    );
    const points = buildLegacyBasalChartData(events);
    const overlays = buildLegacyBasalModeOverlays(
      points,
      points.at(-1)!.timestamp + 5 * 60 * 1000,
    );

    expect(overlays).toHaveLength(2);
    expect(overlays.map((overlay) => overlay.mode)).toEqual([
      "sleep",
      "exercise",
    ]);
  });
});
