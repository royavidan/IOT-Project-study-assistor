import { describe, expect, it } from "vitest";

import { computeTrend, type DailyPoint } from "@/lib/focus/trends";

const line = (slope: number, n = 12, noise = 0): DailyPoint[] =>
  Array.from({ length: n }, (_, t) => ({
    t,
    v: 50 + slope * t + (noise ? (t % 2 ? noise : -noise) : 0),
  }));

describe("computeTrend", () => {
  it("calls a clear upward trajectory 'rising' with the CI above 0", () => {
    const r = computeTrend(line(2));
    expect(r.direction).toBe("rising");
    expect(r.slopePerWeek).toBeCloseTo(14, 5); // 2/day * 7
    expect(r.slopeCI[0]).toBeGreaterThan(0);
    expect(r.confidence).toBe("high");
  });

  it("calls a clear downward trajectory 'falling'", () => {
    const r = computeTrend(line(-1.5));
    expect(r.direction).toBe("falling");
    expect(r.slopePerWeek).toBeLessThan(0);
  });

  it("reads flat/noisy data as 'flat' (CI brackets 0) — never over-reads noise", () => {
    const r = computeTrend(line(0, 12, 5)); // zero slope + zig-zag noise
    expect(r.direction).toBe("flat");
    expect(r.slopeCI[0]).toBeLessThanOrEqual(0);
    expect(r.slopeCI[1]).toBeGreaterThanOrEqual(0);
  });

  it("weights recent days more in the level (EWMA)", () => {
    // Level should sit above the simple midpoint for a rising series.
    const r = computeTrend(line(2));
    const simpleMid = 50 + 2 * 5.5; // mean of a 0..11 ramp
    expect(r.level).toBeGreaterThan(simpleMid);
  });

  it("degrades to low-confidence flat with < 2 points", () => {
    expect(computeTrend([]).direction).toBe("flat");
    expect(computeTrend([{ t: 0, v: 50 }]).confidence).toBe("low");
  });
});
