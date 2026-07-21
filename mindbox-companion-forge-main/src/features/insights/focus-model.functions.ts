// Server functions the UI calls for the calibrated focus/energy estimate.
//  - getFocusEstimate: fast, deterministic numbers only (loads on the page).
//  - getFocusNarrative: on-demand AI synthesis (a button, like "Run review now").
// Both are RLS-scoped to the signed-in user.

import { createServerFn } from "@tanstack/react-start";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { computeFocusEstimate, type FocusEstimateResult } from "./focus-model.server";
import { generateFocusNarrative, type FocusNarrative } from "./focus-review.server";

export type { FocusEstimateResult, FocusNarrative };

export const getFocusEstimate = createServerFn({ method: "GET" }).handler(
  async (): Promise<FocusEstimateResult> => {
    const supabase = getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("You must be signed in.");
    return computeFocusEstimate(supabase, user.id);
  },
);

export const getFocusNarrative = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ narrative: FocusNarrative | null }> => {
    const supabase = getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("You must be signed in.");
    const res = await computeFocusEstimate(supabase, user.id);
    if (!res.ready || !res.estimate) return { narrative: null };
    return { narrative: await generateFocusNarrative(res.estimate) };
  },
);
