import { describe, expect, it } from "vitest";

import type { UserBaselines } from "@/lib/focus/baselines";
import { composeFocusState, tirednessToEnergy } from "@/lib/focus/focus-state";
import type { Driver, FocusModel, TirednessPrediction } from "@/lib/focus/model";
import type { TrendResult } from "@/lib/focus/trends";

const baselines = (nSessions: number): UserBaselines => ({ nSessions, metrics: {} });

const model = (over: Partial<FocusModel> = {}): FocusModel => ({
  coefficients: [],
  nLabels: 14,
  cv: { mae: 0.6, r2: 0.5, preds: [] },
  residualStd: 0.6,
  usedPersonalData: true,
  ...over,
});

const prediction = (value: number, drivers: Driver[] = []): TirednessPrediction => ({
  value,
  ci: [value - 0.6, value + 0.6],
  drivers,
});

const flatTrend: TrendResult = {
  level: 50,
  slopePerWeek: 0,
  slopeCI: [-1, 1],
  direction: "flat",
  confidence: "medium",
  nPoints: 10,
};

const risingTrend: TrendResult = {
  ...flatTrend,
  direction: "rising",
  confidence: "high",
  slopePerWeek: 5,
};

describe("tirednessToEnergy", () => {
  it("maps the 1..5 tiredness scale to a 0..100 energy score (inverted)", () => {
    expect(tirednessToEnergy(1)).toBe(100);
    expect(tirednessToEnergy(3)).toBe(50);
    expect(tirednessToEnergy(5)).toBe(0);
  });
});

describe("composeFocusState", () => {
  it("turns high predicted tiredness into low energy + a 'Running low' headline", () => {
    const est = composeFocusState({
      prediction: prediction(4.5),
      model: model(),
      baselines: baselines(20),
      trend: flatTrend,
    });
    expect(est.energyScore).toBeLessThan(20);
    expect(est.headline).toBe("Running low");
    // Energy CI is ordered lo <= score <= hi.
    expect(est.energyCI[0]).toBeLessThanOrEqual(est.energyScore);
    expect(est.energyCI[1]).toBeGreaterThanOrEqual(est.energyScore);
  });

  it("turns low predicted tiredness into high energy", () => {
    const est = composeFocusState({
      prediction: prediction(1.5),
      model: model(),
      baselines: baselines(20),
      trend: flatTrend,
    });
    expect(est.energyScore).toBeGreaterThan(80);
    expect(est.headline).toBe("High focus energy");
  });

  it("reports a validated-accuracy reliability line when calibrated", () => {
    const est = composeFocusState({
      prediction: prediction(3),
      model: model({ cv: { mae: 0.6, r2: 0.5, preds: [] } }),
      baselines: baselines(20),
      trend: flatTrend,
    });
    expect(est.reliability.basis).toBe("personal");
    expect(est.reliability.validatedMae).toBeCloseTo(0.6, 5);
    expect(est.reliability.label).toMatch(/±0\.6/);
    expect(est.reliability.label).toMatch(/your own baseline/);
  });

  it("reports a 'still learning' reliability line when uncalibrated", () => {
    const est = composeFocusState({
      prediction: prediction(3),
      model: model({ cv: null, nLabels: 4, usedPersonalData: false }),
      baselines: baselines(4),
      trend: flatTrend,
    });
    expect(est.reliability.validatedMae).toBeNull();
    expect(est.reliability.label).toMatch(/learning your patterns/);
    expect(est.reliability.basis).toBe("blended");
  });

  it("speaks the trajectory only when the trend is confident, and surfaces top drivers", () => {
    const drivers: Driver[] = [
      { key: "loadMean", label: "Session load", contribution: 0.4 },
      { key: "noiseMean", label: "Noise", contribution: 0.15 },
      { key: "loadSlope", label: "Strain climbed", contribution: 0.01 }, // below threshold -> dropped
    ];
    const est = composeFocusState({
      prediction: prediction(3.5, drivers),
      model: model(),
      baselines: baselines(20),
      trend: risingTrend,
    });
    expect(est.detail).toMatch(/trending toward more strain/);
    expect(est.drivers).toHaveLength(2); // the 0.01 driver is filtered out
    expect(est.drivers[0].key).toBe("loadMean");
  });
});
