import "@tanstack/react-start/server-only";

import { localDayRangeIso, toDateKey } from "@/lib/dates";
import { summarize, type ReportMeta } from "@/lib/export";
import { buildReportPdf } from "@/lib/email/build-report-pdf.server";
import { getAppBaseUrl, sendEmail, type EmailAttachment } from "@/lib/email/send-html.server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/types";

export function mapSessionRow(row: Record<string, unknown>): Session {
  const started = new Date(String(row.started_at));
  const pad = (n: number) => String(n).padStart(2, "0");
  const actualSec = Number(row.actual_focus_sec ?? 0);

  return {
    id: String(row.id),
    date: toDateKey(started),
    start: `${pad(started.getHours())}:${pad(started.getMinutes())}`,
    durationMin: Math.max(1, Math.round(actualSec / 60)),
    mode: String(row.mode ?? "Study") as Session["mode"],
    status: String(row.status ?? "completed") as Session["status"],
    focusScore: Number(row.focus_load_avg ?? 0),
    breaks: Number(row.breaks ?? 0),
    subject: String(row.mode ?? "Study"),
    noiseAvg: row.noise_avg == null ? null : Number(row.noise_avg),
    tempC: row.temp_c == null ? null : Number(row.temp_c),
    lightLux: row.light_lux == null ? null : Number(row.light_lux),
    presenceInterruptions: Number(row.presence_interruptions ?? 0),
    userId: String(row.user_id ?? ""),
    endedAt: row.ended_at ? String(row.ended_at) : undefined,
  };
}

export async function fetchSessionsForOwner(
  ownerUserId: string,
  from: string,
  to: string,
): Promise<Session[]> {
  const admin = getSupabaseAdminClient();
  const { fromIso, toIso } = localDayRangeIso(from, to);

  const { data, error } = await admin
    .from("sessions")
    .select(
      "id, user_id, started_at, ended_at, actual_focus_sec, mode, status, focus_load_avg, breaks, noise_avg, temp_c, light_lux, presence_interruptions",
    )
    .eq("user_id", ownerUserId)
    .gte("started_at", fromIso)
    .lte("started_at", toIso)
    .order("started_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapSessionRow(row as Record<string, unknown>));
}

export async function resolveReportRecipients(ownerUserId: string): Promise<{
  ownerName: string;
  ownerEmail: string;
  recipients: string[];
}> {
  const admin = getSupabaseAdminClient();

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("display_name, email")
    .eq("id", ownerUserId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);

  const ownerName = String(
    (profile as Record<string, unknown> | null)?.display_name ??
      (profile as Record<string, unknown> | null)?.email ??
      "MindBox student",
  );
  let ownerEmail = String((profile as Record<string, unknown> | null)?.email ?? "")
    .trim()
    .toLowerCase();

  if (!ownerEmail) {
    const { data: authUser, error: authUserError } =
      await admin.auth.admin.getUserById(ownerUserId);
    if (!authUserError && authUser?.user?.email) {
      ownerEmail = authUser.user.email.trim().toLowerCase();
    }
  }

  const { data: grants, error: grantsError } = await admin
    .from("reviewer_grants")
    .select("reviewer_email, reviewer_user_id")
    .eq("owner_user_id", ownerUserId)
    .eq("status", "active");
  if (grantsError) throw new Error(grantsError.message);

  const emails = new Set<string>();
  if (ownerEmail) emails.add(ownerEmail);

  for (const grant of (grants ?? []) as Array<{
    reviewer_email: string | null;
    reviewer_user_id: string | null;
  }>) {
    let email = grant.reviewer_email?.trim().toLowerCase() ?? "";
    if (!email && grant.reviewer_user_id) {
      const { data: revProfile } = await admin
        .from("profiles")
        .select("email")
        .eq("id", grant.reviewer_user_id)
        .maybeSingle();
      email = String((revProfile as Record<string, unknown> | null)?.email ?? "").toLowerCase();
    }
    if (email) emails.add(email);
  }

  return { ownerName, ownerEmail, recipients: [...emails] };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmailHtml(meta: ReportMeta, sessions: Session[], ownerUserId: string): string {
  const sum = summarize(sessions);
  const appUrl = getAppBaseUrl();

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="font-family:ui-sans-serif,system-ui,sans-serif;color:#1a1a1a;padding:24px;">
  <p>Hi,</p>
  <p>Your MindBox focus report for <strong>${escapeHtml(meta.from)}</strong> → <strong>${escapeHtml(meta.to)}</strong> is attached as a PDF.</p>
  <ul>
    <li>Sessions: ${sum.sessionCount}</li>
    <li>Total focus: ${(sum.totalFocusMin / 60).toFixed(1)} h</li>
    <li>Avg Focus Load Estimate: ${sum.avgFocusScore}</li>
  </ul>
  <p><a href="${appUrl}/history?student=${ownerUserId}">View live reports in MindBox</a></p>
  <p style="color:#666;font-size:12px;">Focus Load Estimate is a heuristic, not a validated scientific measurement.</p>
</body>
</html>`;
}

export type DeliverReportResult = {
  ok: true;
  sent: number;
  recipients: string[];
  sessionCount: number;
  failures?: string[];
};

/** Emails the PDF report to the owner and all active reviewers. */
export async function deliverReportByEmail(
  ownerUserId: string,
  from: string,
  to: string,
): Promise<DeliverReportResult> {
  const [{ ownerName, ownerEmail, recipients }, rawSessions] = await Promise.all([
    resolveReportRecipients(ownerUserId),
    fetchSessionsForOwner(ownerUserId, from, to),
  ]);

  const sessions = rawSessions.filter((s) => s.date >= from && s.date <= to);

  if (recipients.length === 0) {
    throw new Error("No email addresses found for you or your reviewers.");
  }

  const meta: ReportMeta = {
    user: ownerEmail || ownerName,
    from,
    to,
    generatedAt: new Date().toISOString(),
  };

  const [pdf, htmlBody] = await Promise.all([
    buildReportPdf(sessions, meta),
    Promise.resolve(buildEmailHtml(meta, sessions, ownerUserId)),
  ]);

  const attachment: EmailAttachment = {
    filename: `mindbox-report_${from}_to_${to}.pdf`,
    content: pdf,
  };

  const subject = `MindBox focus report — ${ownerName} (${from} to ${to})`;
  let sent = 0;
  const failures: string[] = [];

  for (const email of recipients) {
    const result = await sendEmail({
      to: email,
      subject,
      html: htmlBody,
      attachments: [attachment],
    });
    if (result.sent) sent++;
    else failures.push(`${email}: ${result.reason}`);
  }

  if (sent === 0) {
    throw new Error(failures[0] ?? "Failed to send report emails.");
  }

  return {
    ok: true,
    sent,
    recipients,
    sessionCount: sessions.length,
    failures: failures.length ? failures : undefined,
  };
}
