// "Run review now" — the demo/dev entry into the load review for the signed-in
// user only. Bypasses the 72h throttle and quiet hours (force) so it can be
// shown live; the daily sweep for everyone runs via POST /jobs/load-review.

import { createServerFn } from "@tanstack/react-start";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { reviewUserLoad, type LoadReviewOutcome } from "./load-review.server";

export type { LoadReviewOutcome };

export const runLoadReviewNow = createServerFn({ method: "POST" }).handler(
  async (): Promise<LoadReviewOutcome> => {
    const supabase = getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("You must be signed in.");
    return reviewUserLoad(user.id, { force: true });
  },
);
