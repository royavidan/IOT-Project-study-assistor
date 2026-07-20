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
    dailyCapMin: number;
    maxBlocksPerDay: number;
  };
  /** Per-day free gaps (already minus classes, exams, sessions, quiet hours). */
  freeSlotsByDay: Map<string, Interval[]>;
  tasks: StudyTask[];
  recoveryStatus: "balanced" | "moderate" | "strained" | "unknown";
  /** Mean tiredness (1-5) of the last check-ins, when any exist. */
  avgTirednessLast3: number | null;
  bestWindow: string | null;
}

const SYSTEM = [
  "You are a study-scheduling engine for a university student. You receive the",
  "student's open tasks and the FREE time slots of the coming days, and you",
  "return study blocks as JSON matching the response schema. Rules:",
  "- Place blocks ONLY inside the provided free slots (they already exclude",
  "  classes, exams, logged sessions and quiet hours). Never invent other times.",
  "- Never schedule more than dailyCapMin minutes or maxBlocksPerDay blocks on",
  "  one day. Prefer blocks of about workBlockMin minutes.",
  "- Ramp up BEFORE deadlines: spread a task's remaining minutes across the days",
  "  before its deadline, heavier earlier (anti-cramming). Never place a block",
  "  on or after the task's deadline day.",
  "- Exam-review tasks with a fixedDay must land exactly on that day (spaced",
  "  repetition). Prefer the bestWindow for tasks marked hard.",
  "- If recoveryStatus is 'strained' or avgTirednessLast3 is 4 or higher, plan",
  "  roughly 25% less total time and say so in assumptions.",
  "- taskRef must be copied verbatim from the tasks list.",
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

  const user = JSON.stringify(
    {
      today: input.todayKey,
      horizonDays: input.horizonDays,
      mode: input.mode,
      freeSlots,
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
