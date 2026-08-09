import {
  getContinuousGlucosePairs,
  MAX_CONTINUOUS_GLUCOSE_INTERVAL_MS,
} from "./glucose-continuity";

interface TestPoint {
  timestampMs: number;
  value: number;
}

describe("getContinuousGlucosePairs", () => {
  const point = (timestampMs: number, value: number): TestPoint => ({
    timestampMs,
    value,
  });

  it("keeps adjacent readings within the continuity interval", () => {
    const first = point(0, 100);
    const second = point(MAX_CONTINUOUS_GLUCOSE_INTERVAL_MS, 110);

    expect(
      getContinuousGlucosePairs([first, second], (item) => item.timestampMs),
    ).toEqual([[first, second]]);
  });

  it("does not connect readings across a data gap", () => {
    const beforeGap = point(0, 100);
    const afterGap = point(MAX_CONTINUOUS_GLUCOSE_INTERVAL_MS + 1, 140);

    expect(
      getContinuousGlucosePairs(
        [beforeGap, afterGap],
        (item) => item.timestampMs,
      ),
    ).toEqual([]);
  });

  it("resumes the line after a data gap", () => {
    const beforeGap = point(0, 100);
    const afterGap = point(MAX_CONTINUOUS_GLUCOSE_INTERVAL_MS + 1, 140);
    const nextReading = point(
      MAX_CONTINUOUS_GLUCOSE_INTERVAL_MS + 5 * 60 * 1000,
      145,
    );

    expect(
      getContinuousGlucosePairs(
        [beforeGap, afterGap, nextReading],
        (item) => item.timestampMs,
      ),
    ).toEqual([[afterGap, nextReading]]);
  });

  it("connects sparse reduced points when the raw series has no gap", () => {
    const first = point(0, 100);
    const second = point(60 * 60 * 1000, 110);

    expect(
      getContinuousGlucosePairs(
        [first, second],
        (item) => item.timestampMs,
        { gaps: [] },
      ),
    ).toEqual([[first, second]]);
  });

  it("does not connect reduced points across an authoritative raw gap", () => {
    const first = point(0, 100);
    const second = point(60 * 60 * 1000, 110);

    expect(
      getContinuousGlucosePairs(
        [first, second],
        (item) => item.timestampMs,
        {
          gaps: [
            {
              start: new Date(10 * 60 * 1000).toISOString(),
              end: new Date(30 * 60 * 1000).toISOString(),
            },
          ],
        },
      ),
    ).toEqual([]);
  });
});
