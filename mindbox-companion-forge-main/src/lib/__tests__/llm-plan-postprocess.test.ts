import { describe, expect, it } from "vitest";

import { sanitizeLlmBlocks } from "@/features/planner/llm/postprocess";
import type { Interval, StudyTask } from "@/features/planner/planner";

const TODAY = "2026-06-01";
const TOMORROW = "2026-06-02";

function task(over: Partial<StudyTask> = {}): StudyTask {
  return {
    ref: over.ref ?? "hw:1",
    kind: over.kind ?? "homework",
    title: over.title ?? "Assignment 3",
    courseCode: over.courseCode ?? "CS101",
    color: over.color ?? "#14b8a6",
    deadlineKey: over.deadlineKey ?? "2026-06-08",
    remainingMin: over.remainingMin ?? 120,
    importance: over.importance ?? 5,
    urgency: over.urgency ?? 5,
    hard: over.hard ?? false,
    ...(over.fixedDayKey ? { fixedDayKey: over.fixedDayKey } : {}),
  };
}

function slots(entries: Record<string, Interval[]>): Map<string, Interval[]> {
  return new Map(Object.entries(entries));
}

const block = (
  over: Partial<{ taskRef: string; dateKey: string; startTime: string; endTime: string }> = {},
) => ({
  taskRef: over.taskRef ?? "hw:1",
  dateKey: over.dateKey ?? TOMORROW,
  startTime: over.startTime ?? "09:00",
  endTime: over.endTime ?? "09:50",
});

const OPTS = { todayKey: TODAY, dailyCapMin: 240 };

describe("sanitizeLlmBlocks", () => {
  it("accepts a block inside a free slot and maps task metadata", () => {
    const result = sanitizeLlmBlocks(
      { blocks: [block()] },
      [task()],
      slots({ [TOMORROW]: [{ start: 9 * 60, end: 12 * 60 }] }),
      OPTS,
    );
    expect(result.rejected).toHaveLength(0);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      ref: "hw:1",
      taskKind: "homework",
      title: "Assignment 3",
      courseCode: "CS101",
      dateKey: TOMORROW,
      startTime: "09:00",
      endTime: "09:50",
    });
  });

  it("rejects unknown task refs", () => {
    const result = sanitizeLlmBlocks(
      { blocks: [block({ taskRef: "hw:ghost" })] },
      [task()],
      slots({ [TOMORROW]: [{ start: 9 * 60, end: 12 * 60 }] }),
      OPTS,
    );
    expect(result.blocks).toHaveLength(0);
    expect(result.rejected[0].reason).toMatch(/Unknown task/);
  });

  it("rejects inverted times", () => {
    const result = sanitizeLlmBlocks(
      { blocks: [block({ startTime: "10:00", endTime: "09:00" })] },
      [task()],
      slots({ [TOMORROW]: [{ start: 9 * 60, end: 12 * 60 }] }),
      OPTS,
    );
    expect(result.rejected[0].reason).toMatch(/Invalid or inverted/);
  });

  it("clips a block that spills out of the free slot and warns", () => {
    // Free 09:00–10:00 only; model asked 09:30–11:00 → clipped to 09:30–10:00.
    const result = sanitizeLlmBlocks(
      { blocks: [block({ startTime: "09:30", endTime: "11:00" })] },
      [task()],
      slots({ [TOMORROW]: [{ start: 9 * 60, end: 10 * 60 }] }),
      OPTS,
    );
    expect(result.blocks[0]).toMatchObject({ startTime: "09:30", endTime: "10:00" });
    expect(result.warnings[0]).toMatch(/Adjusted/);
  });

  it("drops a block whose overlap with free time is under the minimum", () => {
    // Free 09:00–09:10; a 50-minute block only overlaps 10 min (< 20).
    const result = sanitizeLlmBlocks(
      { blocks: [block()] },
      [task()],
      slots({ [TOMORROW]: [{ start: 9 * 60, end: 9 * 60 + 10 }] }),
      OPTS,
    );
    expect(result.blocks).toHaveLength(0);
    expect(result.rejected[0].reason).toMatch(/Doesn't fit/);
  });

  it("rejects days with no free time at all", () => {
    const result = sanitizeLlmBlocks(
      { blocks: [block({ dateKey: "2026-06-03" })] },
      [task()],
      slots({ [TOMORROW]: [{ start: 9 * 60, end: 12 * 60 }] }),
      OPTS,
    );
    expect(result.rejected[0].reason).toMatch(/No free time/);
  });

  it("prevents two blocks from overlapping each other", () => {
    // Both proposed 09:00–09:50 in one 09:00–10:00 slot: the second gets the
    // 09:50–10:00 remainder, which is under the minimum → rejected.
    const result = sanitizeLlmBlocks(
      { blocks: [block(), block()] },
      [task()],
      slots({ [TOMORROW]: [{ start: 9 * 60, end: 10 * 60 }] }),
      OPTS,
    );
    expect(result.blocks).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it("packs a second block into the remaining slot when there is room", () => {
    const result = sanitizeLlmBlocks(
      {
        blocks: [
          block({ startTime: "09:00", endTime: "09:50" }),
          block({ startTime: "10:00", endTime: "10:50" }),
        ],
      },
      [task()],
      slots({ [TOMORROW]: [{ start: 9 * 60, end: 12 * 60 }] }),
      OPTS,
    );
    expect(result.blocks).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
  });

  it("enforces the daily cap by trimming, then rejecting", () => {
    const result = sanitizeLlmBlocks(
      {
        blocks: [
          block({ startTime: "09:00", endTime: "10:00" }),
          block({ startTime: "10:30", endTime: "11:30" }),
        ],
      },
      [task()],
      slots({ [TOMORROW]: [{ start: 9 * 60, end: 14 * 60 }] }),
      { todayKey: TODAY, dailyCapMin: 90 },
    );
    // First block: 60 min. Cap leaves 30 → second trimmed to 30 min.
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[1]).toMatchObject({ startTime: "10:30", endTime: "11:00" });
  });

  it("pins exam-review tasks to their fixedDayKey (no pre-exam cramming)", () => {
    const review = task({
      ref: "exam:e1:3",
      kind: "exam-review",
      deadlineKey: "2026-06-08",
      fixedDayKey: "2026-06-05",
    });
    const allSlots = slots({
      [TOMORROW]: [{ start: 9 * 60, end: 12 * 60 }],
      "2026-06-05": [{ start: 9 * 60, end: 12 * 60 }],
      "2026-06-07": [{ start: 9 * 60, end: 12 * 60 }],
    });
    // The night-before slot is rejected; the pinned day is accepted.
    const crammed = sanitizeLlmBlocks(
      { blocks: [block({ taskRef: "exam:e1:3", dateKey: "2026-06-07" })] },
      [review],
      allSlots,
      OPTS,
    );
    expect(crammed.blocks).toHaveLength(0);
    expect(crammed.rejected[0].reason).toMatch(/pinned/);

    const pinned = sanitizeLlmBlocks(
      { blocks: [block({ taskRef: "exam:e1:3", dateKey: "2026-06-05" })] },
      [review],
      allSlots,
      OPTS,
    );
    expect(pinned.blocks).toHaveLength(1);
  });

  it("enforces maxBlocksPerDay", () => {
    const result = sanitizeLlmBlocks(
      {
        blocks: [
          block({ startTime: "09:00", endTime: "09:50" }),
          block({ startTime: "10:00", endTime: "10:50" }),
          block({ startTime: "11:00", endTime: "11:50" }),
        ],
      },
      [task()],
      slots({ [TOMORROW]: [{ start: 9 * 60, end: 14 * 60 }] }),
      { ...OPTS, maxBlocksPerDay: 2 },
    );
    expect(result.blocks).toHaveLength(2);
    expect(result.rejected[0].reason).toMatch(/Too many blocks/);
  });

  it("reserves minGapMin between blocks so they can't be scheduled back-to-back", () => {
    // Two proposals butted together (09:00–09:50 then 09:50–10:40) in one slot.
    const result = sanitizeLlmBlocks(
      {
        blocks: [
          block({ startTime: "09:00", endTime: "09:50" }),
          block({ startTime: "09:50", endTime: "10:40" }),
        ],
      },
      [task()],
      slots({ [TOMORROW]: [{ start: 9 * 60, end: 13 * 60 }] }),
      { ...OPTS, minGapMin: 10 },
    );
    // Both are placed, but the second is pushed past the 10-min break: it can't
    // start until 10:00 (09:50 end + 10 gap), so they're never back-to-back.
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].endTime).toBe("09:50");
    expect(result.blocks[1].startTime).toBe("10:00");
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("rejects blocks on or after the task deadline", () => {
    const result = sanitizeLlmBlocks(
      { blocks: [block({ dateKey: "2026-06-08" })] },
      [task({ deadlineKey: "2026-06-08" })],
      slots({ "2026-06-08": [{ start: 9 * 60, end: 12 * 60 }] }),
      OPTS,
    );
    expect(result.rejected[0].reason).toMatch(/deadline/);
  });

  it("lets overdue tasks catch up today only", () => {
    const overdue = task({ deadlineKey: "2026-05-30" });
    const good = sanitizeLlmBlocks(
      { blocks: [block({ dateKey: TODAY })] },
      [overdue],
      slots({ [TODAY]: [{ start: 9 * 60, end: 12 * 60 }] }),
      OPTS,
    );
    expect(good.blocks).toHaveLength(1);

    const bad = sanitizeLlmBlocks(
      { blocks: [block({ dateKey: TOMORROW })] },
      [overdue],
      slots({ [TOMORROW]: [{ start: 9 * 60, end: 12 * 60 }] }),
      OPTS,
    );
    expect(bad.rejected).toHaveLength(1);
  });

  it("sorts accepted blocks by date then start time", () => {
    const result = sanitizeLlmBlocks(
      {
        blocks: [
          block({ dateKey: "2026-06-03", startTime: "09:00", endTime: "09:50" }),
          block({ dateKey: TOMORROW, startTime: "11:00", endTime: "11:50" }),
          block({ dateKey: TOMORROW, startTime: "09:00", endTime: "09:50" }),
        ],
      },
      [task()],
      slots({
        [TOMORROW]: [{ start: 9 * 60, end: 13 * 60 }],
        "2026-06-03": [{ start: 9 * 60, end: 13 * 60 }],
      }),
      OPTS,
    );
    expect(result.blocks.map((b) => `${b.dateKey} ${b.startTime}`)).toEqual([
      `${TOMORROW} 09:00`,
      `${TOMORROW} 11:00`,
      "2026-06-03 09:00",
    ]);
  });
});
