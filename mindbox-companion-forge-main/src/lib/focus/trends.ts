// Recency-weighted trend / trajectory of a daily metric.
//
// Replaces the old hard trailing windows (a burst of sessions weeks ago counted
// the same as this week) with an EWMA level plus a robust Theil-Sen slope and a
// rank-based confidence interval on that slope. The direction is only called
// "rising"/"falling" when the CI actually excludes zero — otherwise it's "flat",
// so we never over-read noise as a trend. Pure + unit-tested.

import { ewma, theilSenSlopeCI } from "@/lib/stats/robust";

/** A single daily observation: `t` is a day number, `v` the metric value. */
export interface DailyPoint {
  t: number;
  v: number;
}

export type TrendDirection = "rising" | "falling" | "flat";

export interface TrendResult {
  /** Recency-weighted current level (EWMA). */
  level: number;
  /** Robust slope per 7 days (Theil-Sen). */
  slopePerWeek: number;
  /** Rank-based CI on the weekly slope. */
  slopeCI: [number, number];
  /** Only "rising"/"falling" when the CI excludes 0; else "flat". */
  direction: TrendDirection;
  /** How much data backs the trend. */
  confidence: "low" | "medium" | "high";
  nPoints: number;
}

export const TREND_HALF_LIFE_DAYS = 8;

export function computeTrend(
  points: DailyPoint[],
  opts: { halfLifeDays?: number } = {},
): TrendResult {
  const n = points.length;
  const halfLife = opts.halfLifeDays ?? TREND_HALF_LIFE_DAYS;
  const level = ewma(points, halfLife);

  if (n < 2) {
    return {
      level,
      slopePerWeek: 0,
      slopeCI: [0, 0],
      direction: "flat",
      confidence: "low",
      nPoints: n,
    };
  }

  const { slope, lo, hi } = theilSenSlopeCI(
    points.map((p) => ({ x: p.t, y: p.v })),
    0.9,
  );
  const slopePerWeek = slope * 7;
  const slopeCI: [number, number] = [lo * 7, hi * 7];
  const bracketsZero = lo <= 0 && hi >= 0;
  const direction: TrendDirection = bracketsZero ? "flat" : slope > 0 ? "rising" : "falling";

  const confidence: TrendResult["confidence"] = n >= 10 ? "high" : n >= 5 ? "medium" : "low";

  return { level, slopePerWeek, slopeCI, direction, confidence, nPoints: n };
}
