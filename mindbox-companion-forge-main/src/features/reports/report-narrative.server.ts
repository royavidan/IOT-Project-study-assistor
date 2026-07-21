// AI executive summary for the report — same contract as load-review /
// focus-review: OUR deterministic engine produces every number; Gemini writes
// only a short behavioral narrative from the derived model (never raw rows,
// never a diagnosis, never a new number). Structured output + Zod; a model
// failure falls back to a plain templated summary, so the report never depends
// on the LLM.

import "@tanstack/react-start/server-only";

import { z } from "zod";

import { generateStructured } from "@/features/planner/llm/gemini.server";
import type { NarrativeBlock, ReportModel } from "./report-model";

const zodSchema = z.object({
  headline: z.string().min(1).max(160),
  paragraphs: z.array(z.string().max(400)).min(1).max(3),
  highlights: z.array(z.string().max(160)).max(4).default([]),
});

const responseSchema = {
  type: "OBJECT",
  properties: {
    headline: { type: "STRING", description: "One warm line summarizing the week." },
    paragraphs: { type: "ARRAY", items: { type: "STRING" } },
    highlights: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["headline", "paragraphs"],
} as const;

const SYSTEM = [
  "You write the short executive summary at the top of a university student's",
  "weekly STUDY report, based ONLY on the computed metrics we give you. It is a",
  "BEHAVIORAL pattern summary with uncertainty — never a clinical, medical, or",
  "diagnostic claim, and never invent numbers or findings beyond the input. If a",
  "reliability note says the estimate is still learning, respect it. At most 110",
  "words across the paragraphs; up to 4 short highlights (wins + one gentle",
  "focus). Output ONLY JSON conforming to the schema.",
].join("\n");

function derived(model: ReportModel) {
  return {
    period: { from: model.meta.from, to: model.meta.to },
    stats: model.stats?.map((s) => ({ [s.label]: s.value })),
    focus: model.focus
      ? {
          energyScore: model.focus.energyScore,
          headline: model.focus.headline,
          trend: model.focus.trendLabel,
          reliability: model.focus.reliability,
          drivers: model.focus.drivers.map((d) => `${d.label} ${d.effect} strain`),
        }
      : "not enough data",
    load: model.overload ? { level: model.overload.level, flags: model.overload.rules } : null,
    checkins: model.checkin
      ? { count: model.checkin.count, avgTiredness: model.checkin.avgTiredness }
      : null,
    studyTime: model.studyTime
      ? {
          loggedHours: +(model.studyTime.rawMin / 60).toFixed(1),
          effectiveHours: +(model.studyTime.effectiveMin / 60).toFixed(1),
          sweetSpot: model.studyTime.sweetSpot,
        }
      : null,
    academic: model.academic
      ? {
          completionPct: model.academic.overall.completionPct,
          nextExam: model.academic.upcomingExams[0] ?? null,
          homeworkDueCount: model.academic.homeworkDue.length,
        }
      : null,
  };
}

function fallback(model: ReportModel): NarrativeBlock {
  const f = model.focus;
  const load = model.overload?.level ?? "ok";
  const paragraphs = [
    `This week: ${model.stats?.find((s) => s.label === "Sessions")?.value ?? "0"} sessions${
      f
        ? `, focus energy around ${f.energyScore}/100 (${f.headline.toLowerCase()}), ${f.trendLabel}`
        : ""
    }.`,
    load === "ok"
      ? "No overload pattern flagged — a sustainable week."
      : `Your load looks ${load}. ${model.overload?.rules[0] ?? ""}`,
  ];
  const highlights: string[] = [];
  if (model.academic?.upcomingExams[0]) {
    const e = model.academic.upcomingExams[0];
    highlights.push(`${e.title} in ${e.daysUntil} day${e.daysUntil === 1 ? "" : "s"}`);
  }
  if (model.checkin?.avgTiredness != null) {
    highlights.push(`Average tiredness ${model.checkin.avgTiredness.toFixed(1)}/5`);
  }
  return { headline: "Your week at a glance", paragraphs, highlights, source: "fallback" };
}

/** Generate the report's executive summary (AI, with a templated fallback). */
export async function generateReportNarrative(model: ReportModel): Promise<NarrativeBlock> {
  try {
    const out = await generateStructured({
      system: SYSTEM,
      user: JSON.stringify(derived(model)),
      responseSchema,
      zodSchema,
    });
    return { ...out, source: "ai" };
  } catch {
    return fallback(model);
  }
}
