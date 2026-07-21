import { describe, expect, it } from "vitest";

import { computeBaselines } from "@/lib/focus/baselines";
import {
  FEATURE_PRIORS,
  fitFocusModel,
  MIN_PERSONAL_LABELS,
  predictTiredness,
  PRIOR_INTERCEPT,
  type LabeledSample,
} from "@/lib/focus/model";
import { normalize } from "@/lib/focus/baselines";

// Build sessions whose only varying feature is loadMean, with tiredness a known
// linear function of the per-user-normalized load: tiredness = 2.5 + 0.5·z(load).
function syntheticSamples(n: number): LabeledSample[] {
  const rows: Record<string, number>[] = [];
  for (let i = 0; i < n; i += 1) {
    const loadMean = 20 + (60 * i) / (n - 1); // spread 20..80
    rows.push({
      loadMean,
      loadSlope: 0,
      sustainedHighShare: 0.3,
      sessionMinutes: 50,
      noiseMean: 0.4,
      presenceInterruptions: 1,
      recentStrainEwma: 120,
    });
  }
  const baselines = computeBaselines(rows, FEATURE_PRIORS);
  const samples = rows.map((features) => ({
    features,
    tiredness: 2.5 + 0.5 * normalize(baselines, "loadMean", features.loadMean),
  }));
  return samples;
}

describe("fitFocusModel", () => {
  it("recovers the true driver from the tiredness labels (calibration works)", () => {
    const samples = syntheticSamples(20);
    const baselines = computeBaselines(
      samples.map((s) => s.features),
      FEATURE_PRIORS,
    );
    const model = fitFocusModel(samples, baselines);

    expect(model.usedPersonalData).toBe(true);
    const loadCoef = model.coefficients[0]; // loadMean is feature 0
    // Sits between the heuristic prior (0.25) and the true 0.5 — partial pooling.
    expect(loadCoef).toBeGreaterThan(0.3);
    expect(loadCoef).toBeLessThanOrEqual(0.5);
    // Non-varying features keep ~their prior coefficient (data can't move them).
    expect(model.coefficients[4]).toBeCloseTo(0.1, 1); // noiseMean prior
    // Honest validated accuracy is reported and good on this clean relationship.
    expect(model.cv).not.toBeNull();
    expect(model.cv!.r2).toBeGreaterThan(0.9);
    expect(model.cv!.mae).toBeLessThan(0.2);
  });

  it("falls back to the heuristic prior when labels are too sparse", () => {
    const samples = syntheticSamples(20).slice(0, MIN_PERSONAL_LABELS - 1);
    const baselines = computeBaselines(
      samples.map((s) => s.features),
      FEATURE_PRIORS,
    );
    const model = fitFocusModel(samples, baselines);
    expect(model.usedPersonalData).toBe(false);
    expect(model.cv).toBeNull();
    expect(model.coefficients[0]).toBeCloseTo(0.25, 5); // pure prior loadMean coef
    expect(model.coefficients[model.coefficients.length - 1]).toBeCloseTo(PRIOR_INTERCEPT, 5);
  });
});

describe("predictTiredness", () => {
  it("predicts higher tiredness for a heavy session than a light one", () => {
    const samples = syntheticSamples(20);
    const baselines = computeBaselines(
      samples.map((s) => s.features),
      FEATURE_PRIORS,
    );
    const model = fitFocusModel(samples, baselines);

    const base = { ...samples[0].features };
    const heavy = predictTiredness(model, { ...base, loadMean: 85 }, baselines);
    const light = predictTiredness(model, { ...base, loadMean: 20 }, baselines);

    expect(heavy.value).toBeGreaterThan(light.value);
    // Clamped to the 1..5 scale, with a CI that brackets the point estimate.
    expect(heavy.value).toBeGreaterThanOrEqual(1);
    expect(heavy.value).toBeLessThanOrEqual(5);
    expect(heavy.ci[0]).toBeLessThanOrEqual(heavy.value);
    expect(heavy.ci[1]).toBeGreaterThanOrEqual(heavy.value);
    // The dominant driver is the session load.
    expect(heavy.drivers[0].key).toBe("loadMean");
  });
});
