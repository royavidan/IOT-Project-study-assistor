// LLM planner prompt builder. Pure and deterministic: same input → same
// prompt string, so it's unit-testable and never embeds "now"/randomness.
// The model is given PRE-COMPUTED free slots (it never does interval math) and
// the exact task list the heuristic engine schedules (`buildTasks`), which is
// what keeps its output inside the deterministic validator's reach.

import type { Interval, StudyTask } from "@/features/planner/planner";
import { minutesToTime } from "@/features/planner/planner";

export interface LlmPromptInput {
  todayKey: string;
  horizonDays: number;
  mode: {
    name: string;
    workBlockMin: number;
    breakMin: number;
    longBreakMin: number;
    blocksBeforeLongBreak: number;
    dailyCapMin: number;
    maxBlocksPerDay: number;
  };
  /** Per-day free gaps (already minus classes, exams, sessions, quiet hours, meals). */
  freeSlotsByDay: Map<string, Interval[]>;
  /** Protected meal windows (already removed from freeSlotsByDay), for context. */
  meals: Interval[];
  tasks: StudyTask[];
  recoveryStatus: "balanced" | "moderate" | "strained" | "unknown";
  /** Mean tiredness (1-5) of the last check-ins, when any exist. */
  avgTirednessLast3: number | null;
  bestWindow: string | null;
}

const SYSTEM = [
  "You are a study-scheduling engine for a university student. You receive the",
  "student's open tasks and the FREE time slots of the coming days, and you",
  "return study blocks as JSON matching the response schema. Plan like a",
  "thoughtful human coach, not a calendar-packer: a good plan is paced and",
  "sustainable, NOT maximal. Under-filling a day is fine.",
  "",
  "HARD RULES (never break):",
  "- Place blocks ONLY inside the provided free slots (they already exclude",
  "  classes, exams, logged sessions, quiet hours AND meals). Never invent times.",
  "- Never exceed dailyCapMin minutes or maxBlocksPerDay blocks on one day.",
  "  Prefer blocks of about workBlockMin minutes.",
  "- Leave at least breakMin minutes of EMPTY time between consecutive blocks on",
  "  the same day; after blocksBeforeLongBreak blocks in a row leave longBreakMin.",
  "  Never place two blocks back-to-back.",
  "- Never place a block on or after a task's deadline day. Exam-review tasks with",
  "  a fixedDay must land exactly on that day (spaced repetition).",
  "- taskRef must be copied verbatim from the tasks list.",
  "",
  "PACING (make the plan humane — this is the point):",
  "- Spread the day out: distribute a day's blocks across morning, afternoon and",
  "  evening free slots instead of clustering them into one continuous run.",
  "- Ramp up BEFORE deadlines: spread a task's remaining minutes across the days",
  "  before its deadline, heavier earlier. Don't dump a whole task into one day.",
  "- Respect energy: put tasks marked hard in the bestWindow (the student's peak",
  "  hours); schedule lighter or review work when energy is lower (late day, or",
  "  when avgTirednessLast3 is high).",
  "- Interleave subjects: alternate between courses across a day rather than long",
  "  single-subject grinds — it aids retention and reduces fatigue.",
  "- Leave a short buffer after a class before studying; don't start a block the",
  "  moment a class ends.",
  "- If recoveryStatus is 'strained' or avgTirednessLast3 is 4 or higher, plan",
  "  roughly 25% less total time and say so in assumptions.",
  "",
  "OUTPUT:",
  "- Use each block's 'reason' field to briefly justify the choice (why this task,",
  "  why this time — e.g. 'hard task in your morning peak', 'light review after",
  "  dinner', 'spaced exam review').",
  "- List EVERY assumption you make in the assumptions array.",
  "- Output ONLY JSON conforming to the schema. No prose outside it.",
].join("\n");

/** Build the {system, user} pair for a plan request. */
export function buildPlannerPrompt(input: LlmPromptInput): { system: string; user: string } {
  const freeSlots = [...input.freeSlotsByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, slots]) => ({
      date,
      slots: slots.map((s) => ({ start: minutesToTime(s.start), end: minutesToTime(s.end) })),
    }));

  const tasks = input.tasks.map((t) => ({
    ref: t.ref,
    kind: t.kind,
    title: t.title,
    courseCode: t.courseCode,
    deadline: t.deadlineKey,
    remainingMin: t.remainingMin,
    importance: t.importance,
    urgency: t.urgency,
    hard: t.hard,
    ...(t.fixedDayKey ? { fixedDay: t.fixedDayKey } : {}),
  }));

  const meals = input.meals.map((m) => ({
    start: minutesToTime(m.start),
    end: minutesToTime(m.end),
  }));

  const user = JSON.stringify(
    {
      today: input.todayKey,
      horizonDays: input.horizonDays,
      mode: input.mode,
      freeSlots,
      meals,
      tasks,
      wellbeing: {
        recoveryStatus: input.recoveryStatus,
        avgTirednessLast3: input.avgTirednessLast3,
      },
      bestWindow: input.bestWindow,
    },
    null,
    1,
  );

  return { system: SYSTEM, user };
}
