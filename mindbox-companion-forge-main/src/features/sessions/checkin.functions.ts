// Post-session check-in server fn. Writes the user's self-report (tiredness,
// note) onto the session, applies homework progress updates, and — when the
// explicit thresholds in checkin.ts fire — reruns the LLM plan pipeline and
// returns a fresh draft. The DRAFT comes back to the client, which auto-commits
// it through the existing `useCommitPlan()` path: the model's output changes
// stored data (TA requirement) but only ever through validated app writes.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { loadPlanContext, meanTiredness } from "@/features/planner/plan-input.server";
import { runLlmPlan, type LlmPlanResult } from "@/features/planner/llm/run-plan.server";
import { shouldReplan } from "./checkin";

/** Auto-replans always cover the coming week. */
const REPLAN_HORIZON_DAYS = 7;

export interface CheckinResult {
  ok: true;
  /** True when this session's check-in was already answered (no-op write). */
  alreadyAnswered: boolean;
  /** Present when the thresholds fired: a fresh plan draft to auto-commit. */
  replan: (LlmPlanResult & { horizonDays: number; reasons: string[] }) | null;
}

export const submitSessionCheckin = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      sessionId: z.string().min(1),
      tiredness: z.number().int().min(1).max(5),
      note: z.string().max(500).optional(),
      homeworkUpdates: z
        .array(
          z.object({
            id: z.string().min(1),
            progressPct: z.number().int().min(0).max(100),
          }),
        )
        .max(20),
    }),
  )
  .handler(async ({ data }): Promise<CheckinResult> => {
    const supabase = getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("You must be signed in.");

    // Previous progress is read from the DB (server truth), not trusted from
    // the client — it feeds the replan thresholds.
    const ids = data.homeworkUpdates.map((u) => u.id);
    const prevById = new Map<string, { pct: number }>();
    if (ids.length > 0) {
      const { data: rows, error } = await supabase
        .from("homework_assignments")
        .select("id, progress_pct, status")
        .in("id", ids)
        .eq("user_id", user.id);
      if (error) throw new Error(error.message);
      for (const row of (rows ?? []) as Record<string, unknown>[]) {
        // Same completion convention as courses.ts: manual % overrides;
        // otherwise pending = 0, submitted/graded = 100.
        const manual = row.progress_pct == null ? null : Number(row.progress_pct);
        const pct = manual ?? (row.status === "pending" ? 0 : 100);
        prevById.set(String(row.id), { pct });
      }
    }

    // Idempotent: only the first answer for a session sticks.
    const { data: updated, error: sessionError } = await supabase
      .from("sessions")
      .update({
        tiredness: data.tiredness,
        checkin_at: new Date().toISOString(),
        checkin_note: data.note?.trim() || null,
      })
      .eq("id", data.sessionId)
      .eq("user_id", user.id)
      .is("checkin_at", null)
      .select("id");
    if (sessionError) throw new Error(sessionError.message);
    const alreadyAnswered = (updated ?? []).length === 0;

    // Apply homework progress (only rows that really belong to the user —
    // anything missing from prevById failed the ownership read above).
    const assessed: { id: string; previousPct: number; progressPct: number }[] = [];
    for (const u of data.homeworkUpdates) {
      const prev = prevById.get(u.id);
      if (!prev) continue;
      if (u.progressPct !== prev.pct) {
        const { error } = await supabase
          .from("homework_assignments")
          .update({ progress_pct: u.progressPct })
          .eq("id", u.id)
          .eq("user_id", user.id);
        if (error) throw new Error(error.message);
      }
      assessed.push({ id: u.id, previousPct: prev.pct, progressPct: u.progressPct });
    }

    // A replayed check-in (already answered) still applies homework edits —
    // they're legitimate user updates — but never re-triggers a replan from
    // tiredness that was never persisted.
    const decision = shouldReplan({ tiredness: data.tiredness, homeworkUpdates: assessed });
    if (!decision.replan || alreadyAnswered) return { ok: true, alreadyAnswered, replan: null };

    // Rerun the plan pipeline on the just-updated data (the fresh check-in is
    // already included in avgTirednessLast3).
    const context = await loadPlanContext(supabase, user.id, {
      now: new Date(),
      horizonDays: REPLAN_HORIZON_DAYS,
      includeLectureReview: true,
    });
    const result = await runLlmPlan(context.input, meanTiredness(context.recentTiredness));
    return {
      ok: true,
      alreadyAnswered,
      replan: { ...result, horizonDays: REPLAN_HORIZON_DAYS, reasons: decision.reasons },
    };
  });
