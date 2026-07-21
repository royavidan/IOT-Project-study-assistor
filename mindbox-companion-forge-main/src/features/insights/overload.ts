// Overload ("dangerous state") assessment for the scheduled load review.
//
// PURPOSE (written down on purpose — TA requirement): collect the user's data,
// let OUR deterministic rules below decide whether they are in / approaching an
// unhealthy overload state, have the AI write only the personalized narrative,
// then contact the user. The AI NEVER decides what counts as dangerous.
//
// Pure + unit-tested; takes `now` in; same non-clinical framing rules as
// wellbeing.ts — this is a behavioral load pattern, never a diagnosis.

import type { HomeworkAssignment, Session } from "@/lib/types";
import { computeWellbeing, type ExternalLoadEntry } from "@/lib/wellbeing";
import { toDateKey } from "@/lib/dates";
import type { ScheduleEvent } from "@/features/schedule/schedule";
import { expandScheduleEvents, parseTimeToMinutes } from "@/features/schedule/schedule";
import {
  addDaysKey,
  heuristicHomeworkMinutes,
  homeworkCompletionPct,
} from "@/features/planner/planner";

// --- Explicit thresholds (the numbers the report/demo cites) -----------------

/** Rule 2: mean tiredness of the last check-ins at/above this fires. */
export const OVERLOAD_TIREDNESS_MIN = 4;
/** Rule 3: planned study in the next 7 days above cap × this fires. */
export const OVERLOAD_PLANNED_FACTOR = 1.25;
/** Rule 4: this many consecutive active days with no rest day fires. */
export const OVERLOAD_ACTIVE_DAYS = 6;
/** Rule 5: an exam within this many hours ... */
export const OVERLOAD_EXAM_HOURS = 72;
/** ... combined with more than this much unfinished homework fires. */
export const OVERLOAD_HOMEWORK_MIN = 6 * 60;

export type OverloadLevel = "ok" | "warning" | "danger";

export interface OverloadRule {
  id: "strained" | "tiredness" | "overplanned" | "no-rest" | "exam-crunch";
  detail: string;
}

export interface OverloadMetrics {
  recoveryScore: number;
  recoveryStatus: "balanced" | "moderate" | "strained" | "unknown";
  avgTiredness: number | null;
  plannedStudyMinNext7: number;
  weeklyCapMin: number;
  consecutiveActiveDays: number;
  nextExamInDays: number | null;
  remainingHomeworkMin: number;
  focusMinutesLast7: number;
}

export interface OverloadAssessment {
  level: OverloadLevel;
  triggeredRules: OverloadRule[];
  metrics: OverloadMetrics;
}

export interface OverloadInput {
  now: Date;
  sessions: Session[];
  externalLoad: ExternalLoadEntry[];
  events: ScheduleEvent[];
  homework: HomeworkAssignment[];
  /** Weekly sustainable study cap in minutes (daily cap × 5). */
  weeklyCapMin: number;
  /** Tiredness values (1-5) of the most recent check-ins, newest first. */
  recentTiredness: number[];
  semesterStart?: string | null;
  semesterEnd?: string | null;
}

/**
 * Run the five deterministic rules. `danger` = recovery is strained AND any
 * other rule fired; `warning` = any single rule fired; `ok` otherwise.
 */
export function assessOverload(input: OverloadInput): OverloadAssessment {
  const todayKey = toDateKey(input.now);
  const rules: OverloadRule[] = [];

  // Rule 1 — the existing recovery-balance heuristic says "strained".
  const wellbeing = computeWellbeing(input.sessions, input.externalLoad);
  const recovery = wellbeing.recovery;
  const strained = recovery.ready && recovery.status === "strained";
  if (strained) {
    rules.push({
      id: "strained",
      detail: `Recovery balance is strained (score ${recovery.score}/100).`,
    });
  }

  // Rule 2 — the user says they're drained (mean of the last 3 check-ins).
  const tirednessValues = input.recentTiredness.slice(0, 3).filter((n) => Number.isFinite(n));
  const avgTiredness =
    tirednessValues.length > 0
      ? Math.round((tirednessValues.reduce((a, b) => a + b, 0) / tirednessValues.length) * 10) / 10
      : null;
  if (avgTiredness != null && avgTiredness >= OVERLOAD_TIREDNESS_MIN) {
    rules.push({
      id: "tiredness",
      detail: `Recent check-ins average ${avgTiredness}/5 tiredness.`,
    });
  }

  // Rule 3 — the coming week is planned beyond the sustainable cap.
  const horizonEnd = addDaysKey(todayKey, 6);
  const occurrences = expandScheduleEvents(input.events, todayKey, horizonEnd, {
    start: input.semesterStart,
    end: input.semesterEnd,
  });
  let plannedStudyMinNext7 = 0;
  for (const o of occurrences) {
    if (o.category !== "study") continue;
    const start = parseTimeToMinutes(o.startTime);
    const end = parseTimeToMinutes(o.endTime);
    if (start == null || end == null || end <= start) continue;
    plannedStudyMinNext7 += end - start;
  }
  const plannedLimit = input.weeklyCapMin * OVERLOAD_PLANNED_FACTOR;
  if (input.weeklyCapMin > 0 && plannedStudyMinNext7 > plannedLimit) {
    rules.push({
      id: "overplanned",
      detail: `${Math.round(plannedStudyMinNext7 / 60)}h of study is planned this week — above the sustainable ~${Math.round(plannedLimit / 60)}h.`,
    });
  }

  // Rule 4 — no rest day for a stretch (consecutive active days ending
  // today or yesterday).
  const activeDays = new Set(input.sessions.map((s) => s.date));
  let consecutiveActiveDays = 0;
  let cursor = activeDays.has(todayKey) ? todayKey : addDaysKey(todayKey, -1);
  while (activeDays.has(cursor)) {
    consecutiveActiveDays += 1;
    cursor = addDaysKey(cursor, -1);
  }
  if (consecutiveActiveDays >= OVERLOAD_ACTIVE_DAYS) {
    rules.push({
      id: "no-rest",
      detail: `${consecutiveActiveDays} study days in a row without a rest day.`,
    });
  }

  // Rule 5 — exam crunch: an exam inside 72h with a large homework backlog.
  const examWindowEnd = addDaysKey(todayKey, Math.ceil(OVERLOAD_EXAM_HOURS / 24));
  let nextExamInDays: number | null = null;
  for (const e of input.events) {
    if (e.category !== "exam" || e.kind !== "once" || !e.eventDate) continue;
    if (e.eventDate < todayKey) continue;
    const days = diffDays(todayKey, e.eventDate);
    if (nextExamInDays == null || days < nextExamInDays) nextExamInDays = days;
  }
  let remainingHomeworkMin = 0;
  for (const hw of input.homework) {
    const pct = homeworkCompletionPct(hw);
    if (pct >= 100) continue;
    const base =
      hw.estimatedMinutes && hw.estimatedMinutes > 0
        ? hw.estimatedMinutes
        : heuristicHomeworkMinutes(hw.weight);
    remainingHomeworkMin += Math.round(base * (1 - pct / 100));
  }
  const examSoon = nextExamInDays != null && addDaysKey(todayKey, nextExamInDays) <= examWindowEnd;
  if (examSoon && remainingHomeworkMin > OVERLOAD_HOMEWORK_MIN) {
    rules.push({
      id: "exam-crunch",
      detail: `An exam is ${nextExamInDays === 0 ? "today" : `in ${nextExamInDays} day${nextExamInDays === 1 ? "" : "s"}`} with ~${Math.round(remainingHomeworkMin / 60)}h of homework still open.`,
    });
  }

  const focusMinutesLast7 = input.sessions
    .filter((s) => s.date >= addDaysKey(todayKey, -6) && s.date <= todayKey)
    .reduce((sum, s) => sum + s.durationMin, 0);

  const level: OverloadLevel =
    strained && rules.length >= 2 ? "danger" : rules.length >= 1 ? "warning" : "ok";

  return {
    level,
    triggeredRules: rules,
    metrics: {
      recoveryScore: recovery.score,
      recoveryStatus: recovery.ready ? recovery.status : "unknown",
      avgTiredness,
      plannedStudyMinNext7,
      weeklyCapMin: input.weeklyCapMin,
      consecutiveActiveDays,
      nextExamInDays,
      remainingHomeworkMin,
      focusMinutesLast7,
    },
  };
}

function diffDays(fromKey: string, toKey: string): number {
  const ms = new Date(`${toKey}T00:00:00`).getTime() - new Date(`${fromKey}T00:00:00`).getTime();
  return Math.round(ms / 86400000);
}
