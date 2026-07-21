import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface AppSettings {
  displayName: string;
  notificationsEnabled: boolean;
  hapticsEnabled: boolean;
  shareWithReviewers: boolean;
  reduceMotion: boolean;
  adaptiveCoachingEnabled: boolean;
  /** "HH:MM" or null when unset. */
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  dailyGoalMin: number;
  /** Semester term — bounds weekly classes on the calendar. "YYYY-MM-DD" or null. */
  semesterLabel: string | null;
  semesterStart: string | null;
  semesterEnd: string | null;
  /** Study planner: default work-rhythm strategy. */
  studyPlanMode: "balanced" | "deep_focus" | "sprint";
  /** Study planner: working-hours window the planner may fill. "HH:MM". */
  planDayStart: string;
  planDayEnd: string;
  /** Study planner: optional daily cap (minutes) overriding the mode default. Null = use mode. */
  planDailyCapMin: number | null;
  /** MindBox speaker master switch (delivered on every config poll). */
  deviceSoundEnabled: boolean;
  /** MindBox speaker volume 0 (low) / 1 (mid) / 2 (high). */
  deviceSoundLevel: 0 | 1 | 2;
  /** Which chimes play — bit0 start/pause/resume, bit1 complete, bit2 auto-start, bit3 alerts. */
  deviceChimeMask: number;
  /** Auto-start a MindBox session when a planned study block begins. */
  autoStartScheduled: boolean;
  /** MindBox screen accent theme — preset id 0-4 (see features/device/theme-presets). */
  deviceThemeId: number;
  /** Pomodoro focus length (min) pushed to the box — adopted ONCE per site-save. */
  deviceFocusMin: number;
  /** Pomodoro break length (min) pushed to the box. */
  deviceBreakMin: number;
  /** Long break length (min) — taken after `deviceCycles` focus blocks. */
  deviceLongBreakMin: number;
  /** Focus blocks in a session before the long break (the box's cycle count). */
  deviceCycles: number;
  /** Exam/DND manual switch. Exam days in the calendar force DND on regardless. */
  examMode: boolean;
}

/** deviceChimeMask bit positions (mirrors the firmware's gating). */
export const CHIME_BITS = {
  session: 0,
  complete: 1,
  autoStart: 2,
  alerts: 3,
} as const;

export const DEFAULT_SETTINGS: AppSettings = {
  displayName: "",
  notificationsEnabled: true,
  hapticsEnabled: true,
  shareWithReviewers: false,
  reduceMotion: false,
  adaptiveCoachingEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  dailyGoalMin: 180,
  semesterLabel: null,
  semesterStart: null,
  semesterEnd: null,
  studyPlanMode: "balanced",
  planDayStart: "09:00",
  planDayEnd: "21:00",
  planDailyCapMin: null,
  deviceSoundEnabled: true,
  deviceSoundLevel: 1,
  deviceChimeMask: 15,
  autoStartScheduled: true,
  deviceThemeId: 0,
  deviceFocusMin: 25,
  deviceBreakMin: 5,
  deviceLongBreakMin: 15,
  deviceCycles: 4,
  examMode: false,
};

/** Postgres `time` comes back as "HH:MM:SS"; the <input type="time"> wants "HH:MM". */
function toInputTime(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 4) return null;
  return value.slice(0, 5);
}

async function fetchSettings(): Promise<AppSettings> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return DEFAULT_SETTINGS;

  const [settingsRes, profileRes] = await Promise.all([
    supabase
      .from("user_settings")
      .select(
        "notifications_enabled, haptics_enabled, share_with_reviewers, reduce_motion, adaptive_coaching_enabled, quiet_hours_start, quiet_hours_end, semester_label, semester_start, semester_end, study_plan_mode, plan_day_start, plan_day_end, plan_daily_cap_min, device_sound_enabled, device_sound_level, device_chime_mask, auto_start_scheduled, device_theme_id, device_focus_min, device_break_min, device_long_break_min, device_cycles, exam_mode",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("profiles")
      .select("daily_goal_min, display_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  if (settingsRes.error) throw new Error(settingsRes.error.message);
  if (profileRes.error) throw new Error(profileRes.error.message);

  const s = (settingsRes.data ?? {}) as Record<string, unknown>;
  const p = (profileRes.data ?? {}) as Record<string, unknown>;

  return {
    displayName: String(p.display_name ?? DEFAULT_SETTINGS.displayName),
    notificationsEnabled: Boolean(s.notifications_enabled ?? DEFAULT_SETTINGS.notificationsEnabled),
    hapticsEnabled: Boolean(s.haptics_enabled ?? DEFAULT_SETTINGS.hapticsEnabled),
    shareWithReviewers: Boolean(s.share_with_reviewers ?? DEFAULT_SETTINGS.shareWithReviewers),
    reduceMotion: Boolean(s.reduce_motion ?? DEFAULT_SETTINGS.reduceMotion),
    adaptiveCoachingEnabled: Boolean(
      s.adaptive_coaching_enabled ?? DEFAULT_SETTINGS.adaptiveCoachingEnabled,
    ),
    quietHoursStart: toInputTime(s.quiet_hours_start),
    quietHoursEnd: toInputTime(s.quiet_hours_end),
    dailyGoalMin: Number(p.daily_goal_min ?? DEFAULT_SETTINGS.dailyGoalMin),
    semesterLabel: typeof s.semester_label === "string" ? s.semester_label : null,
    semesterStart: typeof s.semester_start === "string" ? s.semester_start.slice(0, 10) : null,
    semesterEnd: typeof s.semester_end === "string" ? s.semester_end.slice(0, 10) : null,
    studyPlanMode:
      s.study_plan_mode === "deep_focus" || s.study_plan_mode === "sprint"
        ? s.study_plan_mode
        : DEFAULT_SETTINGS.studyPlanMode,
    planDayStart: toInputTime(s.plan_day_start) ?? DEFAULT_SETTINGS.planDayStart,
    planDayEnd: toInputTime(s.plan_day_end) ?? DEFAULT_SETTINGS.planDayEnd,
    planDailyCapMin: s.plan_daily_cap_min == null ? null : Number(s.plan_daily_cap_min),
    deviceSoundEnabled: Boolean(s.device_sound_enabled ?? DEFAULT_SETTINGS.deviceSoundEnabled),
    deviceSoundLevel:
      s.device_sound_level === 0 || s.device_sound_level === 2
        ? s.device_sound_level
        : DEFAULT_SETTINGS.deviceSoundLevel,
    deviceChimeMask:
      s.device_chime_mask == null
        ? DEFAULT_SETTINGS.deviceChimeMask
        : Math.max(0, Math.min(15, Number(s.device_chime_mask))),
    autoStartScheduled: Boolean(s.auto_start_scheduled ?? DEFAULT_SETTINGS.autoStartScheduled),
    // Theme id range mirrors features/device/theme-presets (and the 0025 check).
    deviceThemeId:
      typeof s.device_theme_id === "number"
        ? Math.max(0, Math.min(4, Math.round(s.device_theme_id)))
        : DEFAULT_SETTINGS.deviceThemeId,
    deviceFocusMin:
      typeof s.device_focus_min === "number" ? s.device_focus_min : DEFAULT_SETTINGS.deviceFocusMin,
    deviceBreakMin:
      typeof s.device_break_min === "number" ? s.device_break_min : DEFAULT_SETTINGS.deviceBreakMin,
    deviceLongBreakMin:
      typeof s.device_long_break_min === "number"
        ? s.device_long_break_min
        : DEFAULT_SETTINGS.deviceLongBreakMin,
    deviceCycles:
      typeof s.device_cycles === "number" ? s.device_cycles : DEFAULT_SETTINGS.deviceCycles,
    examMode: Boolean(s.exam_mode ?? DEFAULT_SETTINGS.examMode),
  };
}

async function saveSettings(next: AppSettings): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in to change settings.");

  const goal = Math.min(
    1440,
    Math.max(15, Math.round(next.dailyGoalMin) || DEFAULT_SETTINGS.dailyGoalMin),
  );

  // Null = "use the mode default"; otherwise clamp to a sane per-day range.
  const planCap =
    next.planDailyCapMin == null || !Number.isFinite(next.planDailyCapMin)
      ? null
      : Math.min(600, Math.max(30, Math.round(next.planDailyCapMin)));

  const focusMin = Math.min(
    120,
    Math.max(5, Math.round(next.deviceFocusMin) || DEFAULT_SETTINGS.deviceFocusMin),
  );
  const breakMin = Math.min(
    60,
    Math.max(1, Math.round(next.deviceBreakMin) || DEFAULT_SETTINGS.deviceBreakMin),
  );
  const longBreakMin = Math.min(
    60,
    Math.max(1, Math.round(next.deviceLongBreakMin) || DEFAULT_SETTINGS.deviceLongBreakMin),
  );
  const cycles = Math.min(
    8,
    Math.max(1, Math.round(next.deviceCycles) || DEFAULT_SETTINGS.deviceCycles),
  );

  // Timing revision: stamp device_timing_updated_at ONLY when the pomodoro
  // rhythm (focus/break/long-break/cycles) actually changed. The box adopts
  // the values once per revision, so an unrelated settings save must not
  // re-stomp an on-box spinner edit.
  const { data: prevRow, error: prevError } = await supabase
    .from("user_settings")
    .select("device_focus_min, device_break_min, device_long_break_min, device_cycles")
    .eq("user_id", user.id)
    .maybeSingle();
  if (prevError) throw new Error(prevError.message);
  const prev = prevRow as {
    device_focus_min?: number;
    device_break_min?: number;
    device_long_break_min?: number;
    device_cycles?: number;
  } | null;
  // First-ever save with untouched defaults must NOT stamp — timingRev 0 means
  // "site never set timing" and the box keeps its local rhythm.
  const timingChanged = prev
    ? Number(prev.device_focus_min) !== focusMin ||
      Number(prev.device_break_min) !== breakMin ||
      Number(prev.device_long_break_min) !== longBreakMin ||
      Number(prev.device_cycles) !== cycles
    : focusMin !== DEFAULT_SETTINGS.deviceFocusMin ||
      breakMin !== DEFAULT_SETTINGS.deviceBreakMin ||
      longBreakMin !== DEFAULT_SETTINGS.deviceLongBreakMin ||
      cycles !== DEFAULT_SETTINGS.deviceCycles;

  const { error: settingsError } = await supabase.from("user_settings").upsert(
    {
      user_id: user.id,
      notifications_enabled: next.notificationsEnabled,
      haptics_enabled: next.hapticsEnabled,
      share_with_reviewers: next.shareWithReviewers,
      reduce_motion: next.reduceMotion,
      adaptive_coaching_enabled: next.adaptiveCoachingEnabled,
      quiet_hours_start: next.quietHoursStart || null,
      quiet_hours_end: next.quietHoursEnd || null,
      semester_label: next.semesterLabel?.trim() || null,
      semester_start: next.semesterStart || null,
      semester_end: next.semesterEnd || null,
      study_plan_mode: next.studyPlanMode,
      plan_day_start: next.planDayStart || DEFAULT_SETTINGS.planDayStart,
      plan_day_end: next.planDayEnd || DEFAULT_SETTINGS.planDayEnd,
      plan_daily_cap_min: planCap,
      device_sound_enabled: next.deviceSoundEnabled,
      device_sound_level: next.deviceSoundLevel,
      device_chime_mask: Math.max(0, Math.min(15, Math.round(next.deviceChimeMask))),
      auto_start_scheduled: next.autoStartScheduled,
      device_theme_id: Math.max(0, Math.min(4, Math.round(next.deviceThemeId) || 0)),
      device_focus_min: focusMin,
      device_break_min: breakMin,
      device_long_break_min: longBreakMin,
      device_cycles: cycles,
      exam_mode: next.examMode,
      ...(timingChanged ? { device_timing_updated_at: new Date().toISOString() } : {}),
    },
    { onConflict: "user_id" },
  );
  if (settingsError) throw new Error(settingsError.message);

  const name = next.displayName.trim();
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      daily_goal_min: goal,
      display_name: name || null,
    })
    .eq("id", user.id);
  if (profileError) throw new Error(profileError.message);
}

export function useSettings() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["user-settings", user?.id],
    queryFn: fetchSettings,
    enabled: !!user,
  });
}

export function useSaveSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["user-settings", user?.id] });
      void queryClient.invalidateQueries({ queryKey: ["daily-goal", user?.id] });
      void queryClient.invalidateQueries({ queryKey: ["leaderboard", user?.id] });
    },
  });
}
