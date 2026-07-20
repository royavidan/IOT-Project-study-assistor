// Post-session check-in domain logic. Pure and unit-tested (no React/
// Supabase, takes `now` in) — same style as planner.ts / wellbeing.ts.
//
// The replan thresholds below are EXPLICIT by design (TA requirement): the
// system decides *when* a check-in warrants replanning; the model only decides
// *what* the new plan looks like.

import type { Session } from "@/lib/types";

/** A check-in is offered for this long after a session ends. */
export const CHECKIN_WINDOW_HOURS = 6;

/** Homework progress must move at least this much to trigger a replan. */
export const REPLAN_PROGRESS_DELTA_PCT = 25;

/** Tiredness at or above this (1-5) triggers a lighter replan. */
export const REPLAN_TIREDNESS_MIN = 4;

/**
 * The most recent completed session that ended within the check-in window and
 * hasn't been answered yet. Null when there's nothing to ask about.
 */
export function findPendingCheckin(sessions: Session[], now: Date): Session | null {
  const cutoff = now.getTime() - CHECKIN_WINDOW_HOURS * 60 * 60 * 1000;
  let latest: Session | null = null;
  let latestEnd = 0;
  for (const s of sessions) {
    if (s.status !== "completed" || !s.endedAt || s.checkinAt) continue;
    const ended = new Date(s.endedAt).getTime();
    if (!Number.isFinite(ended) || ended < cutoff || ended > now.getTime()) continue;
    if (ended > latestEnd) {
      latestEnd = ended;
      latest = s;
    }
  }
  return latest;
}

export interface CheckinAssessmentInput {
  tiredness: number;
  homeworkUpdates: {
    id: string;
    /** The stored progress before this check-in (0 when it was null). */
    previousPct: number;
    progressPct: number;
  }[];
}

export interface ReplanDecision {
  replan: boolean;
  reasons: string[];
}

/**
 * Should this check-in trigger an automatic replan? Explicit thresholds:
 *  - any homework moved ≥ 25 points,
 *  - any homework reached 100% (its remaining blocks are now pointless),
 *  - tiredness ≥ 4 (the planner throttles the coming days).
 */
export function shouldReplan(input: CheckinAssessmentInput): ReplanDecision {
  const reasons: string[] = [];

  for (const u of input.homeworkUpdates) {
    const delta = Math.abs(u.progressPct - u.previousPct);
    if (u.progressPct >= 100 && u.previousPct < 100) {
      reasons.push("an assignment was finished");
    } else if (delta >= REPLAN_PROGRESS_DELTA_PCT) {
      reasons.push("homework progress moved significantly");
    }
  }

  if (input.tiredness >= REPLAN_TIREDNESS_MIN) {
    reasons.push("you reported feeling drained");
  }

  return { replan: reasons.length > 0, reasons: [...new Set(reasons)] };
}
