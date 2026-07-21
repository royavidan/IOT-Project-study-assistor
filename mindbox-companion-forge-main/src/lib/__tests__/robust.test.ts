import { describe, expect, it } from "vitest";

import {
  correlation,
  ewma,
  looCV,
  mad,
  median,
  ridgeSolve,
  robustZ,
  shrink,
  shrinkageWeight,
  solveLinear,
  theilSen,
  theilSenSlopeCI,
} from "@/lib/stats/robust";

describe("median / mad / robustZ", () => {
  it("median handles odd and even lengths without mutating input", () => {
    const xs = [3, 1, 2];
    expect(median(xs)).toBe(2);
    expect(xs).toEqual([3, 1, 2]);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("mad estimates spread robustly (scaled to ~SD) and ignores an outlier", () => {
    // Symmetric data: MAD ≈ SD-ish. A lone outlier barely moves it.
    const base = [10, 12, 14, 16, 18];
    const withOutlier = [...base, 1000];
    expect(mad(base)).toBeGreaterThan(0);
    expect(mad(withOutlier)).toBeLessThan(mad(base) * 2);
  });

  it("robustZ floors the scale so a zero-spread baseline doesn't blow up", () => {
    expect(robustZ(5, 5, 0)).toBe(0);
    expect(robustZ(7, 5, 2)).toBeCloseTo(1, 5);
  });
});

describe("shrinkage (partial pooling)", () => {
  it("weight rises from 0 toward 1 as n grows", () => {
    expect(shrinkageWeight(0, 8)).toBe(0);
    expect(shrinkageWeight(8, 8)).toBeCloseTo(0.5, 5);
    expect(shrinkageWeight(1000, 8)).toBeGreaterThan(0.98);
  });

  it("shrink returns the prior with no data and the personal value with lots", () => {
    expect(shrink(100, 0, 0, 8)).toBeCloseTo(0, 5); // no data -> prior
    expect(shrink(100, 0, 10000, 8)).toBeGreaterThan(99); // tons -> personal
  });
});

describe("ewma", () => {
  it("weights recent points more than old ones", () => {
    const points = [
      { t: 0, v: 0 },
      { t: 10, v: 100 },
    ];
    // Half-life 3d, "now" = 10 → the recent 100 dominates.
    expect(ewma(points, 3, 10)).toBeGreaterThan(90);
    // "now" = 0 → the old 0 dominates.
    expect(ewma(points, 3, 0)).toBeLessThan(10);
  });
});

describe("theilSen", () => {
  it("recovers a known slope and is robust to an outlier", () => {
    const pts = [0, 1, 2, 3, 4].map((x) => ({ x, y: 2 * x + 1 }));
    const { slope, intercept } = theilSen(pts);
    expect(slope).toBeCloseTo(2, 5);
    expect(intercept).toBeCloseTo(1, 5);

    const withOutlier = [...pts, { x: 5, y: 500 }];
    expect(theilSen(withOutlier).slope).toBeCloseTo(2, 1); // median slope barely moves
  });

  it("slope CI brackets the slope", () => {
    const pts = [0, 1, 2, 3, 4, 5].map((x) => ({ x, y: 2 * x + (x % 2 === 0 ? 1 : -1) }));
    const { slope, lo, hi } = theilSenSlopeCI(pts, 0.9);
    expect(lo).toBeLessThanOrEqual(slope);
    expect(hi).toBeGreaterThanOrEqual(slope);
  });
});

describe("solveLinear", () => {
  it("solves a known 2x2 system", () => {
    // 2x + y = 5 ; x + 3y = 10  -> x=1, y=3
    const x = solveLinear(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10],
    );
    expect(x[0]).toBeCloseTo(1, 6);
    expect(x[1]).toBeCloseTo(3, 6);
  });

  it("returns zeros for a singular system instead of throwing", () => {
    const x = solveLinear(
      [
        [1, 2],
        [2, 4],
      ],
      [3, 6],
    );
    expect(x).toEqual([0, 0]);
  });
});

describe("ridgeSolve (ridge with prior mean)", () => {
  // Build a linear dataset: y = 3*f1 - 2*f2 + bias(1).
  const beta = [3, -2, 1];
  const X = [
    [1, 0, 1],
    [0, 1, 1],
    [2, 1, 1],
    [1, 3, 1],
    [2, 2, 1],
    [3, 1, 1],
    [0, 2, 1],
    [3, 3, 1],
  ];
  const y = X.map((r) => r[0] * beta[0] + r[1] * beta[1] + r[2] * beta[2]);

  it("recovers the true coefficients with tiny regularization", () => {
    const b = ridgeSolve(X, y, 1e-6);
    expect(b[0]).toBeCloseTo(3, 2);
    expect(b[1]).toBeCloseTo(-2, 2);
    expect(b[2]).toBeCloseTo(1, 2);
  });

  it("stays near the prior when lambda is huge (sparse-data behavior)", () => {
    const prior = [0, 0, 0];
    const b = ridgeSolve(X.slice(0, 2), y.slice(0, 2), 1e6, prior);
    expect(Math.abs(b[0])).toBeLessThan(0.01);
    expect(Math.abs(b[1])).toBeLessThan(0.01);
  });

  it("pulls toward a non-zero prior mean under regularization", () => {
    const prior = [5, 5, 5];
    const b = ridgeSolve(X.slice(0, 3), y.slice(0, 3), 50, prior);
    // With strong prior + little data, coefficients sit between data and prior 5.
    expect(b[0]).toBeGreaterThan(2);
    expect(b[0]).toBeLessThan(5);
  });
});

describe("looCV", () => {
  it("reports low error and high R² on a clean linear relationship", () => {
    const X = [
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 1],
      [6, 1],
    ];
    const y = X.map((r) => 2 * r[0] + 1);
    const cv = looCV(X, y, 1e-4);
    expect(cv.mae).toBeLessThan(0.2);
    expect(cv.r2).toBeGreaterThan(0.95);
  });

  it("returns NaN accuracy below the minimum sample size", () => {
    const cv = looCV(
      [
        [1, 1],
        [2, 1],
      ],
      [1, 2],
      0.1,
    );
    expect(Number.isNaN(cv.mae)).toBe(true);
  });
});

describe("correlation", () => {
  it("is +1 / -1 for perfectly (anti)correlated series and 0 for flat", () => {
    expect(correlation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
    expect(correlation([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 6);
    expect(correlation([1, 1, 1], [1, 2, 3])).toBe(0);
  });

  it("supports a forward lag", () => {
    // y lags x by 1: x rise predicts next y.
    const x = [1, 2, 3, 4];
    const y = [0, 1, 2, 3];
    expect(correlation(x, y, 0)).toBeGreaterThan(0.9);
  });
});
