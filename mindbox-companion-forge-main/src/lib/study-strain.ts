// Activity-weighted study "strain" — a transparent way to say that not every
// study minute drains you equally. Pure, unit-tested, no ML: every multiplier is
// visible here and grounded in established models, so the Focus Battery can
// reflect *what* and *with whom* you studied, not just how long.
//
// Grounding:
//  - Cognitive Load Theory (Sweller): harder, more generative tasks (homework,
//    deep focus) carry more intrinsic load than receptive ones (reading).
//  - ICAP (Chi & Wylie): Interactive > Constructive > Active > Passive engagement.
//  - Collective working-memory effect (Kirschner, Paas & Kirschner): studying
//    with others LOWERS each person's load on hard tasks (shared thinking) but
//    adds transaction costs (coordination/social) on light ones — so group study
//    is difficulty-aware, not uniformly less draining.
//  - Wearable "training load / strain" (Whoop/Garmin/Oura): accumulate an
//    intensity-weighted load that recovery pays back — the pattern we copy.

import type { Companions, Session, SessionMode } from "@/lib/types";

/** Base drain multiplier per activity (1.0 = an ordinary study minute). */
export const INTENSITY_BY_MODE: Record<SessionMode, number> = {
  Homework: 1.25, // active problem-solving — highest intrinsic load
  "Deep Focus": 1.2, // sustained, demanding concentration
  Study: 1.0, // baseline active study
  Review: 1.0, // revisiting known material
  Reading: 0.85, // more receptive than generative
};

/** Modes treated as cognitively "hard" for the group-study adjustment. */
const HARD_MODES: ReadonlySet<SessionMode> = new Set<SessionMode>(["Homework", "Deep Focus"]);

/** Studying a hard task with others → less per-person load (shared thinking). */
export const GROUP_HARD_FACTOR = 0.85;
/** Studying a light task with others → coordination / social overhead. */
export const GROUP_LIGHT_FACTOR = 1.1;

/** No single session should dominate the drain — clamp the combined multiplier. */
export const INTENSITY_MIN = 0.5;
export const INTENSITY_MAX = 1.5;

/**
 * Passive attended class time (lecture/tutorial/lab) drains less per minute than
 * active self-study. Used by the timetable → external-load bridge.
 */
export const LECTURE_PASSIVE_FACTOR = 0.6;

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** The group-study multiplier for a mode, difficulty-aware. Solo = 1.0. */
export function companionFactor(mode: SessionMode, companions: Companions | undefined): number {
  if (companions !== "with_others") return 1;
  return HARD_MODES.has(mode) ? GROUP_HARD_FACTOR : GROUP_LIGHT_FACTOR;
}

/** Combined drain multiplier for a session (base × company), clamped 0.5–1.5. */
export function sessionIntensity(session: Pick<Session, "mode" | "companions">): number {
  const base = INTENSITY_BY_MODE[session.mode] ?? 1;
  return clamp(
    base * companionFactor(session.mode, session.companions),
    INTENSITY_MIN,
    INTENSITY_MAX,
  );
}

/** A session's clock minutes re-weighted by how draining the activity is. */
export function strainMinutes(
  session: Pick<Session, "mode" | "companions" | "durationMin">,
): number {
  return Math.max(0, session.durationMin) * sessionIntensity(session);
}

/** Total activity-weighted minutes across sessions. */
export function sumStrainMinutes(sessions: Session[]): number {
  return sessions.reduce((sum, s) => sum + strainMinutes(s), 0);
}

/**
 * Short human note for the UI, e.g. "counts as ~1.25× drain — homework".
 * Returns null when the weighting is neutral (≈1.0×), to avoid noise.
 */
export function intensityNote(session: Pick<Session, "mode" | "companions">): string | null {
  const mult = sessionIntensity(session);
  const rounded = Math.round(mult * 100) / 100;
  if (Math.abs(rounded - 1) < 0.02) return null;
  const who = session.companions === "with_others" ? ", with others" : "";
  const dir = rounded > 1 ? "more draining" : "less draining";
  return `counts as ~${rounded}× drain (${dir}) — ${session.mode.toLowerCase()}${who}`;
}
