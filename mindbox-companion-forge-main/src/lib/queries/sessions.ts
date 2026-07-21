import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { parseDateKey, todayDateKey, toDateKey } from "@/lib/dates";
import { roomTempOrNull } from "@/lib/env-quality";
import { computeStreakFromDateKeys } from "@/lib/streak";
import { filterSessionsByUser } from "@/lib/session-scope";
import type {
  Companions,
  DailyAggregate,
  DeviceState,
  DeviceStatusSnapshot,
  Session,
  SessionMode,
  SessionStatus,
  TodayStats,
} from "@/lib/types";

const MODES: SessionMode[] = ["Deep Focus", "Study", "Reading", "Review", "Homework"];
const DEVICE_STATES: DeviceState[] = ["work", "break", "sync", "warning", "danger", "idle"];
const DEFAULT_GOAL_MIN = 180;

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function asMode(value: string): SessionMode {
  return MODES.includes(value as SessionMode) ? (value as SessionMode) : "Study";
}

function asCompanions(value: unknown): Companions {
  return value === "with_others" ? "with_others" : "solo";
}

function asStatus(value: string): SessionStatus {
  if (value === "completed" || value === "interrupted" || value === "aborted") {
    return value;
  }
  return "completed";
}

function asDeviceState(value: string | null | undefined): DeviceState {
  if (value && DEVICE_STATES.includes(value as DeviceState)) {
    return value as DeviceState;
  }
  return "idle";
}

function wifiLabel(rssi: number | null | undefined): string {
  if (rssi == null) return "Unknown";
  if (rssi >= -50) return "Strong";
  if (rssi >= -70) return "Fair";
  return "Weak";
}

function numOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapSession(row: Record<string, unknown>): Session {
  const started = new Date(String(row.started_at));
  const mode = String(row.mode ?? "Study");
  const actualSec = Number(row.actual_focus_sec ?? 0);

  return {
    id: String(row.id),
    date: toDateKey(started),
    start: `${pad(started.getHours())}:${pad(started.getMinutes())}`,
    durationMin: Math.max(1, Math.round(actualSec / 60)),
    mode: asMode(mode),
    status: asStatus(String(row.status ?? "completed")),
    focusScore: Number(row.focus_load_avg ?? 0),
    breaks: Number(row.breaks ?? 0),
    subject: mode,
    noiseAvg: numOrNull(row.noise_avg),
    tempC: roomTempOrNull(row.temp_c),
    lightLux: numOrNull(row.light_lux),
    presenceInterruptions: Number(row.presence_interruptions ?? 0),
    companions: asCompanions(row.companions),
    userId: row.user_id ? String(row.user_id) : undefined,
    endedAt: row.ended_at ? String(row.ended_at) : undefined,
    tiredness: numOrNull(row.tiredness),
    checkinAt: row.checkin_at ? String(row.checkin_at) : null,
  };
}

/** Client-side streak fallback (matches SQL via shared date-key algorithm). */
export function computeStreak(sessions: Session[]): number {
  return computeStreakFromDateKeys(sessions.map((s) => s.date));
}

async function fetchFocusStreak(userId: string | undefined): Promise<number | null> {
  if (!userId) return 0;
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_focus_streak", { p_user_id: userId });
  if (error) return null;
  return Number(data ?? 0);
}

export function dailyAggregates(sessions: Session[], from: string, to: string): DailyAggregate[] {
  const start = parseDateKey(from);
  const end = parseDateKey(to);
  const out: DailyAggregate[] = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = toDateKey(d);
    const day = sessions.filter((s) => s.date === key);
    const minutes = day.reduce((sum, s) => sum + s.durationMin, 0);
    const avgScore = day.length
      ? Math.round(day.reduce((sum, s) => sum + s.focusScore, 0) / day.length)
      : 0;
    out.push({ date: key, minutes, avgScore, sessions: day.length });
  }

  return out;
}

async function fetchSessions(): Promise<Session[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("sessions")
    .select(
      "id, user_id, started_at, ended_at, actual_focus_sec, mode, status, focus_load_avg, breaks, noise_avg, temp_c, light_lux, presence_interruptions, companions, tiredness, checkin_at",
    )
    .order("started_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapSession(row as Record<string, unknown>));
}

async function fetchDailyGoal(): Promise<number> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return DEFAULT_GOAL_MIN;

  const { data, error } = await supabase
    .from("profiles")
    .select("daily_goal_min")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Number(data?.daily_goal_min ?? DEFAULT_GOAL_MIN);
}

async function fetchDeviceStatus(): Promise<DeviceStatusSnapshot> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      state: "idle",
      battery: 0,
      wifi: "Unknown",
      sensorHealth: null,
      updatedAt: null,
      firmwareVersion: null,
      room: null,
    };
  }

  const { data: devices, error: devError } = await supabase
    .from("devices")
    .select("id")
    .eq("owner_user_id", user.id);

  if (devError) throw new Error(devError.message);
  const deviceIds = (devices ?? []).map((d) => String((d as { id: string }).id));
  if (deviceIds.length === 0) {
    return {
      state: "idle",
      battery: 0,
      wifi: "Unknown",
      sensorHealth: null,
      updatedAt: null,
      firmwareVersion: null,
      room: null,
    };
  }

  const { data: status, error: statusError } = await supabase
    .from("device_status")
    .select(
      "state, battery_pct, wifi_rssi, sensor_health, updated_at, temp_c, humidity_pct, light_lux, noise_db, firmware_version",
    )
    .in("device_id", deviceIds)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (statusError) throw new Error(statusError.message);
  if (!status) {
    return {
      state: "idle",
      battery: 0,
      wifi: "Unknown",
      sensorHealth: null,
      updatedAt: null,
      firmwareVersion: null,
      room: null,
    };
  }

  const row = status as Record<string, unknown>;
  const health = row.sensor_health;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const room = {
    tempC: num(row.temp_c),
    humidityPct: num(row.humidity_pct),
    lightLux: num(row.light_lux),
    noiseDb: num(row.noise_db),
  };
  return {
    state: asDeviceState(String(row.state ?? "idle")),
    battery: Number(row.battery_pct ?? 0),
    wifi: wifiLabel(Number(row.wifi_rssi)),
    sensorHealth:
      health && typeof health === "object" && !Array.isArray(health)
        ? (health as Record<string, unknown>)
        : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    firmwareVersion: row.firmware_version ? String(row.firmware_version) : null,
    room: Object.values(room).some((v) => v != null) ? room : null,
  };
}

function buildTodayStats(
  sessions: Session[],
  goalMinutes: number,
  device: DeviceStatusSnapshot,
  streak: number,
): TodayStats {
  const today = todayDateKey();
  const todaySessions = sessions.filter((s) => s.date === today);
  const focusMinutes = todaySessions.reduce((sum, s) => sum + s.durationMin, 0);

  return {
    focusMinutes,
    goalMinutes,
    sessions: todaySessions.length,
    streak,
    deviceState: device.state,
    battery: device.battery,
    wifi: device.wifi,
  };
}

export function useSessions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["sessions", user?.id],
    queryFn: fetchSessions,
    enabled: !!user,
  });
}

export function useDeviceStatus() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["device-status", user?.id],
    queryFn: fetchDeviceStatus,
    enabled: !!user,
    refetchInterval: 10_000,
  });
}

export function useTodayStats() {
  const { user } = useAuth();
  const sessionsQuery = useSessions();
  const deviceQuery = useDeviceStatus();
  const goalQuery = useQuery({
    queryKey: ["daily-goal", user?.id],
    queryFn: fetchDailyGoal,
    enabled: !!user,
  });
  const streakQuery = useQuery({
    queryKey: ["focus-streak", user?.id],
    queryFn: () => fetchFocusStreak(user?.id),
    enabled: !!user,
  });

  const stats = useMemo(() => {
    if (!sessionsQuery.data || !deviceQuery.data || goalQuery.data == null || !user?.id) {
      return null;
    }
    const ownSessions = filterSessionsByUser(sessionsQuery.data, user.id, user.id);
    const streak =
      streakQuery.data != null
        ? streakQuery.data
        : computeStreakFromDateKeys(ownSessions.map((s) => s.date));
    return buildTodayStats(ownSessions, goalQuery.data, deviceQuery.data, streak);
  }, [sessionsQuery.data, deviceQuery.data, goalQuery.data, streakQuery.data, user?.id]);

  return {
    data: stats,
    isLoading:
      sessionsQuery.isLoading ||
      deviceQuery.isLoading ||
      goalQuery.isLoading ||
      streakQuery.isLoading,
    isError:
      sessionsQuery.isError || deviceQuery.isError || goalQuery.isError || streakQuery.isError,
    error: sessionsQuery.error ?? deviceQuery.error ?? goalQuery.error ?? streakQuery.error,
    refetch: () => {
      void sessionsQuery.refetch();
      void deviceQuery.refetch();
      void goalQuery.refetch();
      void streakQuery.refetch();
    },
  };
}

export function useDailyAggregates(from: string, to: string, scopeUserId?: string) {
  const { user } = useAuth();
  const targetId = scopeUserId ?? user?.id;
  const sessionsQuery = useSessions();
  const scoped = useMemo(
    () => filterSessionsByUser(sessionsQuery.data ?? [], targetId, user?.id),
    [sessionsQuery.data, targetId, user?.id],
  );

  const streakQuery = useQuery({
    queryKey: ["focus-streak", targetId],
    queryFn: () => fetchFocusStreak(targetId),
    enabled: !!targetId,
  });

  const daily = useMemo(
    () => (scoped.length ? dailyAggregates(scoped, from, to) : []),
    [scoped, from, to],
  );

  const streak =
    streakQuery.data != null
      ? streakQuery.data
      : computeStreakFromDateKeys(scoped.map((s) => s.date));

  return {
    daily,
    streak,
    scopedSessions: scoped,
    isLoading: sessionsQuery.isLoading || streakQuery.isLoading,
    isError: sessionsQuery.isError || streakQuery.isError,
    error: sessionsQuery.error ?? streakQuery.error,
    refetch: () => {
      void sessionsQuery.refetch();
      void streakQuery.refetch();
    },
  };
}

export { toDateKey } from "@/lib/dates";
