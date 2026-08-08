import { resolveGlucoseRenderMode } from "./glucose-render-mode";

describe("resolveGlucoseRenderMode", () => {
  it("always renders reduced series as lines", () => {
    expect(resolveGlucoseRenderMode(120, 1_200, "reduced")).toBe("line");
  });

  it("keeps sparse raw readings as points", () => {
    expect(resolveGlucoseRenderMode(120, 1_200, "raw")).toBe("points");
  });

  it("renders dense raw readings as lines", () => {
    expect(resolveGlucoseRenderMode(300, 1_200, "raw")).toBe("line");
  });

  it("preserves legacy sparse point behavior without series metadata", () => {
    expect(resolveGlucoseRenderMode(120, 1_200)).toBe("points");
  });
});
