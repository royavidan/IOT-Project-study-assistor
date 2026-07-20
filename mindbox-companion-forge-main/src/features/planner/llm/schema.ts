// LLM planner response contract — the Gemini structured-output schema and the
// Zod schema that re-validates the model's JSON on our side. They describe the
// SAME shape and live in one module so they can't drift apart (a shared-sample
// test in lib/__tests__/llm-plan-schema.test.ts guards this). Pure — no SDK
// imports; the Gemini schema is a plain OpenAPI-subset object literal.

import { z } from "zod";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Hard ceiling on blocks per plan — a runaway model can't flood the calendar. */
export const MAX_PLAN_BLOCKS = 60;

export const llmPlanZodSchema = z.object({
  blocks: z
    .array(
      z.object({
        /** Must match a StudyTask ref (`hw:<id>` / `exam:<id>:<n>` / `lecture:<id>`). */
        taskRef: z.string().min(1),
        dateKey: z.string().regex(DATE_KEY_RE, "dateKey must be YYYY-MM-DD"),
        startTime: z.string().regex(TIME_RE, "startTime must be HH:MM (24h)"),
        endTime: z.string().regex(TIME_RE, "endTime must be HH:MM (24h)"),
        reason: z.string().max(300).optional(),
      }),
    )
    .max(MAX_PLAN_BLOCKS),
  assumptions: z.array(z.string().max(300)).max(20).optional(),
  summary: z.string().max(600),
});

export type LlmPlanResponse = z.infer<typeof llmPlanZodSchema>;
export type LlmPlanBlock = LlmPlanResponse["blocks"][number];

/**
 * The same contract for Gemini's `responseSchema` (config.responseMimeType
 * "application/json"). Gemini takes an OpenAPI-style subset with UPPERCASE
 * type names; Zod refinements (regexes, max lengths) that it can't express
 * are enforced by `llmPlanZodSchema` after parsing.
 */
export const llmPlanResponseSchema = {
  type: "OBJECT",
  properties: {
    blocks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          taskRef: {
            type: "STRING",
            description: "The task ref this block works on, copied verbatim from the tasks list.",
          },
          dateKey: { type: "STRING", description: "YYYY-MM-DD" },
          startTime: { type: "STRING", description: "HH:MM, 24-hour" },
          endTime: { type: "STRING", description: "HH:MM, 24-hour, after startTime" },
          reason: { type: "STRING", description: "One short sentence: why here." },
        },
        required: ["taskRef", "dateKey", "startTime", "endTime"],
      },
    },
    assumptions: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "Every assumption made while planning, as short sentences.",
    },
    summary: { type: "STRING", description: "1-2 sentences describing the plan's strategy." },
  },
  required: ["blocks", "summary"],
} as const;
