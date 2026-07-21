import { describe, expect, it } from "vitest";

import {
  llmPlanResponseSchema,
  llmPlanZodSchema,
  MAX_PLAN_BLOCKS,
} from "@/features/planner/llm/schema";

// One sample that must satisfy BOTH schemas — this is the drift guard between
// the Gemini responseSchema and the Zod re-validation.
const SAMPLE = {
  blocks: [
    {
      taskRef: "hw:abc",
      dateKey: "2026-06-02",
      startTime: "09:00",
      endTime: "09:50",
      reason: "Morning free slot before the deadline.",
    },
  ],
  assumptions: ["Assumed the assignment needs the full estimate."],
  summary: "One block tomorrow morning.",
};

describe("llmPlanZodSchema", () => {
  it("accepts the shared sample", () => {
    const parsed = llmPlanZodSchema.safeParse(SAMPLE);
    expect(parsed.success).toBe(true);
  });

  it("accepts a minimal response (no assumptions, no reason)", () => {
    const parsed = llmPlanZodSchema.safeParse({
      blocks: [{ taskRef: "hw:1", dateKey: "2026-06-02", startTime: "10:00", endTime: "11:00" }],
      summary: "ok",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects bad times, bad dates and missing fields", () => {
    const bad = (block: Record<string, unknown>) =>
      llmPlanZodSchema.safeParse({ blocks: [block], summary: "x" }).success;

    expect(
      bad({ taskRef: "hw:1", dateKey: "2026-06-02", startTime: "9:00", endTime: "10:00" }),
    ).toBe(false);
    expect(
      bad({ taskRef: "hw:1", dateKey: "2026-06-02", startTime: "25:00", endTime: "26:00" }),
    ).toBe(false);
    expect(
      bad({ taskRef: "hw:1", dateKey: "06-02-2026", startTime: "09:00", endTime: "10:00" }),
    ).toBe(false);
    expect(bad({ taskRef: "hw:1", dateKey: "2026-06-02", startTime: "09:00" })).toBe(false);
    expect(bad({ dateKey: "2026-06-02", startTime: "09:00", endTime: "10:00" })).toBe(false);
  });

  it("rejects more than MAX_PLAN_BLOCKS blocks", () => {
    const block = { taskRef: "hw:1", dateKey: "2026-06-02", startTime: "09:00", endTime: "10:00" };
    const parsed = llmPlanZodSchema.safeParse({
      blocks: Array.from({ length: MAX_PLAN_BLOCKS + 1 }, () => block),
      summary: "too many",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("llmPlanResponseSchema (Gemini) ↔ Zod drift guard", () => {
  it("describes the same top-level and block-level keys as the Zod schema", () => {
    const zodTop = Object.keys(llmPlanZodSchema.shape).sort();
    const geminiTop = Object.keys(llmPlanResponseSchema.properties).sort();
    expect(geminiTop).toEqual(zodTop);

    const zodBlock = Object.keys(llmPlanZodSchema.shape.blocks.element.shape).sort();
    const geminiBlock = Object.keys(
      llmPlanResponseSchema.properties.blocks.items.properties,
    ).sort();
    expect(geminiBlock).toEqual(zodBlock);
  });

  it("marks the same fields required as the Zod schema", () => {
    expect([...llmPlanResponseSchema.required].sort()).toEqual(["blocks", "summary"]);
    expect([...llmPlanResponseSchema.properties.blocks.items.required].sort()).toEqual([
      "dateKey",
      "endTime",
      "startTime",
      "taskRef",
    ]);
  });
});
