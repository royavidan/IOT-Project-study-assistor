import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface SessionDetailMeta {
  id: string;
  userId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  mode: string;
  status: string;
  targetDurationSec: number;
  actualFocusSec: number;
  breaks: number;
  presenceInterruptions: number;
  focusLoadAvg: number;
  noiseAvg: number | null;
  tempC: number | null;
  lightLux: number | null;
}

/** One row per timestamp, merging the focus-load + environment samples. */
export interface SessionTimePoint {
  tMin: number;
  focus: number | null;
  noise: number | null;
  tempC: number | null;
  lightLux: number | null;
}

export interface SessionDetail {
  meta: SessionDetailMeta;
  series: SessionTimePoint[];
}

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchSessionDetail(id: string): Promise<SessionDetail> {
  const supabase = getSupabaseBrowserClient();

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select(
      "id, user_id, started_at, ended_at, mode, status, target_duration_sec, actual_focus_sec, breaks, presence_interruptions, focus_load_avg, noise_avg, temp_c, light_lux",
    )
    .eq("id", id)
    .maybeSingle();

  if (sessionError) throw new Error(sessionError.message);
  if (!session) throw new Error("Session not found (or you don't have access to it).");

  const [focusRes, envRes] = await Promise.all([
    supabase
      .from("focus_load_samples")
      .select("t_sec, value")
      .eq("session_id", id)
      .order("t_sec", { ascending: true }),
    supabase
      .from("env_samples")
      .select("t_sec, noise, temp_c, light_lux")
      .eq("session_id", id)
      .order("t_sec", { ascending: true }),
  ]);

  if (focusRes.error) throw new Error(focusRes.error.message);
  if (envRes.error) throw new Error(envRes.error.message);

  // Merge both sample sets onto a shared time axis (minutes since start).
  const byMin = new Map<number, SessionTimePoint>();
  const point = (tSec: number): SessionTimePoint => {
    const tMin = Math.round(tSec / 60);
    let p = byMin.get(tMin);
    if (!p) {
      p = { tMin, focus: null, noise: null, tempC: null, lightLux: null };
      byMin.set(tMin, p);
    }
    return p;
  };

  for (const row of (focusRes.data ?? []) as Record<string, unknown>[]) {
    point(Number(row.t_sec ?? 0)).focus = num(row.value);
  }
  for (const row of (envRes.data ?? []) as Record<string, unknown>[]) {
    const p = point(Number(row.t_sec ?? 0));
    p.noise = num(row.noise);
    p.tempC = num(row.temp_c);
    p.lightLux = num(row.light_lux);
  }

  const series = [...byMin.values()].sort((a, b) => a.tMin - b.tMin);
  const s = session as Record<string, unknown>;

  return {
    meta: {
      id: String(s.id),
      userId: s.user_id ? String(s.user_id) : null,
      startedAt: s.started_at ? String(s.started_at) : null,
      endedAt: s.ended_at ? String(s.ended_at) : null,
      mode: String(s.mode ?? "Study"),
      status: String(s.status ?? "completed"),
      targetDurationSec: Number(s.target_duration_sec ?? 0),
      actualFocusSec: Number(s.actual_focus_sec ?? 0),
      breaks: Number(s.breaks ?? 0),
      presenceInterruptions: Number(s.presence_interruptions ?? 0),
      focusLoadAvg: Number(s.focus_load_avg ?? 0),
      noiseAvg: num(s.noise_avg),
      tempC: num(s.temp_c),
      lightLux: num(s.light_lux),
    },
    series,
  };
}

export function useSessionDetail(id: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["session-detail", id, user?.id],
    queryFn: () => fetchSessionDetail(id),
    enabled: !!user && !!id,
  });
}
