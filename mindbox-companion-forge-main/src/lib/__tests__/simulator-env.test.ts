import { describe, expect, it } from "vitest";

import { DEFAULT_SIM_ENV, randomSimulatorEnv } from "@/features/simulator/simulator-env";

describe("randomSimulatorEnv", () => {
  it("returns values within expected sensor ranges", () => {
    const env = randomSimulatorEnv();
    expect(env.noiseAvg).toBeGreaterThanOrEqual(0.2);
    expect(env.noiseAvg).toBeLessThanOrEqual(0.7);
    expect(env.tempC).toBeGreaterThanOrEqual(20);
    expect(env.tempC).toBeLessThanOrEqual(26);
    expect(env.lightLux).toBeGreaterThanOrEqual(150);
    expect(env.lightLux).toBeLessThanOrEqual(550);
    expect(env.lightVariance).toBeGreaterThanOrEqual(0.1);
    expect(env.lightVariance).toBeLessThanOrEqual(0.6);
  });

  it("exposes stable defaults for the form", () => {
    expect(DEFAULT_SIM_ENV.noiseAvg).toBe(0.35);
    expect(DEFAULT_SIM_ENV.tempC).toBe(22);
    expect(DEFAULT_SIM_ENV.lightLux).toBe(300);
  });
});
