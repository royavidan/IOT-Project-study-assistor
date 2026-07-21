// Per-user baselines with empirical-Bayes shrinkage (partial pooling).
//
// The old heuristics judge everyone against the SAME global constants — a night
// owl and an early riser get the same 22:00 penalty. Here, each metric is
// centered/scaled against the USER'S OWN history (robust median + MAD), and when
// the user has little data we shrink that estimate toward a population prior so
// small samples don't swing. As the user logs more, their own baseline takes
// over. `normalize` then returns a robust z-score relative to *them*, which is
// what makes every downstream estimate personal and fair. Pure + unit-tested.

import { mad, median, robustZ, shrink } from "@/lib/stats/robust";

/** A population-level fallback used until the user has enough of their own data. */
export interface PopulationPrior {
  center: number;
  scale: number;
}

export interface MetricBaseline {
  /** Shrunk center (robust median blended toward the prior). */
  center: number;
  /** Shrunk scale (robust MAD blended toward the prior, floored). */
  scale: number;
  /** How many of the user's own observations backed this metric. */
  n: number;
  /** Whether this baseline is mostly the user's, a blend, or still the prior. */
  basis: "prior" | "blended" | "personal";
}

export interface UserBaselines {
  nSessions: number;
  metrics: Record<string, MetricBaseline>;
}

/** Prior strength in pseudo-observations: how much data before we trust "you".
 *  w = n/(n+k): ~half-personal by 5 sessions, ~80% by 20. Low enough that a
 *  consistent user's own baseline clearly wins, high enough to steady tiny n. */
export const PRIOR_STRENGTH = 5;
const PERSONAL_N = 12;
const BLENDED_N = 4;

/**
 * Build per-user baselines for every metric named in `priors`. `rows` is one
 * record per session mapping feature name → value; missing/non-finite values are
 * skipped per metric.
 */
export function computeBaselines(
  rows: Record<string, number>[],
  priors: Record<string, PopulationPrior>,
  priorStrength = PRIOR_STRENGTH,
): UserBaselines {
  const metrics: Record<string, MetricBaseline> = {};
  for (const key of Object.keys(priors)) {
    const prior = priors[key];
    const vals = rows
      .map((r) => r[key])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const n = vals.length;

    const personalCenter = n > 0 ? median(vals) : prior.center;
    const personalScaleRaw = n > 1 ? mad(vals, personalCenter) : prior.scale;
    const personalScale = personalScaleRaw > 0 ? personalScaleRaw : prior.scale;

    const center = shrink(personalCenter, prior.center, n, priorStrength);
    const scaleShrunk = shrink(personalScale, prior.scale, n, priorStrength);
    // Never let the scale collapse (would make z-scores explode): floor at a
    // quarter of the prior scale.
    const scale = Math.max(scaleShrunk, prior.scale * 0.25, 1e-6);

    const basis: MetricBaseline["basis"] =
      n >= PERSONAL_N ? "personal" : n >= BLENDED_N ? "blended" : "prior";
    metrics[key] = { center, scale, n, basis };
  }
  return { nSessions: rows.length, metrics };
}

/** Robust z-score of a value against the user's shrunk baseline for that metric. */
export function normalize(baselines: UserBaselines, key: string, value: number): number {
  const b = baselines.metrics[key];
  if (!b) return 0;
  return robustZ(value, b.center, b.scale);
}

/** Normalize a whole feature record into a z-vector in a fixed feature order. */
export function zVector(
  baselines: UserBaselines,
  row: Record<string, number>,
  order: string[],
): number[] {
  return order.map((k) => {
    const v = row[k];
    const center = baselines.metrics[k]?.center ?? 0;
    return normalize(baselines, k, typeof v === "number" && Number.isFinite(v) ? v : center);
  });
}

/** Overall basis label for the whole estimate (drives the "measured against…" copy). */
export function overallBasis(baselines: UserBaselines): MetricBaseline["basis"] {
  const n = baselines.nSessions;
  return n >= PERSONAL_N ? "personal" : n >= BLENDED_N ? "blended" : "prior";
}
