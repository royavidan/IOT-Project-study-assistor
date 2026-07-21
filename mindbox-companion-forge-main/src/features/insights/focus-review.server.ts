// AI synthesis for the focus/energy estimate — mirrors the load-review contract
// exactly: OUR deterministic engine produces every number; Gemini writes ONLY a
// short behavioral narrative + gentle experiments from the derived estimate
// (never raw rows, never a diagnosis, never a new number). Structured output +
// Zod re-validation; a model failure falls back to a plain templated narrative,
// so the feature never depends on the LLM.

import "@tanstack/react-start/server-only";

import { z } from "zod";

import { generateStructured } from "@/features/planner/llm/gemini.server";
import type { FocusStateEstimate } from "@/lib/focus/focus-state";

const zodSchema = z.object({
  headline: z.string().min(1).max(160),
  paragraphs: z.array(z.string().max(400)).min(1).max(3),
  // Optional -> must not be in the Gemini `required` list (a valid experiment-
  // less response would otherwise fail Zod and burn the corrective retry).
  experiments: z.array(z.string().max(200)).max(3).default([]),
});

export type FocusNarrative = z.infer<typeof zodSchema> & { source: "ai" | "fallback" };

const responseSchema = {
  type: "OBJECT",
  properties: {
    headline: {
      type: "STRING",
      description: "One warm line summarizing the focus/energy pattern.",
    },
    paragraphs: { type: "ARRAY", items: { type: "STRING" } },
    experiments: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["headline", "paragraphs"],
} as const;

const SYSTEM = [
  "You write a short, warm, non-alarmist note about a university student's recent",
  "FOCUS / ENERGY pattern, based ONLY on the computed estimate we give you. This",
  "is a BEHAVIORAL pattern estimate with real uncertainty — never a clinical,",
  "medical, or diagnostic claim (no fatigue/burnout/brain-fog diagnosis), and",
  "never invent numbers or findings beyond the input. If the reliability says it",
  "is still learning, say so plainly. At most 110 words across the paragraphs, and",
  "up to 3 concrete, gentle experiments to try. Output ONLY JSON conforming to the",
  "schema.",
].join("\n");

function fallbackNarrative(est: FocusStateEstimate): FocusNarrative {
  const trendPhrase =
    est.trend.direction === "rising"
      ? "trending toward more strain"
      : est.trend.direction === "falling"
        ? "easing lately"
        : "holding steady";
  const paragraphs = [
    `Your recent sessions read as a ${est.headline.toLowerCase()} pattern (${est.energyScore}/100 focus energy), ${trendPhrase}.`,
    est.reliability.label,
  ];
  const top = est.drivers[0];
  const experiments = top
    ? [
        `${top.contribution > 0 ? "Ease off on" : "Lean into"} ${top.label.toLowerCase()} on your next few sessions and see whether it shifts.`,
      ]
    : [];
  return { headline: est.headline, paragraphs, experiments, source: "fallback" };
}

/** Produce the behavioral narrative for an estimate (AI, with a templated fallback). */
export async function generateFocusNarrative(est: FocusStateEstimate): Promise<FocusNarrative> {
  const payload = {
    energyScore: est.energyScore,
    energyRange: est.energyCI,
    predictedTiredness: Number(est.predictedTiredness.toFixed(1)),
    headline: est.headline,
    trend: est.trend.direction,
    reliability: {
      basis: est.reliability.basis,
      nSessions: est.reliability.nSessions,
      nLabels: est.reliability.nLabels,
      validatedMae: est.reliability.validatedMae,
      note: est.reliability.label,
    },
    topDrivers: est.drivers.map((d) => ({
      label: d.label,
      effect: d.contribution > 0 ? "adds strain" : "eases strain",
    })),
  };
  try {
    const out = await generateStructured({
      system: SYSTEM,
      user: JSON.stringify(payload),
      responseSchema,
      zodSchema,
    });
    return { ...out, source: "ai" };
  } catch {
    return fallbackNarrative(est);
  }
}
