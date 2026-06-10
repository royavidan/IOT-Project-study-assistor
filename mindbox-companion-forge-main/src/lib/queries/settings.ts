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
}

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
        "notifications_enabled, haptics_enabled, share_with_reviewers, reduce_motion, adaptive_coaching_enabled, quiet_hours_start, quiet_hours_end, semester_label, semester_start, semester_end",
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
