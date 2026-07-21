// Server-side assembly of the pure planner's PlanInput — the same data
// `usePlanInputs()` gathers client-side, re-read here so the LLM pipeline is
// fully server-automatic (plan generation, check-in replans and the load
// review all reuse it). Row→domain mapping mirrors the client queries
// (schedule/homework/courses/sessions `mapRow`s) — keep them in sync when a
// column is added.
//
// Timezone note: the pure planner interprets Dates with LOCAL getters, which
// on a deployed server is the server's zone, not the student's. Every date
// here is therefore shifted into the user's zone (profiles.tz_offset_min, the
// same source the device downlink uses) before the pure code sees it.

import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/types";
import type { HomeworkAssignment, HomeworkStatus, Session, SessionMode } from "@/lib/types";
import { computeWellbeing, type ExternalLoadEntry } from "@/lib/wellbeing";
import { toDateKey } from "@/lib/dates";
import type { ScheduleEvent } from "@/features/schedule/schedule";
import { parseTimeToMinutes } from "@/features/schedule/schedule";
import type { Course } from "@/features/courses/courses";
import type { PlanInput, PlanMode } from "@/features/planner/planner";

type Client = SupabaseClient<Database>;
type Row = Record<string, unknown>;

const SESSION_MODES: SessionMode[] = ["Deep Focus", "Study", "Reading", "Review", "Homework"];

export interface LoadPlanContextOpts {
  now: Date;
  horizonDays: number;
  includeLectureReview: boolean;
  /** Omit to use the user's saved study_plan_mode. */
  mode?: PlanMode;
}

export interface PlanContext {
  input: PlanInput;
  /** Tiredness (1-5) of the user's most recent check-ins, newest first (≤3). */
  recentTiredness: number[];
  /** Manual external commitments (the load review needs them separately). */
  externalLoad: ExternalLoadEntry[];
  /** Minutes ahead of UTC for the user (profiles.tz_offset_min, default 0). */
  tzOffsetMin: number;
}

/** Mean of the recent tiredness values, or null when there are none. */
export function meanTiredness(values: number[]): number | null {
  const nums = values.filter((n) => Number.isFinite(n));
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

/**
 * Shift a UTC instant so that LOCAL getters on the result show the user's
 * wall-clock time regardless of the server's own timezone.
 */
export function toUserLocalDate(utcMs: number, tzOffsetMin: number): Date {
  const serverOffsetMin = -new Date(utcMs).getTimezoneOffset();
  return new Date(utcMs + (tzOffsetMin - serverOffsetMin) * 60000);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Load everything the pure planner needs, scoped to `userId`. */
export async function loadPlanContext(
  supabase: Client,
  userId: string,
  opts: LoadPlanContextOpts,
): Promise<PlanContext> {
  const [eventsRes, sessionsRes, homeworkRes, settingsRes, profileRes, coursesRes, externalRes] =
    await Promise.all([
      supabase
        .from("schedule_events")
        .select(
          "id, title, course_code, location, color, category, subtype, kind, day_of_week, event_date, start_time, end_time, notes, exam_weight, exam_score, plan_generated",
        )
        .eq("user_id", userId),
      supabase
        .from("sessions")
        .select(
          "id, user_id, started_at, ended_at, actual_focus_sec, mode, status, focus_load_avg, breaks, presence_interruptions, companions",
        )
        .eq("user_id", userId),
      supabase
        .from("homework_assignments")
        .select(
          "id, course_code, title, description, due_date, status, grade, progress_pct, weight, estimated_minutes, notes",
        )
        .eq("user_id", userId),
      supabase
        .from("user_settings")
        .select(
          "study_plan_mode, plan_day_start, plan_day_end, plan_daily_cap_min, quiet_hours_start, quiet_hours_end, semester_start, semester_end",
        )
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.from("profiles").select("tz_offset_min").eq("id", userId).maybeSingle(),
      supabase
        .from("courses")
        .select("id, code, name, color, watched_lectures, watched_tutorials, watched_labs")
        .eq("user_id", userId),
      supabase.from("external_loads").select("label, kind, hours, date").eq("user_id", userId),
    ]);

  for (const res of [eventsRes, sessionsRes, homeworkRes, settingsRes, profileRes, coursesRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const tzOffsetMin = Number((profileRes.data as Row | null)?.tz_offset_min ?? 0) || 0;
  const events = ((eventsRes.data ?? []) as Row[]).map(mapEventRow);
  const sessions = ((sessionsRes.data ?? []) as Row[]).map((r) => mapSessionRow(r, tzOffsetMin));
  const homework = ((homeworkRes.data ?? []) as Row[]).map(mapHomeworkRow);
  const courses = ((coursesRes.data ?? []) as Row[]).map(mapCourseRow);
  // Manual commitments only — mirrors usePlanInputs (schedule load is merged
  // elsewhere for the Focus Battery, not for planning).
  const external: ExternalLoadEntry[] = externalRes.error
    ? []
    : ((externalRes.data ?? []) as Row[]).map((r) => ({
        label: String(r.label ?? ""),
        kind: r.kind === "dated" ? "dated" : "weekly",
        hours: Number(r.hours ?? 0),
        date: r.date ? String(r.date) : null,
      }));

  const s = (settingsRes.data ?? {}) as Row;
  const mode: PlanMode =
    opts.mode ??
    (s.study_plan_mode === "deep_focus" || s.study_plan_mode === "sprint"
      ? (s.study_plan_mode as PlanMode)
      : "balanced");

  const wellbeing = computeWellbeing(sessions, external);
  const now = toUserLocalDate(opts.now.getTime(), tzOffsetMin);

  const input: PlanInput = {
    now,
    horizonDays: opts.horizonDays,
    events,
    sessions,
    homework,
    mode,
    dailyCapMin: s.plan_daily_cap_min == null ? null : Number(s.plan_daily_cap_min),
    dayStartMin: timeToMin(s.plan_day_start) ?? 9 * 60,
    dayEndMin: timeToMin(s.plan_day_end) ?? 21 * 60,
    quietStart: timeToMin(s.quiet_hours_start),
    quietEnd: timeToMin(s.quiet_hours_end),
    semesterStart: dateOnly(s.semester_start),
    semesterEnd: dateOnly(s.semester_end),
    recovery: { ready: wellbeing.recovery.ready, status: wellbeing.recovery.status },
    bestWindow: wellbeing.circadian.bestWindow,
    courses,
    includeLectureReview: opts.includeLectureReview,
  };

  return {
    input,
    recentTiredness: await fetchRecentTiredness(supabase, userId),
    externalLoad: external,
    tzOffsetMin,
  };
}

/**
 * Tiredness of the last 3 check-ins, newest first. Non-fatal by design:
 * before migration 0021 the columns don't exist and this returns [].
 */
async function fetchRecentTiredness(supabase: Client, userId: string): Promise<number[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select("tiredness")
    .eq("user_id", userId)
    .not("tiredness", "is", null)
    .order("checkin_at", { ascending: false })
    .limit(3);
  if (error || !data) return [];
  return (data as Row[]).map((r) => Number(r.tiredness)).filter((n) => Number.isFinite(n));
}

// --- row mappers (mirror the client queries' mapRow functions) ---------------

function mapEventRow(row: Row): ScheduleEvent {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    courseCode: row.course_code ? String(row.course_code) : null,
    location: row.location ? String(row.location) : null,
    color: String(row.color ?? "#6366f1"),
    category: row.category === "exam" ? "exam" : row.category === "study" ? "study" : "class",
    subtype: row.subtype ? String(row.subtype) : null,
    kind: row.kind === "once" ? "once" : "weekly",
    dayOfWeek: row.day_of_week == null ? null : Number(row.day_of_week),
    eventDate: row.event_date ? String(row.event_date) : null,
    startTime: String(row.start_time ?? "09:00"),
    endTime: String(row.end_time ?? "10:00"),
    notes: row.notes ? String(row.notes) : null,
    examWeight: row.exam_weight == null ? null : Number(row.exam_weight),
    examScore: row.exam_score == null ? null : Number(row.exam_score),
    planGenerated: Boolean(row.plan_generated),
  };
}

function mapSessionRow(row: Row, tzOffsetMin: number): Session {
  const started = toUserLocalDate(new Date(String(row.started_at)).getTime(), tzOffsetMin);
  const mode = String(row.mode ?? "Study");
  const actualSec = Number(row.actual_focus_sec ?? 0);
  return {
    id: String(row.id),
    date: toDateKey(started),
    start: `${pad(started.getHours())}:${pad(started.getMinutes())}`,
    durationMin: Math.max(1, Math.round(actualSec / 60)),
    mode: SESSION_MODES.includes(mode as SessionMode) ? (mode as SessionMode) : "Study",
    status:
      row.status === "interrupted" || row.status === "aborted"
        ? (row.status as Session["status"])
        : "completed",
    focusScore: Number(row.focus_load_avg ?? 0),
    breaks: Number(row.breaks ?? 0),
    subject: mode,
    noiseAvg: null,
    tempC: null,
    lightLux: null,
    presenceInterruptions: Number(row.presence_interruptions ?? 0),
    companions: row.companions === "with_others" ? "with_others" : "solo",
    userId: row.user_id ? String(row.user_id) : undefined,
    endedAt: row.ended_at ? String(row.ended_at) : undefined,
  };
}

function mapHomeworkRow(row: Row): HomeworkAssignment {
  return {
    id: String(row.id),
    courseCode: row.course_code ? String(row.course_code) : null,
    title: String(row.title ?? ""),
    description: row.description ? String(row.description) : null,
    dueDate: String(row.due_date ?? ""),
    status: (row.status as HomeworkStatus) ?? "pending",
    fileUrl: null,
    fileName: null,
    fileSizeBytes: null,
    grade: row.grade == null ? null : Number(row.grade),
    progressPct: row.progress_pct == null ? null : Number(row.progress_pct),
    weight: row.weight == null ? null : Number(row.weight),
    estimatedMinutes: row.estimated_minutes == null ? null : Number(row.estimated_minutes),
    notes: row.notes ? String(row.notes) : null,
    createdAt: "",
    updatedAt: "",
  };
}

function mapCourseRow(row: Row): Course {
  const count = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  };
  return {
    id: String(row.id),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    color: String(row.color ?? "#6366f1"),
    instructor: null,
    credits: null,
    targetGrade: null,
    notes: null,
    watchedLectures: count(row.watched_lectures),
    watchedTutorials: count(row.watched_tutorials),
    watchedLabs: count(row.watched_labs),
    createdAt: "",
    updatedAt: "",
  };
}

function timeToMin(value: unknown): number | null {
  if (typeof value !== "string" || value.length < 4) return null;
  return parseTimeToMinutes(value.slice(0, 5));
}

function dateOnly(value: unknown): string | null {
  return typeof value === "string" ? value.slice(0, 10) : null;
}
