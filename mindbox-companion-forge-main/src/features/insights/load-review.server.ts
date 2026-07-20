// Scheduled load review — the /jobs/load-review route body + the per-user core
// the "Run review now" demo button reuses.
//
// PURPOSE (see docs/ASSUMPTIONS.md): collect each user's data → OUR
// deterministic rules (overload.ts) decide ok/warning/danger → Gemini writes
// ONLY the personalized narrative → contact the user by email. A model failure
// falls back to a plain templated email — contact never depends on the LLM.
//
// Trigger: an external scheduler (GitHub Actions cron / cron-job.org) calls
// POST /jobs/load-review with the `x-jobs-secret` header — the same
// shared-secret pattern as /ingest/* (there is no in-app cron on this stack).

import "@tanstack/react-start/server-only";

import { z } from "zod";

import { getServerConfig } from "@/lib/config.server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/send-html.server";
import { isInQuietHours } from "@/lib/quiet-hours";
import { loadPlanContext, toUserLocalDate } from "@/features/planner/plan-input.server";
import { BURNOUT, MODE_CONFIGS } from "@/features/planner/planner";
import { generateStructured } from "@/features/planner/llm/gemini.server";
import { assessOverload, type OverloadAssessment } from "./overload";

/** Don't contact the same user more often than this. */
const CONTACT_THROTTLE_HOURS = 72;

// --- LLM narrative contract (mirrors the schema.ts colocated-pair pattern) ---

const narrativeZodSchema = z.object({
  subject: z.string().min(1).max(120),
  headline: z.string().min(1).max(160),
  paragraphs: z.array(z.string().max(400)).min(1).max(3),
  // Not in the Gemini schema's `required` — must stay optional here too, or a
  // suggestion-less (valid) response would fail Zod and burn the retry.
  suggestions: z.array(z.string().max(200)).max(3).default([]),
});
type Narrative = z.infer<typeof narrativeZodSchema>;

const narrativeResponseSchema = {
  type: "OBJECT",
  properties: {
    subject: { type: "STRING", description: "Email subject, warm and specific." },
    headline: { type: "STRING", description: "One-line summary of the pattern." },
    paragraphs: { type: "ARRAY", items: { type: "STRING" } },
    suggestions: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["subject", "headline", "paragraphs"],
} as const;

const NARRATIVE_SYSTEM = [
  "You write a short, warm, non-alarmist wellbeing note for a university",
  "student, based ONLY on the computed metrics and the rules OUR system",
  "triggered. Never invent diagnoses or new findings; this is a behavioral",
  "load pattern, not a medical statement. At most 120 words across the",
  "paragraphs. Up to 3 concrete, gentle suggestions. Output ONLY JSON",
  "conforming to the schema.",
].join("\n");

// --- per-user core ------------------------------------------------------------

export interface LoadReviewOutcome {
  userId: string;
  level: OverloadAssessment["level"];
  triggeredRules: string[];
  action:
    | "emailed"
    | "emailed-fallback"
    | "skipped-ok"
    | "skipped-throttled"
    | "skipped-quiet"
    | "skipped-no-email"
    | "error";
  detail?: string;
}

interface ReviewOpts {
  /** Bypass the 72h throttle (the demo button). */
  force?: boolean;
}

/** Assess one user; when warranted, email them and stamp user_settings. */
export async function reviewUserLoad(
  userId: string,
  opts: ReviewOpts = {},
): Promise<LoadReviewOutcome> {
  const admin = getSupabaseAdminClient();

  const [profileRes, settingsRes] = await Promise.all([
    admin
      .from("profiles")
      .select("email, display_name, tz_offset_min")
      .eq("id", userId)
      .maybeSingle(),
    admin
      .from("user_settings")
      .select(
        "notifications_enabled, quiet_hours_start, quiet_hours_end, plan_daily_cap_min, study_plan_mode, last_load_review_at",
      )
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  // A failed read must not fail open (e.g. emailing someone whose
  // notifications_enabled=false we couldn't see).
  if (profileRes.error || settingsRes.error) {
    return {
      userId,
      level: "ok",
      triggeredRules: [],
      action: "error",
      detail: (profileRes.error ?? settingsRes.error)?.message,
    };
  }
  const profile = (profileRes.data ?? {}) as Record<string, unknown>;
  const settings = (settingsRes.data ?? {}) as Record<string, unknown>;

  const email = typeof profile.email === "string" ? profile.email.trim() : "";
  if (!email) return { userId, level: "ok", triggeredRules: [], action: "skipped-no-email" };
  if (settings.notifications_enabled === false) {
    return {
      userId,
      level: "ok",
      triggeredRules: [],
      action: "skipped-quiet",
      detail: "notifications disabled",
    };
  }

  // Throttle: at most one contact per 72h (mirrors maybeSendWeeklySummaries).
  const last =
    typeof settings.last_load_review_at === "string"
      ? Date.parse(settings.last_load_review_at)
      : NaN;
  if (
    !opts.force &&
    Number.isFinite(last) &&
    Date.now() - last < CONTACT_THROTTLE_HOURS * 3600_000
  ) {
    return { userId, level: "ok", triggeredRules: [], action: "skipped-throttled" };
  }

  // Assess with the same server-side context the planner uses.
  const context = await loadPlanContext(admin, userId, {
    now: new Date(),
    horizonDays: 7,
    includeLectureReview: false,
  });
  const input = context.input;
  const modeCfg = MODE_CONFIGS[input.mode];
  const dailyCap =
    input.dailyCapMin != null && Number.isFinite(input.dailyCapMin)
      ? Math.max(30, Math.min(600, Math.round(input.dailyCapMin)))
      : modeCfg.dailyCapMin;

  const assessment = assessOverload({
    now: input.now,
    sessions: input.sessions,
    externalLoad: context.externalLoad,
    events: input.events,
    homework: input.homework,
    weeklyCapMin: dailyCap * BURNOUT.weeklyCapMultiplier,
    recentTiredness: context.recentTiredness,
    semesterStart: input.semesterStart,
    semesterEnd: input.semesterEnd,
  });

  const ruleDetails = assessment.triggeredRules.map((r) => r.detail);
  if (assessment.level === "ok") {
    return { userId, level: "ok", triggeredRules: ruleDetails, action: "skipped-ok" };
  }

  // Quiet hours (user-local): don't email mid-night; the next run catches it.
  const tz = Number(profile.tz_offset_min ?? 0) || 0;
  const localNow = toUserLocalDate(Date.now(), tz);
  const quietStart =
    typeof settings.quiet_hours_start === "string" ? settings.quiet_hours_start.slice(0, 5) : null;
  const quietEnd =
    typeof settings.quiet_hours_end === "string" ? settings.quiet_hours_end.slice(0, 5) : null;
  if (!opts.force && isInQuietHours(localNow, quietStart, quietEnd)) {
    return {
      userId,
      level: assessment.level,
      triggeredRules: ruleDetails,
      action: "skipped-quiet",
    };
  }

  const name =
    (typeof profile.display_name === "string" && profile.display_name.trim()) ||
    email.split("@")[0];

  // The AI writes ONLY the words. Any failure → plain templated email.
  let narrative: Narrative | null = null;
  try {
    narrative = await generateStructured({
      system: NARRATIVE_SYSTEM,
      user: JSON.stringify({
        name,
        level: assessment.level,
        triggeredRules: ruleDetails,
        metrics: assessment.metrics,
      }),
      responseSchema: narrativeResponseSchema,
      zodSchema: narrativeZodSchema,
    });
  } catch {
    narrative = null;
  }

  const html = narrative
    ? renderNarrativeHtml(name, narrative, ruleDetails)
    : renderFallbackHtml(name, assessment);
  const subject = narrative?.subject ?? "MindBox check-in — your study load looks heavy";

  const sent = await sendEmail({ to: email, subject, html });
  if (!sent.sent) {
    return {
      userId,
      level: assessment.level,
      triggeredRules: ruleDetails,
      action: "error",
      detail: `email not sent: ${sent.reason ?? "unknown"}`,
    };
  }

  const { error: stampError } = await admin.from("user_settings").upsert(
    {
      user_id: userId,
      last_load_review_at: new Date().toISOString(),
      last_load_review: {
        level: assessment.level,
        triggeredRules: ruleDetails,
        metrics: assessment.metrics,
        narrative: narrative ? { headline: narrative.headline } : null,
        sentAt: new Date().toISOString(),
      },
    },
    { onConflict: "user_id" },
  );

  return {
    userId,
    level: assessment.level,
    triggeredRules: ruleDetails,
    action: narrative ? "emailed" : "emailed-fallback",
    // Email went out but the throttle stamp failed — surface it so the sweep
    // log shows why the same user might be contacted again tomorrow.
    detail: stampError ? `throttle stamp failed: ${stampError.message}` : undefined,
  };
}

// --- HTML (assembled by OUR code — the model never emits HTML) ---------------

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderNarrativeHtml(name: string, n: Narrative, rules: string[]): string {
  return `
  <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:16px;color:#1f2937">
    <h2 style="margin:0 0 4px">${esc(n.headline)}</h2>
    <p style="margin:0 0 12px;color:#6b7280;font-size:13px">Hi ${esc(name)} — a note from your MindBox load review.</p>
    ${n.paragraphs.map((p) => `<p style="margin:0 0 10px;line-height:1.5">${esc(p)}</p>`).join("")}
    ${
      n.suggestions.length
        ? `<ul style="margin:0 0 14px;padding-left:20px;line-height:1.6">${n.suggestions
            .map((s) => `<li>${esc(s)}</li>`)
            .join("")}</ul>`
        : ""
    }
    <p style="margin:14px 0 0;font-size:12px;color:#9ca3af">
      Why you got this: ${rules.map(esc).join(" · ")}<br/>
      This is a behavioral pattern estimate from your MindBox data — not medical advice.
    </p>
  </div>`;
}

function renderFallbackHtml(name: string, a: OverloadAssessment): string {
  const m = a.metrics;
  return `
  <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:16px;color:#1f2937">
    <h2 style="margin:0 0 8px">Your study load looks ${a.level === "danger" ? "very heavy" : "heavy"}</h2>
    <p style="margin:0 0 10px;line-height:1.5">Hi ${esc(name)} — MindBox's daily review flagged:</p>
    <ul style="margin:0 0 12px;padding-left:20px;line-height:1.6">
      ${a.triggeredRules.map((r) => `<li>${esc(r.detail)}</li>`).join("")}
    </ul>
    <p style="margin:0 0 10px;font-size:13px;color:#6b7280">
      Last 7 days: ${Math.round(m.focusMinutesLast7 / 60)}h focus · ${m.consecutiveActiveDays} active days in a row ·
      recovery score ${m.recoveryScore}/100.
    </p>
    <p style="margin:0;line-height:1.5">Consider a lighter day or regenerating your study plan.</p>
    <p style="margin:14px 0 0;font-size:12px;color:#9ca3af">Behavioral pattern estimate — not medical advice.</p>
  </div>`;
}

// --- route handler -------------------------------------------------------------

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** POST /jobs/load-review — sweep every user (external cron entry point). */
export async function handleLoadReviewRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

    // Constant-time-ish compare, same discipline as the ingest secret check.
    const { jobsSecret } = getServerConfig();
    const provided = request.headers.get("x-jobs-secret");
    if (!jobsSecret || !provided || provided.length !== jobsSecret.length) {
      return json({ error: "Invalid or missing x-jobs-secret." }, 401);
    }
    let mismatch = 0;
    for (let i = 0; i < provided.length; i += 1) {
      mismatch |= provided.charCodeAt(i) ^ jobsSecret.charCodeAt(i);
    }
    if (mismatch !== 0) {
      return json({ error: "Invalid or missing x-jobs-secret." }, 401);
    }

    const admin = getSupabaseAdminClient();
    // Deterministic order + a generous cap for a course project (log if hit).
    const { data: profiles, error } = await admin
      .from("profiles")
      .select("id")
      .order("id")
      .limit(200);
    if (error) return json({ error: error.message }, 500);
    if ((profiles ?? []).length === 200) {
      console.warn("load-review: profile cap (200) reached — some users were not swept.");
    }

    const outcomes: LoadReviewOutcome[] = [];
    for (const row of (profiles ?? []) as { id: string }[]) {
      try {
        outcomes.push(await reviewUserLoad(row.id));
      } catch (e) {
        outcomes.push({
          userId: row.id,
          level: "ok",
          triggeredRules: [],
          action: "error",
          detail: e instanceof Error ? e.message : "unknown",
        });
      }
    }

    const emailed = outcomes.filter((o) => o.action.startsWith("emailed")).length;
    return json(
      {
        ok: true,
        checked: outcomes.length,
        emailed,
        outcomes: outcomes.map(({ userId, level, action }) => ({ userId, level, action })),
      },
      200,
    );
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Load review failed." }, 500);
  }
}
