// Server functions that assemble the RICH report HTML for the client print
// path (the browser "Save as PDF"). The rich model is server-only (needs the
// Focus Model + loadPlanContext), so the client fetches the finished HTML here
// and prints it — one report for print + email. RLS-scoped to the signed-in user.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { localDayRangeIso } from "@/lib/dates";
import { getServerConfig } from "@/lib/config.server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { buildReportHtml } from "./report-model";
import { buildSessionReportModel, buildWeeklyReportModel } from "./report-model.server";
import { generateReportNarrative } from "./report-narrative.server";
import type { ReportMeta } from "./export";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const getReportHtml = createServerFn({ method: "POST" })
  .inputValidator(z.object({ from: z.string().regex(DATE), to: z.string().regex(DATE) }))
  .handler(async ({ data }): Promise<{ html: string }> => {
    const supabase = getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("You must be signed in.");

    const meta: ReportMeta = {
      user: user.email ?? "You",
      from: data.from,
      to: data.to,
      generatedAt: new Date().toISOString(),
    };
    const { fromIso, toIso } = localDayRangeIso(data.from, data.to);
    const model = await buildWeeklyReportModel(supabase, user.id, meta, fromIso, toIso);
    if (getServerConfig().report.aiSummary) model.narrative = await generateReportNarrative(model);
    return { html: buildReportHtml(model) };
  });

export const getSessionReportHtml = createServerFn({ method: "POST" })
  .inputValidator(z.object({ sessionId: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ html: string | null }> => {
    const supabase = getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("You must be signed in.");

    const today = new Date().toISOString().slice(0, 10);
    const meta: ReportMeta = {
      user: user.email ?? "You",
      from: today,
      to: today,
      generatedAt: new Date().toISOString(),
    };
    const model = await buildSessionReportModel(supabase, user.id, meta, data.sessionId);
    if (!model) return { html: null };
    return { html: buildReportHtml(model) };
  });
