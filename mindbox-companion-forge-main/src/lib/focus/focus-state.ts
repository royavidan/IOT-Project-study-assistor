// The composite focus/energy estimate — the "lead with honesty" object the UI
// shows. It fuses the calibrated model's tiredness prediction (Layer 5) with the
// recency-weighted trajectory (Layer 4) and a truthful reliability summary
// (validated accuracy + data volume + whether it's measured against the user's
// own baseline or still the population prior). Pure + unit-tested.
//
// This is ADDITIVE: it does not touch `computeWellbeing`/`recovery.status`, so
// the planner throttle, load-review Rule 1, and reports are unaffected.
//
// Framing invariant (same as wellbeing.ts / focus-load.ts): a behavioral focus/
// energy pattern estimate with honest uncertainty — never a clinical or
// diagnostic claim.

import { clamp } from "@/lib/stats/robust";
import { overallBasis, type UserBaselines } from "@/lib/focus/baselines";
import {
  MIN_CV_LABELS,
  type Driver,
  type FocusModel,
  type TirednessPrediction,
} from "@/lib/focus/model";
import type { TrendResult } from "@/lib/focus/trends";

export interface FocusReliability {
  basis: "personal" | "blended" | "prior";
  nSessions: number;
  nLabels: number;
  /** Leave-one-out MAE in tiredness points (null while uncalibrated). */
  validatedMae: number | null;
  /** Leave-one-out R² (null while uncalibrated). */
  r2: number | null;
  /** One honest human sentence about how much to trust this. */
  label: string;
}

export interface FocusStateEstimate {
  /** 0..100, higher = more focus energy / less strain. */
  energyScore: number;
  /** ~80% band on the energy score. */
  energyCI: [number, number];
  /** Predicted post-session tiredness (1..5) and its band. */
  predictedTiredness: number;
  tirednessCI: [number, number];
  trend: TrendResult;
  reliability: FocusReliability;
  /** Top contributors (tiredness impact; positive = adds strain). */
  drivers: Driver[];
  headline: string;
  detail: string;
}

/** Map tiredness (1..5) to a focus-energy score (0..100, higher = better). */
export function tirednessToEnergy(tiredness: number): number {
  return Math.round(clamp((5 - tiredness) / 4, 0, 1) * 100);
}

function reliabilityLabel(
  basis: FocusReliability["basis"],
  nLabels: number,
  mae: number | null,
): string {
  if (mae != null) {
    const basisPhrase =
      basis === "personal"
        ? "measured against your own baseline"
        : basis === "blended"
          ? "a blend of your baseline and typical patterns"
          : "mostly typical patterns while it learns you";
    return `Predicts your tiredness within ±${mae.toFixed(1)} of 5 points — ${basisPhrase}.`;
  }
  return `Still learning your patterns — ${nLabels}/${MIN_CV_LABELS} check-ins so far. Showing the general estimate meanwhile.`;
}

function headlineFor(energy: number): string {
  if (energy >= 67) return "High focus energy";
  if (energy >= 34) return "Moderate focus energy";
  return "Running low";
}

function trendPhrase(trend: TrendResult): string {
  // The trend series is strain (higher = more strain), so "rising" strain is
  // energy declining. Only speak when the trend is confident.
  if (trend.direction === "flat" || trend.confidence === "low") return "holding steady lately";
  return trend.direction === "rising" ? "trending toward more strain" : "easing lately";
}

export interface ComposeInput {
  prediction: TirednessPrediction;
  model: FocusModel;
  baselines: UserBaselines;
  /** Trend of daily strain over recent days (higher = more strain). */
  trend: TrendResult;
  /** How many top drivers to surface. */
  maxDrivers?: number;
}

export function composeFocusState(input: ComposeInput): FocusStateEstimate {
  const { prediction, model, baselines, trend } = input;
  const energyScore = tirednessToEnergy(prediction.value);
  // CI maps inversely (more tired = less energy), so swap the bounds.
  const energyCI: [number, number] = [
    tirednessToEnergy(prediction.ci[1]),
    tirednessToEnergy(prediction.ci[0]),
  ];

  const basis = overallBasis(baselines);
  const reliability: FocusReliability = {
    basis,
    nSessions: baselines.nSessions,
    nLabels: model.nLabels,
    validatedMae: model.cv ? model.cv.mae : null,
    r2: model.cv ? model.cv.r2 : null,
    label: reliabilityLabel(basis, model.nLabels, model.cv ? model.cv.mae : null),
  };

  const headline = headlineFor(energyScore);
  const detail = `Your recent sessions look like a ${headline.toLowerCase()} pattern, ${trendPhrase(trend)}.`;

  const drivers = prediction.drivers
    .filter((d) => Math.abs(d.contribution) > 0.02)
    .slice(0, input.maxDrivers ?? 4);

  return {
    energyScore,
    energyCI,
    predictedTiredness: prediction.value,
    tirednessCI: prediction.ci,
    trend,
    reliability,
    drivers,
    headline,
    detail,
  };
}
