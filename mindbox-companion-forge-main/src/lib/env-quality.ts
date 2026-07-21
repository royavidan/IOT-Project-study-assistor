// Study-environment quality — pure, transparent scoring of the ambient
// conditions we sense (temperature, noise, light) against FIXED, research-based
// ideal ranges. Unlike the old "ideal conditions" (which ranked sessions by the
// Focus Load Estimate — a metric that itself contains noise, so it was
// circular), these bands are external references, so the score is honest and
// actionable. No React/Supabase; unit-tested.
//
// Sources for the ideal ranges:
//  - Temperature: Seppänen & Fisk (Lawrence Berkeley Lab) — office/task
//    performance peaks ~21.6 °C, near-flat 21–25 °C; Cornell (Hedge 2004).
//  - Noise: WHO (<35 dB classrooms), EPA (45 dB indoors), white-noise study
//    (Nature Sci. Reports 2022, ~45 dB best sustained attention). Our sensor is
//    a NORMALIZED 0–1 loudness, not calibrated dB, so bands are qualitative.
//  - Light: EN 12464-1 / IES — 300–500 lux for reading/study workstations.

import type { Session } from "@/lib/types";

/**
 * Room temperature from a DB row with the legacy sentinel mapped to "missing":
 * firmware before 2026-07 stored 0 (not null) when the DHT had no valid
 * reading, and a DHT11 cannot measure 0 °C — so a stored 0 is always "no
 * data", never a real room temperature. Every reader of `temp_c` must come
 * through here, or fake zeros drag temp averages down (the "7°" bug).
 */
export function roomTempOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

export type Band = "ideal" | "okay" | "poor";
export type FactorKey = "temp" | "noise" | "light";

/** Piecewise-linear "tent" scoring: interpolate score across value breakpoints. */
type Breakpoints = readonly (readonly [value: number, score: number])[];

function interpolate(value: number, points: Breakpoints): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (value <= first[0]) return first[1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    if (value <= x2) {
      const t = (value - x1) / (x2 - x1);
      return y1 + t * (y2 - y1);
    }
  }
  return last[1];
}

/** score ≥ 80 → ideal (green), ≥ 45 → okay (amber), else poor (red). */
function bandForScore(score: number): Band {
  if (score >= 80) return "ideal";
  if (score >= 45) return "okay";
  return "poor";
}

interface FactorSpec {
  key: FactorKey;
  unit: string;
  targetLabel: string;
  breakpoints: Breakpoints;
  /** true when a LOWER value is better (noise). */
  lowerBetter?: boolean;
}

const SPECS: Record<FactorKey, FactorSpec> = {
  // Peak ~21.6 °C; ideal 20.5–23.5 (≥90), okay 18–26 (45–90), poor outside.
  temp: {
    key: "temp",
    unit: "°C",
    targetLabel: "20.5–23.5 °C",
    breakpoints: [
      [14, 0],
      [18, 45],
      [20.5, 90],
      [21.6, 100],
      [23.5, 90],
      [26, 45],
      [30, 10],
      [35, 0],
    ],
  },
  // Normalized 0–1 loudness; quiet ≤0.35 (≥85), moderate ≤0.55 (45–85), loud beyond.
  noise: {
    key: "noise",
    unit: "",
    targetLabel: "quiet (≤ 0.35)",
    lowerBetter: true,
    breakpoints: [
      [0, 100],
      [0.35, 85],
      [0.55, 45],
      [0.75, 15],
      [1, 0],
    ],
  },
  // EN 12464-1: 300–500 lux ideal (≥85); dim <200 (<45); glare >1000 (<45).
  light: {
    key: "light",
    unit: "lux",
    targetLabel: "300–500 lux",
    breakpoints: [
      [0, 0],
      [150, 25],
      [200, 45],
      [300, 85],
      [400, 100],
      [500, 95],
      [750, 80],
      [1000, 45],
      [2000, 15],
    ],
  },
};

export interface FactorRating {
  key: FactorKey;
  value: number;
  unit: string;
  score: number; // 0–100
  band: Band;
  /** Short human label, e.g. "Comfortable" / "Quiet" / "Too dim". */
  label: string;
  targetLabel: string;
  /** One actionable nudge when not ideal; null when ideal. */
  tip: string | null;
}

function labelFor(key: FactorKey, band: Band, value: number): string {
  if (key === "temp") {
    if (band === "ideal") return "Comfortable";
    return value > 23.5 ? "Too warm" : "Too cold";
  }
  if (key === "noise") {
    if (band === "ideal") return "Quiet";
    return band === "okay" ? "Moderate" : "Loud";
  }
  // light
  if (band === "ideal") return "Bright enough";
  return value < 300 ? (value < 200 ? "Too dim" : "Dim-ish") : "Very bright";
}

export function factorTip(key: FactorKey, band: Band, value: number): string | null {
  if (band === "ideal") return null;
  if (key === "temp") {
    return value > 23.5
      ? "Room's a bit warm — aim for around 21 °C."
      : "A bit cold — around 21 °C is the sweet spot for focus.";
  }
  if (key === "noise") {
    return band === "poor"
      ? "It's loud — quieter surroundings or headphones help concentration."
      : "Some background noise — a quieter spot may help focus.";
  }
  // light
  if (value < 300) return "Under ~300 lux — add a lamp so reading is easier on the eyes.";
  return "Very bright — cut glare, and use warmer light in the evening to protect sleep.";
}

/** Rate one factor value against its ideal band. */
export function rateFactor(key: FactorKey, value: number): FactorRating {
  const spec = SPECS[key];
  const score = Math.max(0, Math.min(100, Math.round(interpolate(value, spec.breakpoints))));
  const band = bandForScore(score);
  return {
    key,
    value,
    unit: spec.unit,
    score,
    band,
    label: labelFor(key, band, value),
    targetLabel: spec.targetLabel,
    tip: factorTip(key, band, value),
  };
}

export interface EnvReading {
  noiseAvg: number | null;
  tempC: number | null;
  lightLux: number | null;
}

export interface StudyConditions {
  /** Composite 0–100 (mean of the factors we have a reading for). */
  score: number;
  band: Band;
  factors: FactorRating[];
  sentence: string;
}

function sentenceFor(band: Band): string {
  if (band === "ideal") return "Great conditions for focus.";
  if (band === "okay") return "Decent conditions — a couple of tweaks could help.";
  return "Your environment is working against your focus right now.";
}

/**
 * Score the environment from a set of readings. Returns null when there is no
 * environmental data at all (the caller shows an empty state).
 */
export function computeStudyConditions(env: EnvReading): StudyConditions | null {
  const factors: FactorRating[] = [];
  if (env.tempC != null) factors.push(rateFactor("temp", env.tempC));
  if (env.noiseAvg != null) factors.push(rateFactor("noise", env.noiseAvg));
  if (env.lightLux != null) factors.push(rateFactor("light", env.lightLux));
  if (factors.length === 0) return null;

  const score = Math.round(factors.reduce((sum, f) => sum + f.score, 0) / factors.length);
  const band = bandForScore(score);
  return { score, band, factors, sentence: sentenceFor(band) };
}

function meanOf(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Average environment across sessions that carry readings, then score it. */
export function conditionsFromSessions(sessions: Session[]): StudyConditions | null {
  const withEnv = sessions.filter(
    (s) => s.noiseAvg != null || s.tempC != null || s.lightLux != null,
  );
  if (withEnv.length === 0) return null;
  return computeStudyConditions({
    tempC: meanOf(withEnv.map((s) => s.tempC)),
    noiseAvg: meanOf(withEnv.map((s) => s.noiseAvg)),
    lightLux: meanOf(withEnv.map((s) => s.lightLux)),
  });
}
