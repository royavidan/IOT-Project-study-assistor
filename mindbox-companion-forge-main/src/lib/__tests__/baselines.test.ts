import { describe, expect, it } from "vitest";

import {
  computeBaselines,
  normalize,
  overallBasis,
  zVector,
  type PopulationPrior,
} from "@/lib/focus/baselines";

const PRIORS: Record<string, PopulationPrior> = {
  startHour: { center: 10, scale: 3 }, // population "normal" start = 10:00
  loadMean: { center: 45, scale: 15 },
};

function rows(startHours: number[], loads: number[] = []): Record<string, number>[] {
  return startHours.map((h, i) => ({ startHour: h, loadMean: loads[i] ?? 45 }));
}

describe("computeBaselines (shrinkage / partial pooling)", () => {
  it("with almost no data, the baseline center stays near the population prior", () => {
    const b = computeBaselines(rows([23, 23]), PRIORS); // 2 night-owl sessions
    // n=2, k=8 → weight 0.2 → center ≈ 0.2*23 + 0.8*10 = 12.6, still prior-leaning.
    expect(b.metrics.startHour.center).toBeGreaterThan(11);
    expect(b.metrics.startHour.center).toBeLessThan(15);
    expect(b.metrics.startHour.basis).toBe("prior");
    expect(overallBasis(b)).toBe("prior");
  });

  it("with lots of data, the baseline center becomes the user's own (night owl)", () => {
    const nightOwl = new Array(20).fill(23);
    const b = computeBaselines(rows(nightOwl), PRIORS);
    // n=20, k=8 → weight 0.71 → center ≈ 0.71*23 + 0.29*10 ≈ 19.2, clearly personal.
    expect(b.metrics.startHour.center).toBeGreaterThan(18);
    expect(b.metrics.startHour.basis).toBe("personal");
    expect(overallBasis(b)).toBe("personal");
  });

  it("normalizes relative to the USER — a night owl's 23:00 is normal for them", () => {
    const nightOwl = new Array(20).fill(23);
    const b = computeBaselines(rows(nightOwl), PRIORS);
    // 23:00 is near this user's own center → small |z|, NOT the big penalty the
    // global 10:00 prior would give.
    expect(Math.abs(normalize(b, "startHour", 23))).toBeLessThan(1);
    // A 10:00 start is unusual FOR THEM → large negative z.
    expect(normalize(b, "startHour", 10)).toBeLessThan(-1);
  });

  it("floors the scale so a zero-variance history doesn't explode z-scores", () => {
    const b = computeBaselines(rows(new Array(20).fill(23)), PRIORS);
    expect(b.metrics.startHour.scale).toBeGreaterThan(0);
    expect(Number.isFinite(normalize(b, "startHour", 25))).toBe(true);
  });

  it("zVector maps a record into ordered z-scores and fills missing with the center", () => {
    const b = computeBaselines(rows(new Array(20).fill(23), new Array(20).fill(45)), PRIORS);
    const v = zVector(b, { startHour: 23 }, ["startHour", "loadMean"]);
    expect(v).toHaveLength(2);
    expect(Math.abs(v[0])).toBeLessThan(1); // 23 is normal for them
    expect(Math.abs(v[1])).toBeLessThan(0.01); // missing loadMean -> center -> z≈0
  });
});
