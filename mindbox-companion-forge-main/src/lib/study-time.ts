// Study-time effect — a transparent model of diminishing returns within a
// session. Pure, unit-tested, no black-box ML: all constants are visible and
// grounded in the vigilance-decrement (accuracy starts dropping ~10–30 min into
// sustained attention) and ultradian (~90-min focus cycle) literature.
//
// Efficiency E(t), t = continuous focused minutes:
//   E = 1.0 for t ≤ 45  (near-peak, before the strong decrement)
//   E decays linearly to 0.5 at t = 90  (ultradian trough)
//   E = 0.5 for t > 90  (floor)
// "Effective minutes" = ∫ E(t) dt over the session — makes long unbroken grinds
// visibly worth less than their raw clock time.

import type { Session } from "@/lib/types";

export const FULL_UNTIL_MIN = 45;
export const DECAY_UNTIL_MIN = 90;
export const EFFICIENCY_FLOOR = 0.5;

const SLOPE = (1 - EFFICIENCY_FLOOR) / (DECAY_UNTIL_MIN - FULL_UNTIL_MIN);

/** Momentary efficiency at t continuous focused minutes (0.5–1.0). */
export function efficiencyAt(t: number): number {
  if (t <= FULL_UNTIL_MIN) return 1;
  if (t >= DECAY_UNTIL_MIN) return EFFICIENCY_FLOOR;
  return 1 - SLOPE * (t - FULL_UNTIL_MIN);
}

/**
 * Effective minutes for a continuous session of `durationMin` — the integral of
 * `efficiencyAt`. (We store per-session averages only, so this treats a session
 * as one unbroken block; short in-session breaks would raise this in reality.)
 */
export function effectiveMinutes(durationMin: number): number {
  const d = Math.max(0, durationMin);
  if (d <= FULL_UNTIL_MIN) return d;
  if (d <= DECAY_UNTIL_MIN) {
    const x = d - FULL_UNTIL_MIN;
    return FULL_UNTIL_MIN + (x - (SLOPE * x * x) / 2);
  }
  const decaySpan = DECAY_UNTIL_MIN - FULL_UNTIL_MIN;
  const decayArea = decaySpan - (SLOPE * decaySpan * decaySpan) / 2;
  return FULL_UNTIL_MIN + decayArea + EFFICIENCY_FLOOR * (d - DECAY_UNTIL_MIN);
}

export interface LengthBand {
  label: string;
  min: number;
  max: number;
}

export const LENGTH_BANDS: LengthBand[] = [
  { label: "under 30 min", min: 0, max: 30 },
  { label: "30–60 min", min: 30, max: 60 },
  { label: "60–90 min", min: 60, max: 90 },
  { label: "90 min+", min: 90, max: Number.POSITIVE_INFINITY },
];

function isCompleted(s: Session): boolean {
  return s.status === "completed";
}

/**
 * The length band where the user most reliably finishes sessions (best
 * completion rate, tie-broken by volume). Needs ≥2 sessions in a band to count;
 * null when there isn't enough data.
 */
export function bestSessionLength(sessions: Session[]): LengthBand | null {
  let best: { band: LengthBand; rate: number; count: number } | null = null;
  for (const band of LENGTH_BANDS) {
    const inBand = sessions.filter((s) => s.durationMin >= band.min && s.durationMin < band.max);
    if (inBand.length < 2) continue;
    const rate = inBand.filter(isCompleted).length / inBand.length;
    if (best == null || rate > best.rate || (rate === best.rate && inBand.length > best.count)) {
      best = { band, rate, count: inBand.length };
    }
  }
  return best?.band ?? null;
}

export interface StudyTimeSummary {
  sessionCount: number;
  rawMin: number;
  effectiveMin: number;
  /** effective / raw, 0–1 (1 = no diminishing returns). */
  ratio: number;
  avgSessionMin: number;
  /** Recommended session length, from the user's data or a research default. */
  sweetSpotLabel: string;
}

export function summarizeStudyTime(sessions: Session[]): StudyTimeSummary {
  const rawMin = sessions.reduce((sum, s) => sum + Math.max(0, s.durationMin), 0);
  const effectiveMin = sessions.reduce((sum, s) => sum + effectiveMinutes(s.durationMin), 0);
  const best = bestSessionLength(sessions);
  return {
    sessionCount: sessions.length,
    rawMin: Math.round(rawMin),
    effectiveMin: Math.round(effectiveMin),
    ratio: rawMin > 0 ? effectiveMin / rawMin : 1,
    avgSessionMin: sessions.length > 0 ? Math.round(rawMin / sessions.length) : 0,
    sweetSpotLabel: best?.label ?? "about 45–60 min",
  };
}
