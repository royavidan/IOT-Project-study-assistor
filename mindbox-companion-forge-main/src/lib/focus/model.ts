// The calibrated per-user focus/strain model.
//
// This is the piece that turns unvalidated heuristics into a data-driven,
// PERSONAL, VALIDATED estimate. It predicts the student's post-session tiredness
// (their own 1-5 self-report — the only ground-truth label we have) from
// per-user-normalized session features, using ridge regression whose PRIOR MEAN
// is the existing heuristic's coefficients:
//
//   minimize ||Xβ − tiredness||²  +  Σ λ_j (β_j − heuristicPrior_j)²
//
// λ is a fixed prior strength in pseudo-observations, so with few labels β stays
// at the heuristic and with many labels the user's own data takes over (partial
// pooling — no per-user weight to hand-tune). Leave-one-out CV gives an HONEST
// validated accuracy (MAE + R²) that we surface instead of a made-up confidence.
// Pure + unit-tested. Never touches the DB; the target is the independent
// tiredness label, never the FLE-derived focusScore (avoids circularity).

import { clamp, looCV, ridgeSolve, stdev, type CvResult } from "@/lib/stats/robust";
import { zVector, type PopulationPrior, type UserBaselines } from "@/lib/focus/baselines";

export interface FeatureSpec {
  key: string;
  label: string;
  /** Population prior (center/scale) for per-user normalization. */
  prior: PopulationPrior;
  /** Prior-mean coefficient: the heuristic belief, in tiredness points per +1 SD. */
  priorCoef: number;
}

/**
 * The feature set. Each is per-user-normalized (robust z) before fitting, so the
 * coefficients are "tiredness points per 1 SD above the user's own normal". The
 * priorCoefs encode today's heuristic (heavier / longer / noisier / more
 * interrupted / later / more-recent-load → more tired) and are what a
 * data-poor user gets until their own labels move them.
 */
export const FEATURES: FeatureSpec[] = [
  { key: "loadMean", label: "Session load", prior: { center: 45, scale: 15 }, priorCoef: 0.25 },
  { key: "loadSlope", label: "Strain climbed", prior: { center: 0, scale: 10 }, priorCoef: 0.15 },
  {
    key: "sustainedHighShare",
    label: "Time at high load",
    prior: { center: 0.3, scale: 0.25 },
    priorCoef: 0.15,
  },
  {
    key: "sessionMinutes",
    label: "Session length",
    prior: { center: 50, scale: 25 },
    priorCoef: 0.2,
  },
  { key: "noiseMean", label: "Noise", prior: { center: 0.4, scale: 0.15 }, priorCoef: 0.1 },
  {
    key: "presenceInterruptions",
    label: "Interruptions",
    prior: { center: 1, scale: 1.5 },
    priorCoef: 0.1,
  },
  {
    key: "recentStrainEwma",
    label: "Recent cumulative load",
    prior: { center: 120, scale: 60 },
    priorCoef: 0.2,
  },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);
export const FEATURE_PRIORS: Record<string, PopulationPrior> = Object.fromEntries(
  FEATURES.map((f) => [f.key, f.prior]),
);

/** Population mean tiredness (1-5) — the intercept prior. */
export const PRIOR_INTERCEPT = 2.7;
/** Prior strength (pseudo-observations) regularizing the feature coefficients. */
export const MODEL_PRIOR_STRENGTH = 6;
/** Weaker regularization on the intercept so it learns the user's own mean faster. */
const BIAS_LAMBDA = 2;
/** Below this many labels, don't fit personally — return the heuristic prior. */
export const MIN_PERSONAL_LABELS = 6;
/** Below this many labels, don't report a validated accuracy (LOO too unstable). */
export const MIN_CV_LABELS = 8;
/** Uncertainty (SD of tiredness points) used before the model is calibrated. */
const DEFAULT_RESIDUAL_STD = 1.0;

export interface LabeledSample {
  features: Record<string, number>;
  tiredness: number;
}

export interface FocusModel {
  /** [featureCoefs…, intercept]. */
  coefficients: number[];
  nLabels: number;
  /** Leave-one-out accuracy; null when too few labels to validate. */
  cv: CvResult | null;
  /** SD of the model's residuals — the honest uncertainty on a prediction. */
  residualStd: number;
  /** False when we fell back to the pure heuristic prior (data too sparse). */
  usedPersonalData: boolean;
}

function priorMeanVector(): number[] {
  return [...FEATURES.map((f) => f.priorCoef), PRIOR_INTERCEPT];
}

function lambdaVector(): number[] {
  return [...FEATURES.map(() => MODEL_PRIOR_STRENGTH), BIAS_LAMBDA];
}

/**
 * Fit the ridge-with-prior model on the user's labeled sessions. `baselines`
 * must already be computed (Layer 3). Degrades to the heuristic prior below
 * MIN_PERSONAL_LABELS, and withholds a validated accuracy below MIN_CV_LABELS.
 */
export function fitFocusModel(samples: LabeledSample[], baselines: UserBaselines): FocusModel {
  const n = samples.length;
  const priorMean = priorMeanVector();
  if (n < MIN_PERSONAL_LABELS) {
    return {
      coefficients: priorMean,
      nLabels: n,
      cv: null,
      residualStd: DEFAULT_RESIDUAL_STD,
      usedPersonalData: false,
    };
  }
  const X = samples.map((s) => [...zVector(baselines, s.features, FEATURE_KEYS), 1]);
  const y = samples.map((s) => s.tiredness);
  const lambda = lambdaVector();
  const coefficients = ridgeSolve(X, y, lambda, priorMean);

  let cv: CvResult | null = null;
  let residualStd = DEFAULT_RESIDUAL_STD;
  if (n >= MIN_CV_LABELS) {
    cv = looCV(X, y, lambda, priorMean);
    const resid = cv.preds.map((p, i) => p - y[i]);
    const sd = stdev(resid);
    residualStd = sd > 0 && Number.isFinite(sd) ? sd : DEFAULT_RESIDUAL_STD;
  }
  return { coefficients, nLabels: n, cv, residualStd, usedPersonalData: true };
}

export interface Driver {
  key: string;
  label: string;
  /** Signed contribution to the predicted tiredness (coef × z). */
  contribution: number;
}

export interface TirednessPrediction {
  /** Predicted tiredness, clamped to 1..5. */
  value: number;
  /** ~80% band, clamped to 1..5. */
  ci: [number, number];
  /** Feature contributions, largest |magnitude| first. */
  drivers: Driver[];
}

/** Predict post-session tiredness for a feature row, with a CI and driver breakdown. */
export function predictTiredness(
  model: FocusModel,
  features: Record<string, number>,
  baselines: UserBaselines,
): TirednessPrediction {
  const z = zVector(baselines, features, FEATURE_KEYS);
  const intercept = model.coefficients[model.coefficients.length - 1];
  let raw = intercept;
  const drivers: Driver[] = FEATURES.map((f, i) => {
    const contribution = model.coefficients[i] * z[i];
    raw += contribution;
    return { key: f.key, label: f.label, contribution };
  });
  const value = clamp(raw, 1, 5);
  const half = 1.2816 * model.residualStd; // ~80% interval
  const ci: [number, number] = [clamp(raw - half, 1, 5), clamp(raw + half, 1, 5)];
  drivers.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return { value, ci, drivers };
}
