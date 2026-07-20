// Server fn for the "Smart (AI)" plan engine. The whole pipeline is
// server-automatic (TA requirement): load the user's real data → build the
// prompt → Gemini structured output → deterministic validation → PlanDraft.
// The client only previews and commits the draft through the existing
// `useCommitPlan()` path — the LLM never writes to the database.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { loadPlanContext, meanTiredness } from "./plan-input.server";
import { runLlmPlan, type LlmPlanResult } from "./llm/run-plan.server";

export type { LlmPlanResult };

export const generateLlmPlan = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      mode: z.enum(["balanced", "deep_focus", "sprint"]),
      horizonDays: z.number().int().min(1).max(30),
      includeLectureReview: z.boolean(),
    }),
  )
  .handler(async ({ data }): Promise<LlmPlanResult> => {
    const supabase = getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("You must be signed in.");

    const context = await loadPlanContext(supabase, user.id, {
      now: new Date(),
      horizonDays: data.horizonDays,
      includeLectureReview: data.includeLectureReview,
      mode: data.mode,
    });

    // Plan-meta (staleness fingerprint) is written at COMMIT time by the
    // client, so discarded drafts never count as "the last plan".
    return runLlmPlan(context.input, meanTiredness(context.recentTiredness));
  });
