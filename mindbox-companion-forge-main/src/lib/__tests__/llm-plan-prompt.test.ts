import { describe, expect, it } from "vitest";

import { buildPlannerPrompt, type LlmPromptInput } from "@/features/planner/llm/prompt";
import type { StudyTask } from "@/features/planner/planner";

const TASK: StudyTask = {
  ref: "hw:1",
  kind: "homework",
  title: "Assignment 3",
  courseCode: "CS101",
  color: "#14b8a6",
  deadlineKey: "2026-06-08",
  remainingMin: 120,
  importance: 5,
  urgency: 6,
  hard: false,
};

function input(over: Partial<LlmPromptInput> = {}): LlmPromptInput {
  return {
    todayKey: "2026-06-01",
    horizonDays: 7,
    mode: {
      name: "balanced",
      workBlockMin: 50,
      breakMin: 10,
      longBreakMin: 30,
      blocksBeforeLongBreak: 4,
      dailyCapMin: 240,
      maxBlocksPerDay: 6,
    },
    freeSlotsByDay: new Map([
      ["2026-06-02", [{ start: 9 * 60, end: 12 * 60 }]],
      ["2026-06-01", [{ start: 14 * 60, end: 16 * 60 }]],
    ]),
    meals: [
      { start: 12 * 60 + 30, end: 13 * 60 + 30 },
      { start: 18 * 60 + 30, end: 19 * 60 + 30 },
    ],
    tasks: [TASK],
    recoveryStatus: "balanced",
    avgTirednessLast3: null,
    bestWindow: "Morning (6–12)",
    ...over,
  };
}

describe("buildPlannerPrompt", () => {
  it("is deterministic — same input, same prompt", () => {
    expect(buildPlannerPrompt(input())).toEqual(buildPlannerPrompt(input()));
  });

  it("produces a JSON user payload with days sorted and times as HH:MM", () => {
    const { user } = buildPlannerPrompt(input());
    const parsed = JSON.parse(user) as {
      today: string;
      freeSlots: { date: string; slots: { start: string; end: string }[] }[];
      tasks: { ref: string; deadline: string; fixedDay?: string }[];
      wellbeing: { recoveryStatus: string };
    };
    expect(parsed.today).toBe("2026-06-01");
    expect(parsed.freeSlots.map((d) => d.date)).toEqual(["2026-06-01", "2026-06-02"]);
    expect(parsed.freeSlots[0].slots[0]).toEqual({ start: "14:00", end: "16:00" });
    expect(parsed.tasks[0].ref).toBe("hw:1");
    expect(parsed.tasks[0].deadline).toBe("2026-06-08");
    expect(parsed.tasks[0].fixedDay).toBeUndefined();
    expect(parsed.wellbeing.recoveryStatus).toBe("balanced");
  });

  it("carries fixedDay for exam-review tasks", () => {
    const review: StudyTask = {
      ...TASK,
      ref: "exam:e1:3",
      kind: "exam-review",
      fixedDayKey: "2026-06-05",
    };
    const { user } = buildPlannerPrompt(input({ tasks: [review] }));
    const parsed = JSON.parse(user) as { tasks: { fixedDay?: string }[] };
    expect(parsed.tasks[0].fixedDay).toBe("2026-06-05");
  });

  it("keeps the free-slot / cap / assumption rules in the system prompt", () => {
    const { system } = buildPlannerPrompt(input());
    expect(system).toMatch(/ONLY inside the provided free slots/);
    expect(system).toMatch(/dailyCapMin/);
    expect(system).toMatch(/assumption/i);
    expect(system).toMatch(/ONLY JSON/);
  });

  it("carries the pacing/behavioral rules and the break rhythm in the system prompt", () => {
    const { system } = buildPlannerPrompt(input());
    expect(system).toMatch(/breakMin/);
    expect(system).toMatch(/back-to-back/i);
    expect(system).toMatch(/Spread the day out/i);
    expect(system).toMatch(/Interleave subjects/i);
    expect(system).toMatch(/bestWindow/);
  });

  it("passes the protected meal windows to the model as HH:MM", () => {
    const { user } = buildPlannerPrompt(input());
    const parsed = JSON.parse(user) as { meals: { start: string; end: string }[] };
    expect(parsed.meals).toEqual([
      { start: "12:30", end: "13:30" },
      { start: "18:30", end: "19:30" },
    ]);
  });
});
