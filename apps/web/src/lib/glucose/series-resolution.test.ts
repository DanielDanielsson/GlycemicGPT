import type { GlucoseSeriesResponse } from "@/lib/api";

import {
  deriveGlucoseSeriesForWindow,
  isGlucoseSeriesSufficient,
  normalizeGlucoseSeriesPointBudget,
  resolveGlucoseSeriesIntervalMs,
  toDashboardGlucoseSeriesData,
} from "./series-resolution";

const fullWindow = {
  from: "2026-08-01T00:00:00.000Z",
  to: "2026-08-08T00:00:00.000Z",
};

function response(
  overrides: Partial<GlucoseSeriesResponse["metadata"]> = {},
): GlucoseSeriesResponse {
  const readings = Array.from({ length: 8 }, (_, index) => ({
    value: [100, 40, 300, 120, 125, 130, 135, 110][index],
    reading_timestamp: new Date(
      Date.UTC(2026, 7, 1, 0, index * 2),
    ).toISOString(),
    trend: "flat",
    trend_rate: 0,
    received_at: new Date(Date.UTC(2026, 7, 1, 0, index * 2)).toISOString(),
    source: "dexcom",
  }));
  return {
    readings,
    metadata: {
      requested_max_data_points: 640,
      raw_reading_count: readings.length,
      returned_point_count: readings.length,
      reduction_mode: "raw",
      bucket_interval_ms: null,
      timeline_revision: "a".repeat(64),
      applied_window: {
        start: fullWindow.from,
        end: fullWindow.to,
      },
      source_selection: {
        requested: "primary",
        excluded_sources: [],
      },
      continuity: { max_gap_ms: 900_000, gaps: [] },
      ...overrides,
    },
  };
}

describe("glucose series resolution", () => {
  it("caps the point budget without exceeding the measured plot width", () => {
    expect(normalizeGlucoseSeriesPointBudget(639.9)).toBe(639);
    expect(normalizeGlucoseSeriesPointBudget(4)).toBe(4);
    expect(normalizeGlucoseSeriesPointBudget(3)).toBeNull();
    expect(normalizeGlucoseSeriesPointBudget(4_000)).toBe(2_000);
  });

  it("matches the server nice interval calculation", () => {
    expect(resolveGlucoseSeriesIntervalMs(fullWindow, 640)).toBe(7_200_000);
  });

  it("treats raw covering data as sufficient for narrower windows", () => {
    const data = toDashboardGlucoseSeriesData(response(), fullWindow);
    expect(
      isGlucoseSeriesSufficient(
        data,
        {
          from: "2026-08-02T00:00:00.000Z",
          to: "2026-08-03T00:00:00.000Z",
        },
        320,
      ),
    ).toBe(true);
  });

  it("requires reduced covering data to meet the target interval", () => {
    const coarse = toDashboardGlucoseSeriesData(
      response({ reduction_mode: "reduced", bucket_interval_ms: 21_600_000 }),
      fullWindow,
    );
    const detailed = toDashboardGlucoseSeriesData(
      response({ reduction_mode: "reduced", bucket_interval_ms: 1_800_000 }),
      fullWindow,
    );
    const target = {
      from: "2026-08-02T00:00:00.000Z",
      to: "2026-08-03T00:00:00.000Z",
    };

    expect(isGlucoseSeriesSufficient(coarse, target, 320)).toBe(false);
    expect(isGlucoseSeriesSufficient(detailed, target, 320)).toBe(true);
  });

  it("slices and strictly reduces cached covering data by excursions", () => {
    const data = toDashboardGlucoseSeriesData(response(), fullWindow);
    const target = {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-01T00:20:00.000Z",
    };

    const derived = deriveGlucoseSeriesForWindow(data, target, 4);

    expect(derived.readings.map((reading) => reading.value)).toEqual([
      100, 40, 300, 110,
    ]);
    expect(derived.readings).toHaveLength(4);
    expect(derived.resolutionMode).toBe("reduced");
    expect(derived.bucketIntervalMs).toBe(1_800_000);
    expect(derived.coverageWindow).toEqual(target);
  });

  it("preserves distinct extrema that share a timestamp", () => {
    const source = response();
    const reading = source.readings[0];
    source.readings = [
      { ...reading, value: 100, reading_timestamp: "2026-08-01T00:00:00.000Z" },
      { ...reading, value: 20, reading_timestamp: "2026-08-01T00:05:00.000Z" },
      { ...reading, value: 500, reading_timestamp: "2026-08-01T00:05:00.000Z" },
      { ...reading, value: 120, reading_timestamp: "2026-08-01T00:10:00.000Z" },
      { ...reading, value: 125, reading_timestamp: "2026-08-01T00:15:00.000Z" },
      { ...reading, value: 130, reading_timestamp: "2026-08-01T00:19:00.000Z" },
    ];
    source.metadata.raw_reading_count = source.readings.length;
    source.metadata.returned_point_count = source.readings.length;
    const data = toDashboardGlucoseSeriesData(source, fullWindow);
    const target = {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-01T00:20:00.000Z",
    };

    const derived = deriveGlucoseSeriesForWindow(data, target, 4);

    expect(derived.readings.map((item) => item.value)).toEqual([
      100, 20, 500, 130,
    ]);
  });

  it("keeps only continuity gaps that overlap a cached target window", () => {
    const data = toDashboardGlucoseSeriesData(
      response({
        continuity: {
          max_gap_ms: 900_000,
          gaps: [
            {
              start: "2026-08-01T00:05:00.000Z",
              end: "2026-08-01T00:30:00.000Z",
            },
            {
              start: "2026-08-05T00:05:00.000Z",
              end: "2026-08-05T00:30:00.000Z",
            },
          ],
        },
      }),
      fullWindow,
    );
    const target = {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-02T00:00:00.000Z",
    };

    const derived = deriveGlucoseSeriesForWindow(data, target, 640);

    expect(derived.continuity.gaps).toEqual([
      {
        start: "2026-08-01T00:05:00.000Z",
        end: "2026-08-01T00:30:00.000Z",
      },
    ]);
  });
});
