// The LLM plan pipeline: PlanInput → free slots → prompt → Gemini → sanitize
// → PlanDraft. Shared by the plan server fn (Phase A) and the check-in
// auto-replan (Phase B). Any model failure degrades to the deterministic
// heuristic engine (`planStudyBlocks`) so a plan is ALWAYS produced.

import "@tanstack/react-start/server-only";

import { toDateKey } from "@/lib/dates";
import {
  addDaysKey,
  buildTasks,
  busyIntervalsForDay,
  freeSlotsForDay,
  MEAL_BREAKS,
  MODE_CONFIGS,
  planStudyBlocks,
  weekKeyFor,
  type Interval,
  type PlanDraft,
  type PlanInput,
  type ProposedBlock,
} from "@/features/planner/planner";
import { expandScheduleEvents, parseTimeToMinutes } from "@/features/schedule/schedule";
import { planFingerprint } from "@/features/planner/fingerprint";
import { buildPlannerPrompt } from "./prompt";
import { llmPlanResponseSchema, llmPlanZodSchema } from "./schema";
import { generateStructured, LlmOutputError, LlmUnavailableError } from "./gemini.server";
import { sanitizeLlmBlocks, type RejectedBlock } from "./postprocess";

/** Blocks shorter than this are dropped by the validator. */
const MIN_BLOCK_MIN = 20;

export interface LlmPlanResult {
  engine: "gemini" | "heuristic";
  /** Set when the model failed and the heuristic engine produced the draft. */
  fallbackReason: string | null;
  draft: PlanDraft;
  /** The model's stated assumptions (empty on the heuristic path). */
  assumptions: string[];
  /** Model proposals the validator dropped, with reasons. */
  rejected: {
    taskRef: string;
    dateKey: string;
    startTime: string;
    endTime: string;
    reason: string;
  }[];
  summary: string | null;
  fingerprint: string;
}

/** Free slots per day, mirroring the heuristic engine's derivation. */
export function computeFreeSlotsByDay(input: PlanInput): Map<string, Interval[]> {
  const todayKey = toDateKey(input.now);
  const nowMinutes = input.now.getHours() * 60 + input.now.getMinutes();
  const horizonDays = Math.max(1, Math.floor(input.horizonDays));
  const horizonEnd = addDaysKey(todayKey, horizonDays - 1);

  const planningEvents = input.events.filter((e) => !(e.category === "study" && e.planGenerated));
  const occurrences = expandScheduleEvents(planningEvents, todayKey, horizonEnd, {
    start: input.semesterStart,
    end: input.semesterEnd,
  });

  const byDay = new Map<string, Interval[]>();
  for (let i = 0; i < horizonDays; i += 1) {
    const key = addDaysKey(todayKey, i);
    const busy = busyIntervalsForDay(occurrences, input.sessions, key);
    const dayStart = key === todayKey ? Math.max(input.dayStartMin, nowMinutes) : input.dayStartMin;
    const slots = freeSlotsForDay(busy, {
      dayStartMin: dayStart,
      dayEndMin: input.dayEndMin,
      quietStart: input.quietStart,
      quietEnd: input.quietEnd,
      minSlotMin: MIN_BLOCK_MIN,
      meals: MEAL_BREAKS,
    });
    if (slots.length > 0) byDay.set(key, slots);
  }
  return byDay;
}

function dailyCapFor(input: PlanInput): number {
  const fallback = MODE_CONFIGS[input.mode].dailyCapMin;
  if (input.dailyCapMin == null || !Number.isFinite(input.dailyCapMin)) return fallback;
  return Math.max(30, Math.min(600, Math.round(input.dailyCapMin)));
}

function draftFromBlocks(input: PlanInput, blocks: ProposedBlock[], warnings: string[]): PlanDraft {
  const weekUsed = new Map<string, number>();
  let total = 0;
  for (const b of blocks) {
    const mins = (parseTimeToMinutes(b.endTime) ?? 0) - (parseTimeToMinutes(b.startTime) ?? 0);
    total += Math.max(0, mins);
    const wk = weekKeyFor(b.dateKey);
    weekUsed.set(wk, (weekUsed.get(wk) ?? 0) + Math.max(0, mins));
  }
  return {
    mode: input.mode,
    blocks,
    weekLoad: [...weekUsed.entries()]
      .map(([weekKey, plannedMin]) => ({ weekKey, plannedMin }))
      .sort((a, b) => a.weekKey.localeCompare(b.weekKey)),
    totalPlannedMin: total,
    warnings,
  };
}

/** Run the full LLM plan pipeline for an already-loaded PlanInput. */
export async function runLlmPlan(
  input: PlanInput,
  avgTirednessLast3: number | null,
): Promise<LlmPlanResult> {
  const fingerprint = planFingerprint(input.events, input.homework);
  const todayKey = toDateKey(input.now);
  const horizonEnd = addDaysKey(todayKey, Math.max(1, Math.floor(input.horizonDays)) - 1);

  const warnings: string[] = [];
  const tasks = buildTasks(input, todayKey, horizonEnd, warnings);
  if (tasks.length === 0) {
    return {
      engine: "heuristic",
      fallbackReason: null,
      draft: draftFromBlocks(input, [], warnings),
      assumptions: [],
      rejected: [],
      summary: null,
      fingerprint,
    };
  }

  const freeSlotsByDay = computeFreeSlotsByDay(input);
  const config = MODE_CONFIGS[input.mode];
  const { system, user } = buildPlannerPrompt({
    todayKey,
    horizonDays: input.horizonDays,
    mode: {
      name: input.mode,
      workBlockMin: config.workBlockMin,
      breakMin: config.breakMin,
      longBreakMin: config.longBreakMin,
      blocksBeforeLongBreak: config.blocksBeforeLongBreak,
      dailyCapMin: dailyCapFor(input),
      maxBlocksPerDay: config.maxBlocksPerDay,
    },
    freeSlotsByDay,
    meals: MEAL_BREAKS,
    tasks,
    recoveryStatus: input.recovery?.ready ? input.recovery.status : "unknown",
    avgTirednessLast3,
    bestWindow: input.bestWindow ?? null,
  });

  try {
    const response = await generateStructured({
      system,
      user,
      responseSchema: llmPlanResponseSchema,
      zodSchema: llmPlanZodSchema,
    });
    const sanitized = sanitizeLlmBlocks(response, tasks, freeSlotsByDay, {
      todayKey,
      dailyCapMin: dailyCapFor(input),
      minBlockMin: MIN_BLOCK_MIN,
      maxBlocksPerDay: config.maxBlocksPerDay,
      minGapMin: config.breakMin,
    });
    // "A plan is ALWAYS produced": a schema-valid response whose blocks all
    // failed validation (or came back empty) must not yield an empty draft —
    // especially on the check-in path, where an empty draft would be
    // auto-committed and DELETE the user's existing generated blocks.
    if (sanitized.blocks.length === 0) {
      return {
        engine: "heuristic",
        fallbackReason:
          "The AI's proposals didn't fit your calendar — used the standard engine instead.",
        draft: planStudyBlocks(input),
        assumptions: response.assumptions ?? [],
        rejected: sanitized.rejected.map(flattenRejected),
        summary: null,
        fingerprint,
      };
    }
    return {
      engine: "gemini",
      fallbackReason: null,
      draft: draftFromBlocks(input, sanitized.blocks, [...warnings, ...sanitized.warnings]),
      assumptions: response.assumptions ?? [],
      rejected: sanitized.rejected.map(flattenRejected),
      summary: response.summary,
      fingerprint,
    };
  } catch (error) {
    // Any model failure (missing key, invalid output twice, network) degrades
    // to the deterministic engine — a plan is always produced.
    const reason =
      error instanceof LlmUnavailableError
        ? "AI is not configured on this server — used the standard engine."
        : error instanceof LlmOutputError
          ? "The AI returned invalid output twice — used the standard engine."
          : "The AI service was unreachable — used the standard engine.";
    const draft = planStudyBlocks(input);
    return {
      engine: "heuristic",
      fallbackReason: reason,
      draft,
      assumptions: [],
      rejected: [],
      summary: null,
      fingerprint,
    };
  }
}

function flattenRejected(r: RejectedBlock) {
  return {
    taskRef: r.block.taskRef,
    dateKey: r.block.dateKey,
    startTime: r.block.startTime,
    endTime: r.block.endTime,
    reason: r.reason,
  };
}
