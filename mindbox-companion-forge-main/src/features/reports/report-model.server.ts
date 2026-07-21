// Server-side assembly of the report MODEL (weekly + per-session). Pure numeric
// work lives in the aggregators (`@/lib/*`, `@/features/insights/*`); this file
// only fetches + maps them into the report-local blocks that report-model.ts
// renders. Reuses `loadPlanContext` (the one call that assembles schedule +
// homework + courses + settings) and `computeFocusEstimate`.

import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { parseDateKey, toDateKey } from "@/lib/dates";
import type { Session } from "@/lib/types";
import { computeWellbeing } from "@/lib/wellbeing";
import { summarizeStudyTime } from "@/lib/study-time";
import { conditionsFromSessions } from "@/lib/env-quality";
import { computeSessionDynamics } from "@/lib/focus/session-dynamics";
import { computeHourlyHeatmap, computeSessionInsights } from "@/features/insights/insights";
import { assessOverload } from "@/features/insights/overload";
import { computeFocusEstimate } from "@/features/insights/focus-model.server";
import { loadPlanContext } from "@/features/planner/plan-input.server";
import { MODE_CONFIGS } from "@/features/planner/planner";
import { buildCourseSummaries } from "@/features/courses/courses";
import { upcomingExams } from "@/features/schedule/schedule";
import { mapSessionRow } from "./deliver-report.server";
import type { ReportMeta } from "./export";
import type { AcademicBlock, CheckinBlock, ReportModel, SessionRow } from "./report-model";

const SESSION_COLS =
  "id, user_id, started_at, ended_at, actual_focus_sec, mode, status, focus_load_avg, breaks, noise_avg, temp_c, light_lux, presence_interruptions, companions, tiredness, checkin_at";

function nowIso(): string {
  return new Date().toISOString();
}

async function fetchRangeSessions(
  supabase: SupabaseClient,
  userId: string,
  fromIso: string,
  toIso: string,
): Promise<Session[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select(SESSION_COLS)
    .eq("user_id", userId)
    .gte("started_at", fromIso)
    .lte("started_at", toIso)
    .order("started_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const s = mapSessionRow(row);
    s.tiredness = row.tiredness == null ? null : Number(row.tiredness);
    return s;
  });
}

/** Tiredness distribution + recent free-text notes over the range. */
async function fetchCheckinFeedback(
  supabase: SupabaseClient,
  userId: string,
  fromIso: string,
  toIso: string,
): Promise<CheckinBlock> {
  const { data } = await supabase
    .from("sessions")
    .select("started_at, tiredness, checkin_note")
    .eq("user_id", userId)
    .not("tiredness", "is", null)
    .gte("started_at", fromIso)
    .lte("started_at", toIso)
    .order("started_at", { ascending: false });
  const rows = (data ?? []) as {
    started_at: string;
    tiredness: number;
    checkin_note: string | null;
  }[];
  const distribution = [0, 0, 0, 0, 0];
  let sum = 0;
  const notes: CheckinBlock["notes"] = [];
  for (const r of rows) {
    const t = Number(r.tiredness);
    if (t >= 1 && t <= 5) {
      distribution[t - 1] += 1;
      sum += t;
    }
    if (r.checkin_note && r.checkin_note.trim() && notes.length < 6) {
      notes.push({
        date: toDateKey(new Date(r.started_at)),
        tiredness: t,
        text: r.checkin_note.trim(),
      });
    }
  }
  return {
    count: rows.length,
    avgTiredness: rows.length ? sum / rows.length : null,
    distribution,
    notes,
  };
}

function weeklyTrend(sessions: Session[]): { label: string; minutes: number }[] {
  const byDay = new Map<string, number>();
  for (const s of sessions) byDay.set(s.date, (byDay.get(s.date) ?? 0) + s.durationMin);
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, minutes]) => ({ label: date.slice(5), minutes }));
}

function hourlyMinutes(sessions: Session[]): number[] {
  const hours = new Array(24).fill(0);
  for (const s of sessions) {
    const h = Number(s.start.slice(0, 2));
    if (h >= 0 && h < 24) hours[h] += s.durationMin;
  }
  return hours;
}

/** Assemble the comprehensive weekly report model (no narrative — added by caller). */
export async function buildWeeklyReportModel(
  supabase: SupabaseClient,
  userId: string,
  meta: ReportMeta,
  fromIso: string,
  toIso: string,
): Promise<ReportModel> {
  const now = new Date();
  const [sessions, checkin, focusRes, ctx] = await Promise.all([
    fetchRangeSessions(supabase, userId, fromIso, toIso),
    fetchCheckinFeedback(supabase, userId, fromIso, toIso),
    computeFocusEstimate(supabase, userId),
    loadPlanContext(supabase, userId, { now, horizonDays: 14, includeLectureReview: false }),
  ]);

  const wb = computeWellbeing(sessions, ctx.externalLoad);
  const insights = computeSessionInsights(sessions);
  const st = summarizeStudyTime(sessions);
  const conditions = conditionsFromSessions(sessions);

  const dailyCap = ctx.input.dailyCapMin ?? MODE_CONFIGS[ctx.input.mode].dailyCapMin;
  const overload = assessOverload({
    now,
    sessions: ctx.input.sessions,
    externalLoad: ctx.externalLoad,
    events: ctx.input.events,
    homework: ctx.input.homework,
    weeklyCapMin: dailyCap * 5,
    recentTiredness: ctx.recentTiredness,
    semesterStart: ctx.input.semesterStart,
    semesterEnd: ctx.input.semesterEnd,
  });

  const courseRoll = buildCourseSummaries(
    ctx.input.courses ?? [],
    ctx.input.events,
    ctx.input.homework,
    now,
  );
  const exams = upcomingExams(ctx.input.events, now, 21);
  const homeworkDue = ctx.input.homework
    .filter((h) => h.status === "pending")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6);

  const academic: AcademicBlock = {
    overall: {
      completionPct: courseRoll.overall.completionPct,
      gradeAvg: courseRoll.overall.creditWeightedGradeAverage,
    },
    courses: courseRoll.perCourse.map((c) => ({
      code: c.course.code,
      name: c.course.name,
      completionPct: c.completionPct,
      grade: c.gradeAverage,
      target: c.targetGrade,
    })),
    upcomingExams: exams.map((e) => ({
      title: e.event.title,
      course: e.event.courseCode ?? "",
      daysUntil: e.daysUntil,
    })),
    homeworkDue: homeworkDue.map((h) => ({
      title: h.title,
      course: h.courseCode ?? "",
      due: h.dueDate,
      status: h.status,
    })),
  };

  const est = focusRes.ready ? focusRes.estimate : null;
  const trendLabel =
    est == null
      ? ""
      : est.trend.direction === "rising"
        ? "trending toward more strain"
        : est.trend.direction === "falling"
          ? "easing lately"
          : "holding steady lately";

  const sessionRows: SessionRow[] = sessions.map((s) => ({
    date: s.date,
    start: s.start,
    durationMin: s.durationMin,
    mode: s.mode,
    status: s.status,
    focusScore: s.focusScore,
    tiredness: s.tiredness ?? null,
  }));

  const totalMin = sessions.reduce((a, s) => a + s.durationMin, 0);

  return {
    scope: "weekly",
    meta,
    stats: [
      { label: "Sessions", value: String(sessions.length) },
      { label: "Total focus", value: `${(totalMin / 60).toFixed(1)} h` },
      { label: "Check-ins", value: String(checkin.count) },
      { label: "Load status", value: overload.level },
    ],
    focus: est
      ? {
          energyScore: est.energyScore,
          energyCI: est.energyCI,
          headline: est.headline,
          reliability: est.reliability.label,
          trendLabel,
          drivers: est.drivers.map((d) => ({
            label: d.label,
            effect: d.contribution > 0 ? "adds" : "eases",
          })),
        }
      : null,
    wellbeing: {
      ready: wb.ready,
      signals: [
        { title: "Recovery balance", ...pick(wb.recovery) },
        { title: "Circadian alignment", ...pick(wb.circadian) },
        { title: "Routine consistency", ...pick(wb.consistency) },
      ].filter((s) => s.score >= 0),
    },
    overload: { level: overload.level, rules: overload.triggeredRules.map((r) => r.detail) },
    insights: {
      bestTime: insights.bestTimeSlot?.label ?? null,
      modes: insights.modeBreakdown.map((m) => ({
        mode: m.mode,
        minutes: m.totalMinutes,
        count: m.count,
      })),
      hourly: hourlyMinutes(sessions),
      weekly: weeklyTrend(sessions),
    },
    studyTime: {
      rawMin: st.rawMin,
      effectiveMin: st.effectiveMin,
      ratio: st.ratio,
      sweetSpot: st.sweetSpotLabel,
    },
    conditions: conditions
      ? {
          score: conditions.score,
          band: conditions.band,
          factors: conditions.factors.map((f) => ({
            label: f.label,
            value: `${f.value}${f.unit}`,
            band: f.band,
            tip: f.tip ?? "",
          })),
        }
      : null,
    checkin,
    academic,
    sessions: sessionRows,
  };
}

function pick(s: { ready: boolean; score: number; status: string; headline: string }): {
  score: number;
  status: string;
  headline: string;
} {
  return s.ready
    ? { score: s.score, status: s.status, headline: s.headline }
    : { score: -1, status: "", headline: "" };
}

/** Assemble a basic per-session report model. */
export async function buildSessionReportModel(
  supabase: SupabaseClient,
  userId: string,
  meta: ReportMeta,
  sessionId: string,
): Promise<ReportModel | null> {
  const { data: srow } = await supabase
    .from("sessions")
    .select(
      "id, mode, status, actual_focus_sec, breaks, presence_interruptions, tiredness, checkin_note",
    )
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!srow) return null;
  const s = srow as Record<string, unknown>;

  const [focusRes, envRes] = await Promise.all([
    supabase
      .from("focus_load_samples")
      .select("t_sec, value")
      .eq("session_id", sessionId)
      .order("t_sec"),
    supabase.from("env_samples").select("t_sec, noise").eq("session_id", sessionId).order("t_sec"),
  ]);

  const byMin = new Map<number, { tMin: number; focus: number | null; noise: number | null }>();
  const at = (tSec: number) => {
    const tMin = Math.round(tSec / 60);
    let p = byMin.get(tMin);
    if (!p) {
      p = { tMin, focus: null, noise: null };
      byMin.set(tMin, p);
    }
    return p;
  };
  for (const r of (focusRes.data ?? []) as Record<string, unknown>[]) {
    at(Number(r.t_sec ?? 0)).focus = r.value == null ? null : Number(r.value);
  }
  for (const r of (envRes.data ?? []) as Record<string, unknown>[]) {
    at(Number(r.t_sec ?? 0)).noise = r.noise == null ? null : Number(r.noise);
  }
  const series = [...byMin.values()].sort((a, b) => a.tMin - b.tMin);
  const dyn = computeSessionDynamics(
    series.map((p) => ({
      tMin: p.tMin,
      focus: p.focus,
      noise: p.noise,
      tempC: null,
      lightLux: null,
    })),
  );

  const tiredness = s.tiredness == null ? null : Number(s.tiredness);
  return {
    scope: "session",
    meta,
    sessionDetail: {
      mode: String(s.mode ?? "Study"),
      status: String(s.status ?? "completed"),
      durationMin: Math.max(1, Math.round(Number(s.actual_focus_sec ?? 0) / 60)),
      breaks: Number(s.breaks ?? 0),
      presenceInterruptions: Number(s.presence_interruptions ?? 0),
      dynamics: {
        loadMean: dyn.loadMean,
        loadPeak: dyn.loadPeak,
        loadVolatility: dyn.loadVolatility,
        loadSlope: dyn.loadSlope,
        sustainedHighShare: dyn.sustainedHighShare,
        envNoiseCoupling: dyn.envNoiseCoupling,
      },
      series,
      checkin:
        tiredness != null ? { tiredness, note: (s.checkin_note as string | null) ?? null } : null,
    },
  };
}

export { nowIso };
