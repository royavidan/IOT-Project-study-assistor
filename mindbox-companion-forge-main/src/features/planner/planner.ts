// Study Planner — pure scheduling domain.
//
// Turns the user's real schedule (classes, exams, homework) into proposed
// "study blocks" that fill FREE time, spread effort out BEFORE deadlines
// (anti-cramming), and stay under a sustainable daily/weekly cap. Everything
// here is pure and deterministic (takes `now` in, no React/Supabase, no
// Date.now/Math.random) so it can be unit-tested in isolation — same style as
// `today.ts` / `wellbeing.ts`.
//
// Algorithms are transparent, not ML: Reclaim/Motion-style priority-deadline
// placement, SM-2 spacing for exam review, and Pomodoro/ultradian work-break
// cadences. Burnout prevention is baked in via caps + a strained-recovery
// throttle, never bolted on.

import { parseDateKey, toDateKey } from "@/lib/dates";
import type { HomeworkAssignment, Session } from "@/lib/types";
import type { ScheduleEvent, ScheduleOccurrence } from "@/features/schedule/schedule";
import {
  STUDY_COLOR,
  expandScheduleEvents,
  parseTimeToMinutes,
} from "@/features/schedule/schedule";
import type { Course } from "@/features/courses/courses";
import { matchesCode, nextExamForCourse } from "@/features/courses/courses";

// --- Modes -----------------------------------------------------------------

export type PlanMode = "balanced" | "deep_focus" | "sprint";

export interface ModeConfig {
  mode: PlanMode;
  label: string;
  blurb: string;
  /** Length of one work block. */
  workBlockMin: number;
  /** Break inserted after a normal block. */
  breakMin: number;
  /** Longer break after `blocksBeforeLongBreak` blocks in a row. */
  longBreakMin: number;
  blocksBeforeLongBreak: number;
  /** Default sustainable cap (minutes of study) per day. */
  dailyCapMin: number;
  /** Hard ceiling on blocks per day (the key lever for Deep Focus). */
  maxBlocksPerDay: number;
  /** true = round-robin subjects; false = finish one subject before the next. */
  interleave: boolean;
  /** Prefer the earliest slots (mornings) regardless of the circadian window. */
  preferMorning: boolean;
}

export const MODE_CONFIGS: Record<PlanMode, ModeConfig> = {
  balanced: {
    mode: "balanced",
    label: "Balanced",
    blurb: "50 / 10 blocks, subjects interleaved. A sustainable default for most weeks.",
    workBlockMin: 50,
    breakMin: 10,
    longBreakMin: 30,
    blocksBeforeLongBreak: 4,
    dailyCapMin: 240,
    maxBlocksPerDay: 6,
    interleave: true,
    preferMorning: false,
  },
  deep_focus: {
    mode: "deep_focus",
    label: "Deep Focus",
    blurb: "90-minute immersive blocks, one subject at a time. Best for hard material.",
    workBlockMin: 90,
    breakMin: 20,
    longBreakMin: 20,
    blocksBeforeLongBreak: 2,
    dailyCapMin: 180,
    maxBlocksPerDay: 2,
    interleave: false,
    preferMorning: true,
  },
  sprint: {
    mode: "sprint",
    label: "Sprint",
    blurb: "25 / 5 Pomodoros. Great for low-focus days or easing back in after a break.",
    workBlockMin: 25,
    breakMin: 5,
    longBreakMin: 15,
    blocksBeforeLongBreak: 4,
    dailyCapMin: 120,
    maxBlocksPerDay: 8,
    interleave: true,
    preferMorning: false,
  },
};

export const PLAN_MODES: PlanMode[] = ["balanced", "deep_focus", "sprint"];

/** Burnout guardrails shared by every mode. */
export const BURNOUT = {
  /** Scale each task's effort by this when recovery is strained. */
  strainedThrottle: 0.75,
  /** Weekly cap = dailyCap × this. */
  weeklyCapMultiplier: 5,
} as const;

// --- Time / interval helpers -----------------------------------------------

export interface Interval {
  /** Minutes since local midnight. */
  start: number;
  end: number;
}

const DAY_MIN = 24 * 60;

/** "HH:MM" for a minutes-since-midnight value (clamped to a valid clock time). */
export function minutesToTime(min: number): string {
  const clamped = Math.max(0, Math.min(DAY_MIN - 1, Math.round(min)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Shift a YYYY-MM-DD key by `n` days in local time. */
export function addDaysKey(key: string, n: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

/** The Sunday that starts the (Israel/Sunday-based) week containing `key`. */
export function weekKeyFor(key: string): string {
  const d = parseDateKey(key);
  return addDaysKey(key, -d.getDay());
}

function clampInterval(iv: Interval, lo: number, hi: number): Interval | null {
  const start = Math.max(iv.start, lo);
  const end = Math.min(iv.end, hi);
  return end > start ? { start, end } : null;
}

/** Sort by start, merge any overlapping/touching intervals. */
export function mergeOverlaps(list: Interval[]): Interval[] {
  const sorted = [...list].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

/**
 * Quiet hours as concrete intervals within a single day [0, 1440]. Overnight
 * windows (start > end, e.g. 22:00–07:00) split into two. Empty when unset.
 * (`isInQuietHours` is a point-in-time test and can't be subtracted from a slot.)
 */
export function quietIntervalsWithin(
  quietStart: number | null,
  quietEnd: number | null,
): Interval[] {
  if (quietStart == null || quietEnd == null || quietStart === quietEnd) return [];
  if (quietStart < quietEnd) return [{ start: quietStart, end: quietEnd }];
  // Overnight: midnight..end and start..midnight.
  return [
    { start: 0, end: quietEnd },
    { start: quietStart, end: DAY_MIN },
  ];
}

// --- Free-slot detection ----------------------------------------------------

/**
 * Busy minute-intervals for one day: classes, exams, hand-made study blocks
 * (from `occurrences`) plus that day's already-logged focus `sessions`.
 * Invalid or inverted times are dropped (and reported via `warnings`) instead
 * of silently opening a phantom gap over a real commitment.
 */
export function busyIntervalsForDay(
  occurrences: ScheduleOccurrence[],
  sessions: Session[],
  dateKey: string,
  warnings?: string[],
): Interval[] {
  const out: Interval[] = [];

  for (const o of occurrences) {
    if (o.date !== dateKey) continue;
    const start = parseTimeToMinutes(o.startTime);
    const end = parseTimeToMinutes(o.endTime);
    if (start == null || end == null || end <= start) {
      warnings?.push(`Skipped "${o.title}" on ${dateKey} — its time looks invalid.`);
      continue;
    }
    out.push({ start, end });
  }

  for (const s of sessions) {
    if (s.date !== dateKey) continue;
    const start = parseTimeToMinutes(s.start);
    if (start == null || s.durationMin <= 0) continue;
    out.push({ start, end: start + s.durationMin });
  }

  return out;
}

/**
 * Default protected meal windows, subtracted from every day's free time so the
 * planner never schedules study straight through lunch or dinner (minutes from
 * local midnight). These only bite when they land inside real free time — a meal
 * that falls inside a class, outside the working window, or in the past (on
 * "today", after the day-start clamp) is harmlessly clamped/merged away.
 * One place to tune; both engines subtract the same list.
 */
export const MEAL_BREAKS: Interval[] = [
  { start: 12 * 60 + 30, end: 13 * 60 + 30 }, // lunch 12:30–13:30
  { start: 18 * 60 + 30, end: 19 * 60 + 30 }, // dinner 18:30–19:30
];

export interface SlotOpts {
  dayStartMin: number;
  dayEndMin: number;
  quietStart: number | null;
  quietEnd: number | null;
  /** Drop gaps shorter than this (usually the mode's work-block length). */
  minSlotMin: number;
  /** Protected windows (e.g. meals) kept free of study. Defaults to none. */
  meals?: Interval[];
}

/**
 * Invert busy intervals into free gaps inside the working window, after
 * subtracting quiet hours + meal windows and clamping anything crossing the
 * window boundary.
 */
export function freeSlotsForDay(busy: Interval[], opts: SlotOpts): Interval[] {
  const windowStart = opts.dayStartMin;
  const windowEnd = opts.dayEndMin;
  if (windowEnd <= windowStart) return [];

  const blockers = [
    ...busy,
    ...quietIntervalsWithin(opts.quietStart, opts.quietEnd),
    ...(opts.meals ?? []),
  ]
    .map((iv) => clampInterval(iv, windowStart, windowEnd))
    .filter((iv): iv is Interval => iv != null);

  const merged = mergeOverlaps(blockers);

  const slots: Interval[] = [];
  let cursor = windowStart;
  for (const b of merged) {
    if (b.start > cursor) slots.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < windowEnd) slots.push({ start: cursor, end: windowEnd });

  return slots.filter((s) => s.end - s.start >= opts.minSlotMin);
}

// --- Exam-review spacing (SM-2 style) ---------------------------------------

/**
 * Day-offsets BEFORE an exam to place review blocks on, using an expanding
 * spaced-repetition schedule. Returns offsets in [1, daysUntilExam], earliest
 * (largest offset) first. Compressed when the exam is close, extended when far.
 */
export function examReviewOffsets(daysUntilExam: number): number[] {
  if (daysUntilExam <= 0) return [];
  let base: number[];
  if (daysUntilExam < 7) base = [3, 2, 1];
  else if (daysUntilExam <= 21) base = [14, 7, 3, 1];
  else base = [14, 7, 3, 1];
  if (daysUntilExam > 30) base = [30, ...base];
  if (daysUntilExam > 60) base = [60, ...base];
  const seen = new Set<number>();
  return base
    .filter((o) => o >= 1 && o <= daysUntilExam && !seen.has(o) && (seen.add(o), true))
    .sort((a, b) => b - a);
}

// --- Task modeling + scoring ------------------------------------------------

export interface StudyTask {
  /** Stable id: `hw:<id>`, `exam:<eventId>:<offset>`, or `lecture:<courseId>`. */
  ref: string;
  kind: "homework" | "exam-review" | "lecture-review";
  title: string;
  courseCode: string | null;
  color: string;
  /** Never schedule on/after this day. */
  deadlineKey: string;
  remainingMin: number;
  importance: number; // 0..10
  urgency: number; // 0..10
  hard: boolean;
  /** Exam-review only: the exact day this block must land on. */
  fixedDayKey?: string;
}

/** Rough effort for a piece of homework from its grade weight. */
export function heuristicHomeworkMinutes(weight: number | null): number {
  if (weight == null || weight <= 0) return 60;
  if (weight >= 20) return 180;
  if (weight >= 10) return 120;
  return 60;
}

export function homeworkCompletionPct(hw: HomeworkAssignment): number {
  if (hw.progressPct != null) return Math.max(0, Math.min(100, hw.progressPct));
  return hw.status === "pending" ? 0 : 100;
}

export function importanceFromWeight(weight: number | null, base: number): number {
  if (weight == null) return base;
  return Math.max(1, Math.min(10, Math.round(base + weight / 5)));
}

/** Deadline-urgency bucket (Reclaim/EDF-style). */
export function urgencyFromDays(days: number): number {
  if (days <= 1) return 10;
  if (days <= 3) return 8;
  if (days <= 7) return 6;
  if (days <= 14) return 4;
  return 2;
}

export function priorityOf(task: StudyTask): number {
  return task.importance * 0.6 + task.urgency * 0.4;
}

function reviewMinutes(examWeight: number | null): number {
  if (examWeight == null) return 60;
  return examWeight >= 30 ? 90 : 60;
}

/** Catch-up effort budgeted per unwatched meeting. */
export const LECTURE_REVIEW_MIN_PER_MEETING = 45;

/**
 * How many of a course's class meetings have already happened but aren't marked
 * watched — the review backlog. Derived by expanding class occurrences up to
 * today (there is no stored "occurred so far" count) and subtracting the total
 * watched tally. Falls back to an 8-week lookback when no semester term is set,
 * mirroring how the app degrades without term bounds. Day-granular.
 */
export function lectureBacklogFor(
  course: Course,
  events: ScheduleEvent[],
  now: Date,
  semesterStart?: string | null,
  semesterEnd?: string | null,
): number {
  const todayKey = toDateKey(now);
  const occurredFrom = semesterStart ?? addDaysKey(todayKey, -56);
  const classes = events.filter(
    (e) => e.category === "class" && matchesCode(e.courseCode, course.code),
  );
  if (classes.length === 0) return 0;
  const occurred = expandScheduleEvents(classes, occurredFrom, todayKey, {
    start: semesterStart,
    end: semesterEnd,
  }).length;
  const watched = course.watchedLectures + course.watchedTutorials + course.watchedLabs;
  return Math.max(0, occurred - watched);
}

// --- Distribution output ----------------------------------------------------

export interface ProposedBlock {
  ref: string;
  taskKind: "homework" | "exam-review" | "lecture-review";
  dateKey: string;
  startTime: string;
  endTime: string;
  title: string;
  courseCode: string | null;
  color: string;
}

export interface WeekLoad {
  weekKey: string;
  plannedMin: number;
}

export interface PlanDraft {
  mode: PlanMode;
  blocks: ProposedBlock[];
  weekLoad: WeekLoad[];
  totalPlannedMin: number;
  warnings: string[];
}

export interface PlanInput {
  now: Date;
  horizonDays: number;
  events: ScheduleEvent[];
  sessions: Session[];
  homework: HomeworkAssignment[];
  mode: PlanMode;
  /** Optional override of the mode's daily cap. */
  dailyCapMin?: number | null;
  dayStartMin: number;
  dayEndMin: number;
  quietStart: number | null;
  quietEnd: number | null;
  semesterStart?: string | null;
  semesterEnd?: string | null;
  /** From `computeWellbeing().recovery` — throttles when ready && strained. */
  recovery?: { ready: boolean; status: "balanced" | "moderate" | "strained" } | null;
  /** Circadian best-window label, e.g. "Morning (6–12)". */
  bestWindow?: string | null;
  /** Courses, for lecture-review catch-up. Omit/null to skip that task source. */
  courses?: Course[] | null;
  /** When true (and `courses` given), schedule catch-up on unwatched meetings. */
  includeLectureReview?: boolean;
}

/** Map a circadian bucket label to a representative minute-of-day. */
function bestWindowMinutes(label: string | null | undefined): number | null {
  if (!label) return null;
  if (label.startsWith("Morning")) return 9 * 60;
  if (label.startsWith("Afternoon")) return 14 * 60;
  if (label.startsWith("Evening")) return 19 * 60;
  if (label.startsWith("Night")) return 22 * 60;
  return null;
}

interface DayState {
  key: string;
  weekKey: string;
  /** Remaining free intervals (consumed as blocks are placed). */
  intervals: Interval[];
  usedMin: number;
  blockCount: number;
}

interface WorkingTask extends StudyTask {
  /** Minutes we still intend to place, keyed by day. */
  dayTargets: Map<string, number>;
  placedMin: number;
  intendedMin: number;
}

/**
 * Produce a draft plan. Never writes anything — the result is reviewed and only
 * committed after the user approves.
 */
export function planStudyBlocks(input: PlanInput): PlanDraft {
  const warnings: string[] = [];
  const config = MODE_CONFIGS[input.mode];
  const dailyCap = clampCap(input.dailyCapMin, config.dailyCapMin);
  const weeklyCap = dailyCap * BURNOUT.weeklyCapMultiplier;
  const workBlock = config.workBlockMin;

  const effortScale =
    input.recovery?.ready && input.recovery.status === "strained" ? BURNOUT.strainedThrottle : 1;

  const todayKey = toDateKey(input.now);
  const nowMinutes = input.now.getHours() * 60 + input.now.getMinutes();
  const horizonDays = Math.max(1, Math.floor(input.horizonDays));
  const horizonEnd = addDaysKey(todayKey, horizonDays - 1);

  // Prior generated study blocks will be replaced on commit — don't treat them
  // as busy. Hand-made study blocks (plan_generated=false) stay as commitments.
  const planningEvents = input.events.filter((e) => !(e.category === "study" && e.planGenerated));
  const occurrences = expandScheduleEvents(planningEvents, todayKey, horizonEnd, {
    start: input.semesterStart,
    end: input.semesterEnd,
  });

  // Build the free-slot map for each day in the horizon.
  const days: DayState[] = [];
  for (let i = 0; i < horizonDays; i += 1) {
    const key = addDaysKey(todayKey, i);
    const busy = busyIntervalsForDay(occurrences, input.sessions, key, warnings);
    const dayStart = key === todayKey ? Math.max(input.dayStartMin, nowMinutes) : input.dayStartMin;
    const intervals = freeSlotsForDay(busy, {
      dayStartMin: dayStart,
      dayEndMin: input.dayEndMin,
      quietStart: input.quietStart,
      quietEnd: input.quietEnd,
      minSlotMin: workBlock,
      meals: MEAL_BREAKS,
    });
    days.push({ key, weekKey: weekKeyFor(key), intervals, usedMin: 0, blockCount: 0 });
  }
  const dayByKey = new Map(days.map((d) => [d.key, d]));

  // Build the task list from unfinished homework + upcoming exams.
  const tasks = buildTasks(input, todayKey, horizonEnd, warnings);

  // Stable priority sort: highest priority, then soonest deadline, then ref.
  tasks.sort((a, b) => {
    const p = priorityOf(b) - priorityOf(a);
    if (p !== 0) return p;
    if (a.deadlineKey !== b.deadlineKey) return a.deadlineKey.localeCompare(b.deadlineKey);
    return a.ref.localeCompare(b.ref);
  });

  // Phase A — spread each task's effort across its eligible days.
  const working = tasks.map((t) => toWorkingTask(t, days, todayKey, workBlock, effortScale));

  // Phase B — place blocks day by day (date order ⇒ earlier work naturally wins).
  const bestWinMin = bestWindowMinutes(input.bestWindow);
  const blocks: ProposedBlock[] = [];
  const weekUsed = new Map<string, number>();

  for (const day of days) {
    const wantHere = working
      .filter((t) => (t.dayTargets.get(day.key) ?? 0) - placedOnDay(t, day.key, blocks) > 0)
      .sort((a, b) => priorityOf(b) - priorityOf(a) || a.ref.localeCompare(b.ref));
    if (wantHere.length === 0) continue;

    const placeOne = (task: WorkingTask): boolean => {
      if (day.blockCount >= config.maxBlocksPerDay) return false;
      if (day.usedMin + workBlock > dailyCap) return false;
      if ((weekUsed.get(day.weekKey) ?? 0) + workBlock > weeklyCap) return false;
      const remainingTarget =
        (task.dayTargets.get(day.key) ?? 0) - placedOnDay(task, day.key, blocks);
      if (remainingTarget <= 0) return false;

      // Placement target: hard tasks aim at the circadian window; otherwise, for
      // interleave modes with the day split into several free chunks (e.g. by
      // meals), rotate across chunks so a day's blocks spread over morning /
      // afternoon / evening instead of all piling into the earliest one. A
      // single-chunk day (or Deep Focus) keeps the earliest-start behaviour.
      const target =
        task.hard && bestWinMin != null
          ? bestWinMin
          : config.interleave && day.intervals.length > 1
            ? (day.intervals[day.blockCount % day.intervals.length]?.start ?? 0)
            : (day.intervals[0]?.start ?? 0);
      const slot = pickSlot(day.intervals, workBlock, target);
      if (slot == null) return false;

      const iv = day.intervals[slot.index];
      const start = iv.start;
      const end = start + workBlock;
      blocks.push({
        ref: task.ref,
        taskKind: task.kind,
        dateKey: day.key,
        startTime: minutesToTime(start),
        endTime: minutesToTime(end),
        title: task.title,
        courseCode: task.courseCode,
        color: task.color,
      });

      // Reserve a break after the block; long break every N blocks.
      const isLong = (day.blockCount + 1) % config.blocksBeforeLongBreak === 0;
      const gap = isLong ? config.longBreakMin : config.breakMin;
      const nextStart = end + gap;
      if (iv.end - nextStart > 0) day.intervals[slot.index] = { start: nextStart, end: iv.end };
      else day.intervals.splice(slot.index, 1);

      day.usedMin += workBlock;
      day.blockCount += 1;
      task.placedMin += workBlock;
      weekUsed.set(day.weekKey, (weekUsed.get(day.weekKey) ?? 0) + workBlock);
      return true;
    };

    if (config.interleave) {
      // Round-robin: one block per task per pass until nothing more fits.
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const task of wantHere) {
          if (placeOne(task)) progressed = true;
        }
        if (day.blockCount >= config.maxBlocksPerDay || day.usedMin + workBlock > dailyCap) break;
      }
    } else {
      // One subject at a time until its day-target (or the day) is exhausted.
      for (const task of wantHere) {
        // eslint-disable-next-line no-empty
        while (placeOne(task)) {}
      }
    }
  }

  // Leftovers that couldn't be placed → warnings.
  for (const task of working) {
    const shortfall = task.intendedMin - task.placedMin;
    if (shortfall >= workBlock) {
      const n = Math.round(shortfall / workBlock);
      warnings.push(
        `Couldn't fit ${n} block${n === 1 ? "" : "s"} of "${task.title}" before ${task.deadlineKey}.`,
      );
    }
  }

  blocks.sort((a, b) =>
    a.dateKey !== b.dateKey
      ? a.dateKey.localeCompare(b.dateKey)
      : a.startTime.localeCompare(b.startTime),
  );

  const weekLoad: WeekLoad[] = [...weekUsed.entries()]
    .map(([weekKey, plannedMin]) => ({ weekKey, plannedMin }))
    .sort((a, b) => a.weekKey.localeCompare(b.weekKey));
  const totalPlannedMin = blocks.length * workBlock;

  return { mode: input.mode, blocks, weekLoad, totalPlannedMin, warnings };
}

// --- internals --------------------------------------------------------------

function clampCap(override: number | null | undefined, fallback: number): number {
  if (override == null || !Number.isFinite(override)) return fallback;
  return Math.max(30, Math.min(600, Math.round(override)));
}

/**
 * Build the task list (homework / exam review / lecture review) for a plan
 * window. Exported so the LLM planner feeds Gemini the exact same tasks the
 * heuristic engine schedules — one source of truth for "what needs doing".
 */
export function buildTasks(
  input: PlanInput,
  todayKey: string,
  horizonEnd: string,
  warnings: string[],
): StudyTask[] {
  const tasks: StudyTask[] = [];

  // Homework still needing work.
  for (const hw of input.homework) {
    if (!hw.dueDate) continue;
    const pct = homeworkCompletionPct(hw);
    if (pct >= 100) continue;
    const base =
      hw.estimatedMinutes && hw.estimatedMinutes > 0
        ? hw.estimatedMinutes
        : heuristicHomeworkMinutes(hw.weight);
    const remaining = Math.round(base * (1 - pct / 100));
    if (remaining <= 0) continue;
    const days = diffDays(todayKey, hw.dueDate);
    const importance = importanceFromWeight(hw.weight, 4);
    tasks.push({
      ref: `hw:${hw.id}`,
      kind: "homework",
      title: hw.title,
      courseCode: hw.courseCode,
      color: STUDY_COLOR,
      deadlineKey: hw.dueDate,
      remainingMin: remaining,
      importance,
      urgency: urgencyFromDays(days),
      hard: importance >= 7,
    });
  }

  // Exam review — spaced blocks before each upcoming exam in range.
  for (const ev of input.events) {
    if (ev.category !== "exam" || ev.kind !== "once" || !ev.eventDate) continue;
    if (ev.eventDate < todayKey || ev.eventDate > horizonEnd) continue;
    const daysUntil = diffDays(todayKey, ev.eventDate);
    const offsets = examReviewOffsets(daysUntil);
    if (offsets.length === 0) continue;
    const importance = importanceFromWeight(ev.examWeight, 6);
    const minutes = reviewMinutes(ev.examWeight);
    for (const offset of offsets) {
      const dayKey = addDaysKey(ev.eventDate, -offset);
      if (dayKey < todayKey || dayKey > horizonEnd) continue;
      tasks.push({
        ref: `exam:${ev.id}:${offset}`,
        kind: "exam-review",
        title: `Review: ${ev.title}`,
        courseCode: ev.courseCode,
        color: STUDY_COLOR,
        deadlineKey: ev.eventDate,
        remainingMin: minutes,
        importance,
        urgency: urgencyFromDays(daysUntil),
        hard: true,
        fixedDayKey: dayKey,
      });
    }
  }

  // Lecture / material review — catch up on meetings that have happened but
  // aren't marked watched, spread before the course's next exam.
  if (input.includeLectureReview && input.courses) {
    for (const course of input.courses) {
      const backlog = lectureBacklogFor(
        course,
        input.events,
        input.now,
        input.semesterStart,
        input.semesterEnd,
      );
      if (backlog <= 0) continue;
      const exam = nextExamForCourse(input.events, course.code, input.now);
      // Deadline: the next exam (spread before it), else horizonEnd+1 so it
      // spreads across the whole plan window.
      const deadlineKey =
        exam && exam.dateKey > todayKey ? exam.dateKey : addDaysKey(horizonEnd, 1);
      tasks.push({
        ref: `lecture:${course.id}`,
        kind: "lecture-review",
        title: `Catch up: ${course.code} lectures`,
        courseCode: course.code,
        color: course.color || STUDY_COLOR,
        deadlineKey,
        remainingMin: backlog * LECTURE_REVIEW_MIN_PER_MEETING,
        importance: 5,
        urgency: exam ? urgencyFromDays(exam.daysUntil) : 2,
        hard: false,
      });
    }
  }

  if (tasks.length === 0) {
    warnings.push(
      "Nothing to schedule — no unfinished homework, upcoming exams, or lecture backlog in range.",
    );
  }
  return tasks;
}

/** Whole days from `fromKey` to `toKey` (negative if `toKey` is earlier). */
function diffDays(fromKey: string, toKey: string): number {
  const from = parseDateKey(fromKey).getTime();
  const to = parseDateKey(toKey).getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

function toWorkingTask(
  task: StudyTask,
  days: DayState[],
  todayKey: string,
  workBlock: number,
  effortScale: number,
): WorkingTask {
  const dayTargets = new Map<string, number>();
  const scaled = task.remainingMin * effortScale;

  if (task.kind === "exam-review" && task.fixedDayKey) {
    // Fixed spaced-repetition day; round up to whole blocks.
    const target = Math.max(workBlock, Math.ceil(scaled / workBlock) * workBlock);
    if (days.some((d) => d.key === task.fixedDayKey)) dayTargets.set(task.fixedDayKey, target);
    return { ...task, dayTargets, placedMin: 0, intendedMin: sum(dayTargets) };
  }

  // Homework: front-load across eligible days (today .. day-before deadline).
  const lastKey = addDaysKey(task.deadlineKey, -1);
  let eligible = days.filter((d) => d.key >= todayKey && d.key <= lastKey).map((d) => d.key);
  // Overdue or due today → catch up today rather than dropping it.
  if (eligible.length === 0 && task.deadlineKey <= todayKey) eligible = [todayKey];
  if (eligible.length === 0) {
    return { ...task, dayTargets, placedMin: 0, intendedMin: 0 };
  }

  const totalBlocks = Math.max(1, Math.ceil(scaled / workBlock));
  const n = eligible.length;
  const weights = eligible.map((_, i) => n - i); // earlier days heavier
  const wsum = weights.reduce((a, b) => a + b, 0);

  // Distribute whole blocks by largest-remainder on the front-loaded weights.
  const exact = weights.map((w) => (totalBlocks * w) / wsum);
  const floors = exact.map((x) => Math.floor(x));
  let left = totalBlocks - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const blocksPerDay = [...floors];
  for (const { i } of order) {
    if (left <= 0) break;
    blocksPerDay[i] += 1;
    left -= 1;
  }

  eligible.forEach((key, i) => {
    if (blocksPerDay[i] > 0) dayTargets.set(key, blocksPerDay[i] * workBlock);
  });
  return { ...task, dayTargets, placedMin: 0, intendedMin: sum(dayTargets) };
}

function sum(m: Map<string, number>): number {
  let t = 0;
  for (const v of m.values()) t += v;
  return t;
}

/** Minutes already placed for a task on a given day (sum of block spans). */
function placedOnDay(task: WorkingTask, dayKey: string, blocks: ProposedBlock[]): number {
  let mins = 0;
  for (const b of blocks) {
    if (b.ref !== task.ref || b.dateKey !== dayKey) continue;
    const s = parseTimeToMinutes(b.startTime) ?? 0;
    const e = parseTimeToMinutes(b.endTime) ?? 0;
    mins += Math.max(0, e - s);
  }
  return mins;
}

/**
 * Choose the free interval to place a block in. Among intervals long enough,
 * pick the one whose start is closest to `target` (best window / morning),
 * breaking ties toward the earlier interval. Blocks always start at the
 * interval start to pack tightly and stay deterministic.
 */
function pickSlot(
  intervals: Interval[],
  workBlock: number,
  target: number,
): { index: number } | null {
  let bestIndex = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < intervals.length; i += 1) {
    const iv = intervals[i];
    if (iv.end - iv.start < workBlock) continue;
    const dist = Math.abs(iv.start - target);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }
  return bestIndex === -1 ? null : { index: bestIndex };
}
