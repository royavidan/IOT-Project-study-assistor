// Planner data plumbing: gather the real inputs the pure planner needs, and
// commit an approved draft. All scheduling math lives in `planner.ts` — these
// hooks only read existing queries and write via the schedule feature.

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { useScheduleEvents, useScheduleActions } from "@/features/schedule/queries";
import type { ScheduleEventInput } from "@/features/schedule/queries";
import { STUDY_COLOR, parseTimeToMinutes } from "@/features/schedule/schedule";
import { useHomeworkAssignments } from "@/lib/queries/homework";
import { useSessions } from "@/lib/queries/sessions";
import { useSettings, DEFAULT_SETTINGS } from "@/lib/queries/settings";
import type { AppSettings } from "@/lib/queries/settings";
import { useExternalLoads } from "@/features/insights/external-load";
import { useCourses } from "@/features/courses/queries";
import { computeWellbeing } from "@/lib/wellbeing";
import { toDateKey } from "@/lib/dates";
import {
  addDaysKey,
  type PlanDraft,
  type PlanInput,
  type PlanMode,
  type ProposedBlock,
} from "./planner";

export interface PlanInputsState {
  isLoading: boolean;
  /** True once there's at least homework or events loaded to plan around. */
  hasData: boolean;
  settings: AppSettings;
  /** Assemble a fresh PlanInput at generate time (`now` is captured here). */
  build: (mode: PlanMode, horizonDays: number, includeLectureReview: boolean) => PlanInput;
}

/** Gather everything the pure planner needs from existing queries. */
export function usePlanInputs(): PlanInputsState {
  const eventsQ = useScheduleEvents();
  const sessionsQ = useSessions();
  const homeworkQ = useHomeworkAssignments();
  const settingsQ = useSettings();
  const externalQ = useExternalLoads();
  const coursesQ = useCourses();

  const settings = settingsQ.data ?? DEFAULT_SETTINGS;
  const events = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);
  const sessions = useMemo(() => sessionsQ.data ?? [], [sessionsQ.data]);
  const homework = useMemo(() => homeworkQ.data ?? [], [homeworkQ.data]);
  const external = useMemo(() => externalQ.data ?? [], [externalQ.data]);
  const courses = useMemo(() => coursesQ.data ?? [], [coursesQ.data]);

  // Wellbeing is derived, not stored — recompute from sessions + external load.
  const wellbeing = useMemo(() => computeWellbeing(sessions, external), [sessions, external]);

  const isLoading =
    eventsQ.isLoading ||
    sessionsQ.isLoading ||
    homeworkQ.isLoading ||
    settingsQ.isLoading ||
    coursesQ.isLoading;
  const hasData = events.length > 0 || homework.length > 0 || courses.length > 0;

  const build = (
    mode: PlanMode,
    horizonDays: number,
    includeLectureReview: boolean,
  ): PlanInput => ({
    now: new Date(),
    horizonDays,
    events,
    sessions,
    homework,
    mode,
    dailyCapMin: settings.planDailyCapMin,
    dayStartMin: parseTimeToMinutes(settings.planDayStart) ?? 9 * 60,
    dayEndMin: parseTimeToMinutes(settings.planDayEnd) ?? 21 * 60,
    quietStart: settings.quietHoursStart ? parseTimeToMinutes(settings.quietHoursStart) : null,
    quietEnd: settings.quietHoursEnd ? parseTimeToMinutes(settings.quietHoursEnd) : null,
    semesterStart: settings.semesterStart,
    semesterEnd: settings.semesterEnd,
    recovery: { ready: wellbeing.recovery.ready, status: wellbeing.recovery.status },
    bestWindow: wellbeing.circadian.bestWindow,
    courses,
    includeLectureReview,
  });

  return { isLoading, hasData, settings, build };
}

function toScheduleInput(block: ProposedBlock): ScheduleEventInput {
  return {
    title: block.title,
    courseCode: block.courseCode,
    color: block.color || STUDY_COLOR,
    category: "study",
    kind: "once",
    eventDate: block.dateKey,
    startTime: block.startTime,
    endTime: block.endTime,
    planGenerated: true,
  };
}

export interface CommitPlanArgs {
  draft: PlanDraft;
  now: Date;
  horizonDays: number;
}

/**
 * Replace planner-generated study blocks in the plan's horizon with the
 * approved draft. Hand-made study blocks are preserved. Invalidation of the
 * schedule cache is handled by the underlying schedule mutation.
 */
export function useCommitPlan() {
  const actions = useScheduleActions();
  return {
    isPending: actions.replaceGenerated.isPending,
    commit: ({ draft, now, horizonDays }: CommitPlanArgs) => {
      const fromKey = toDateKey(now);
      const toKey = addDaysKey(fromKey, Math.max(1, horizonDays) - 1);
      return actions.replaceGenerated.mutateAsync({
        fromKey,
        toKey,
        inputs: draft.blocks.map(toScheduleInput),
      });
    },
  };
}

// --- Plan metadata (staleness fingerprint) -----------------------------------

export interface PlanMeta {
  fingerprint: string | null;
  generatedAt: string | null;
  /** Engine/summary/assumptions of the last committed plan (see run-plan.server). */
  meta: Record<string, unknown> | null;
}

async function fetchPlanMeta(): Promise<PlanMeta> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { fingerprint: null, generatedAt: null, meta: null };

  const { data, error } = await supabase
    .from("user_settings")
    .select("last_plan_fingerprint, last_plan_generated_at, last_plan_meta")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    fingerprint: row.last_plan_fingerprint ? String(row.last_plan_fingerprint) : null,
    generatedAt: row.last_plan_generated_at ? String(row.last_plan_generated_at) : null,
    meta:
      row.last_plan_meta && typeof row.last_plan_meta === "object"
        ? (row.last_plan_meta as Record<string, unknown>)
        : null,
  };
}

/** What the last committed plan was based on — powers the stale banner. */
export function usePlanMeta() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["plan-meta", user?.id],
    queryFn: fetchPlanMeta,
    enabled: !!user,
  });
}

export interface SavePlanMetaArgs {
  fingerprint: string;
  meta: Record<string, unknown>;
}

/** Stamp the plan-meta columns at commit time (the client is the sole writer
 *  for manual plans; check-in auto-replans stamp server-side). */
export function useSavePlanMeta() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ fingerprint, meta }: SavePlanMetaArgs) => {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { user: authed },
      } = await supabase.auth.getUser();
      if (!authed) throw new Error("You must be signed in.");
      const { error } = await supabase.from("user_settings").upsert(
        {
          user_id: authed.id,
          last_plan_fingerprint: fingerprint,
          last_plan_generated_at: new Date().toISOString(),
          last_plan_meta: meta,
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["plan-meta", user?.id] });
    },
  });
}

/** Wipe the plan-meta stamp — used by the calendar's "Clear plan" so the
 *  stale banner doesn't nag about a plan that no longer exists. */
export function useClearPlanMeta() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const supabase = getSupabaseBrowserClient();
      const {
        data: { user: authed },
      } = await supabase.auth.getUser();
      if (!authed) throw new Error("You must be signed in.");
      const { error } = await supabase.from("user_settings").upsert(
        {
          user_id: authed.id,
          last_plan_fingerprint: null,
          last_plan_generated_at: null,
          last_plan_meta: null,
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["plan-meta", user?.id] });
    },
  });
}
