import { describe, expect, it } from "vitest";

import { computeSessionDynamics, type SessionSeriesPoint } from "@/lib/focus/session-dynamics";

function pt(
  tMin: number,
  focus: number | null,
  noise: number | null = null,
  lightLux: number | null = null,
): SessionSeriesPoint {
  return { tMin, focus, noise, tempC: null, lightLux };
}

describe("computeSessionDynamics", () => {
  it("returns an empty result when there are no focus samples", () => {
    const d = computeSessionDynamics([]);
    expect(d.nSamples).toBe(0);
    expect(d.loadSlope).toBe(0);
    expect(d.loadMean).toBe(0);
  });

  it("detects rising strain across a session (positive loadSlope)", () => {
    const series = [10, 20, 30, 40, 50, 60].map((v, i) => pt(i + 1, v));
    const d = computeSessionDynamics(series);
    expect(d.nSamples).toBe(6);
    expect(d.loadSlope).toBeGreaterThan(0); // load climbed
    expect(d.loadMean).toBeCloseTo(35, 5);
    expect(d.loadPeak).toBe(60);
  });

  it("reads a flat, calm session as low slope and low volatility", () => {
    const series = [30, 30, 30, 30, 30].map((v, i) => pt(i + 1, v));
    const d = computeSessionDynamics(series);
    expect(Math.abs(d.loadSlope)).toBeLessThan(1e-6);
    expect(d.loadVolatility).toBeCloseTo(0, 5);
    expect(d.sustainedHighShare).toBe(0); // all below HIGH_LOAD (60)
  });

  it("computes the sustained-high-load share against HIGH_LOAD", () => {
    const series = [70, 80, 40, 90, 20].map((v, i) => pt(i + 1, v));
    const d = computeSessionDynamics(series);
    expect(d.sustainedHighShare).toBeCloseTo(3 / 5, 5); // 70,80,90 >= 60
  });

  it("summarizes noise (mean/volatility/peak) and light volatility", () => {
    const series = [pt(1, 30, 0.2, 100), pt(2, 30, 0.4, 300), pt(3, 30, 0.6, 100)];
    const d = computeSessionDynamics(series);
    expect(d.noiseMean).toBeCloseTo(0.4, 5);
    expect(d.noisePeak).toBeCloseTo(0.6, 5);
    expect(d.noiseVolatility).toBeGreaterThan(0);
    expect(d.lightVolatility).toBeGreaterThan(0);
  });

  it("finds positive noise→load coupling when noise leads load", () => {
    // Noise rises a minute before load rises → positive lag-1 coupling.
    const series = [pt(1, 20, 0.2), pt(2, 30, 0.4), pt(3, 45, 0.6), pt(4, 60, 0.8), pt(5, 75, 0.9)];
    const d = computeSessionDynamics(series);
    expect(d.envNoiseCoupling).toBeGreaterThan(0.5);
  });

  it("keeps slope at 0 when there are too few samples to fit", () => {
    const d = computeSessionDynamics([pt(1, 20), pt(2, 80)]);
    expect(d.nSamples).toBe(2);
    expect(d.loadSlope).toBe(0);
    expect(d.loadMean).toBeCloseTo(50, 5);
  });
});
