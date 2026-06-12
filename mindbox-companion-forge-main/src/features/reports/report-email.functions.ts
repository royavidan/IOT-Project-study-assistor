import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { dateKeyDaysAgo } from "@/lib/dates";
import { deliverReportByEmail } from "@/features/reports/deliver-report.server";
import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase/server";

const emailReportInput = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Email the PDF report for a date range to the signed-in user and their active
 * reviewers (Story 11).
 */
export const emailReport = createServerFn({ method: "POST" })
  .validator(emailReportInput)
  .handler(async ({ data }) => {
    const {
      data: { user },
      error: authError,
    } = await getSupabaseServerClient().auth.getUser();
    if (authError) throw new Error(authError.message);
    if (!user) throw new Error("You must be signed in to email a report.");

    if (data.from > data.to) {
      throw new Error("'From' date must be on or before 'To' date.");
    }

    return deliverReportByEmail(user.id, data.from, data.to);
  });

/**
 * Weekly auto-share: emails PDF to owner + active reviewers when enabled.
 */
export const maybeSendWeeklySummaries = createServerFn({ method: "POST" }).handler(async () => {
  const {
    data: { user },
    error: authError,
  } = await getSupabaseServerClient().auth.getUser();
  if (authError) throw new Error(authError.message);
  if (!user) throw new Error("You must be signed in.");

  const admin = getSupabaseAdminClient();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

  const { data: settings, error: settingsError } = await admin
    .from("user_settings")
    .select("share_with_reviewers, last_weekly_share_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (settingsError) throw new Error(settingsError.message);
  const s = (settings ?? {}) as Record<string, unknown>;
  if (!s.share_with_reviewers) {
    return { ok: true as const, sent: 0, skipped: "share_with_reviewers disabled" };
  }

  const lastAt = s.last_weekly_share_at ? new Date(String(s.last_weekly_share_at)).getTime() : 0;
  if (lastAt > 0 && Date.now() - lastAt < WEEK_MS) {
    return { ok: true as const, sent: 0, skipped: "already sent this week" };
  }

  const from = dateKeyDaysAgo(6);
  const to = dateKeyDaysAgo(0);

  const result = await deliverReportByEmail(user.id, from, to);

  await admin
    .from("user_settings")
    .update({ last_weekly_share_at: new Date().toISOString() })
    .eq("user_id", user.id);

  return {
    ok: true as const,
    sent: result.sent,
    recipients: result.recipients,
    sessionCount: result.sessionCount,
    failures: result.failures,
  };
});
