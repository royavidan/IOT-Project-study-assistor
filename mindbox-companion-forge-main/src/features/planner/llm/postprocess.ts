// Deterministic validator for LLM-proposed study blocks. The model's output is
// never trusted: every block is checked against the task list and clipped into
// free slots RECOMPUTED FROM DB TRUTH (not from what the model was told), the
// daily cap is enforced, and accepted blocks consume their slot so later blocks
// can't overlap them. Rejected blocks are returned with a reason so the UI can
// show "N proposals didn't fit and were dropped". Pure — no I/O.

import type { Interval, ProposedBlock, StudyTask } from "@/features/planner/planner";
import { minutesToTime } from "@/features/planner/planner";
import { parseTimeToMinutes } from "@/features/schedule/schedule";
import type { LlmPlanBlock, LlmPlanResponse } from "./schema";

export interface RejectedBlock {
  block: LlmPlanBlock;
  reason: string;
}

export interface SanitizeResult {
  blocks: ProposedBlock[];
  rejected: RejectedBlock[];
  warnings: string[];
}

export interface SanitizeOpts {
  /** First day of the plan window (blocks before it can't exist). */
  todayKey: string;
  /** Max study minutes per day (mode default or the user's override). */
  dailyCapMin: number;
  /** Blocks shorter than this after clipping are dropped. Default 20. */
  minBlockMin?: number;
  /** Hard ceiling on blocks per day (the mode's lever). Default unlimited. */
  maxBlocksPerDay?: number;
}

/**
 * Validate + clip the model's blocks. `freeSlotsByDay` must be freshly derived
 * from the user's real schedule (see the plan server fn); a day missing from
 * the map means "no free time that day".
 */
export function sanitizeLlmBlocks(
  raw: Pick<LlmPlanResponse, "blocks">,
  tasks: StudyTask[],
  freeSlotsByDay: Map<string, Interval[]>,
  opts: SanitizeOpts,
): SanitizeResult {
  const minBlock = opts.minBlockMin ?? 20;
  const maxPerDay = opts.maxBlocksPerDay ?? Number.POSITIVE_INFINITY;
  const tasksByRef = new Map(tasks.map((t) => [t.ref, t]));
  // Mutable copy — accepted blocks are carved out of their slot, which makes
  // mutual overlap between proposed blocks impossible by construction.
  const remaining = new Map<string, Interval[]>(
    [...freeSlotsByDay.entries()].map(([k, v]) => [k, v.map((iv) => ({ ...iv }))]),
  );
  const usedPerDay = new Map<string, number>();
  const countPerDay = new Map<string, number>();

  const blocks: ProposedBlock[] = [];
  const rejected: RejectedBlock[] = [];
  const warnings: string[] = [];

  for (const block of raw.blocks) {
    const task = tasksByRef.get(block.taskRef);
    if (!task) {
      rejected.push({ block, reason: `Unknown task "${block.taskRef}".` });
      continue;
    }

    const start = parseTimeToMinutes(block.startTime);
    const end = parseTimeToMinutes(block.endTime);
    if (start == null || end == null || end <= start) {
      rejected.push({ block, reason: "Invalid or inverted times." });
      continue;
    }

    // Deadline rule mirrors the heuristic engine: work lands strictly BEFORE
    // the deadline day; overdue tasks may only catch up today.
    const overdue = task.deadlineKey <= opts.todayKey;
    if (overdue ? block.dateKey !== opts.todayKey : block.dateKey >= task.deadlineKey) {
      rejected.push({ block, reason: `Lands on/after the "${task.title}" deadline.` });
      continue;
    }

    // Spaced-repetition pins are hard: an exam-review task with a fixedDayKey
    // must land exactly there (otherwise the model can collapse all reviews
    // into the night before the exam — the pattern SM-2 spacing prevents).
    if (task.fixedDayKey && block.dateKey !== task.fixedDayKey) {
      rejected.push({
        block,
        reason: `"${task.title}" is pinned to ${task.fixedDayKey} (spaced repetition).`,
      });
      continue;
    }

    if ((countPerDay.get(block.dateKey) ?? 0) >= maxPerDay) {
      rejected.push({ block, reason: `Too many blocks on ${block.dateKey} for this mode.` });
      continue;
    }

    const slots = remaining.get(block.dateKey);
    if (!slots || slots.length === 0) {
      rejected.push({ block, reason: `No free time left on ${block.dateKey}.` });
      continue;
    }

    // Clip into the free slot it overlaps the most.
    let bestIdx = -1;
    let bestOverlap = 0;
    for (let i = 0; i < slots.length; i += 1) {
      const overlap = Math.min(end, slots[i].end) - Math.max(start, slots[i].start);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIdx = i;
      }
    }
    if (bestIdx === -1 || bestOverlap < minBlock) {
      rejected.push({ block, reason: `Doesn't fit the free time on ${block.dateKey}.` });
      continue;
    }

    const slot = slots[bestIdx];
    let clippedEnd = Math.min(end, slot.end);
    const clippedStart = Math.max(start, slot.start);

    // Daily cap: trim from the end; drop when what's left is too short.
    const used = usedPerDay.get(block.dateKey) ?? 0;
    const capLeft = opts.dailyCapMin - used;
    if (capLeft < minBlock) {
      rejected.push({ block, reason: `Over the daily cap on ${block.dateKey}.` });
      continue;
    }
    if (clippedEnd - clippedStart > capLeft) clippedEnd = clippedStart + capLeft;

    if (clippedStart !== start || clippedEnd !== end) {
      warnings.push(
        `Adjusted "${task.title}" on ${block.dateKey} to ${minutesToTime(clippedStart)}–${minutesToTime(clippedEnd)} to fit your calendar.`,
      );
    }

    blocks.push({
      ref: task.ref,
      taskKind: task.kind,
      dateKey: block.dateKey,
      startTime: minutesToTime(clippedStart),
      endTime: minutesToTime(clippedEnd),
      title: task.title,
      courseCode: task.courseCode,
      color: task.color,
    });

    usedPerDay.set(block.dateKey, used + (clippedEnd - clippedStart));
    countPerDay.set(block.dateKey, (countPerDay.get(block.dateKey) ?? 0) + 1);
    // Carve the accepted block out of its slot.
    const pieces: Interval[] = [];
    if (slot.start < clippedStart) pieces.push({ start: slot.start, end: clippedStart });
    if (clippedEnd < slot.end) pieces.push({ start: clippedEnd, end: slot.end });
    slots.splice(bestIdx, 1, ...pieces);
  }

  blocks.sort((a, b) =>
    a.dateKey !== b.dateKey
      ? a.dateKey.localeCompare(b.dateKey)
      : a.startTime.localeCompare(b.startTime),
  );

  return { blocks, rejected, warnings };
}
