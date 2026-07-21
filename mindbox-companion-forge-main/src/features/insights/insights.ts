import type { Session, SessionMode, SessionStatus } from "@/lib/types";

// Focus analytics. IMPORTANT framing: `Session.focusScore` is the device's
// Focus *Load* Estimate (higher = more cognitive strain), NOT a "how good was
// this session" score. So we never rank "best" by it — "best time of day" and
// heatmap intensity are driven by focus MINUTES. Environmental quality lives in
// `@/lib/env-quality` (fixed research thresholds), not here (the old
// correlation-of-load-vs-noise approach was circular and has been retired).

export interface TimeOfDaySlot {
  label: string;
  sessions: number;
  /** Average Focus Load Estimate (strain) in this window. */
  avgLoad: number;
  totalMinutes: number;
}

export interface ModeBreakdownRow {
  mode: SessionMode;
  count: number;
  avgLoad: number;
  totalMinutes: number;
}

export interface StatusBreakdownRow {
  status: SessionStatus;
  count: number;
  pct: number;
}

export interface SessionInsights {
  timeOfDay: TimeOfDaySlot[];
  /** The time-of-day window with the most focus MINUTES (not lowest load). */
  bestTimeSlot: TimeOfDaySlot | null;
  modeBreakdown: ModeBreakdownRow[];
  statusBreakdown: StatusBreakdownRow[];
}

export interface HourlyHeatCell {
  hour: number;
  label: string;
  sessions: number;
  minutes: number;
  avgLoad: number;
  /** 0–100 relative to the busiest hour, by minutes studied. */
  intensity: number;
}

export interface DashboardInsightTeaser {
  ready: boolean;
  envSessionCount: number;
  totalSessions: number;
  bestTimeLabel: string | null;
  headline: string;
  detail: string;
}

export function sessionsWithEnvData(sessions: Session[]): Session[] {
  return withEnv(sessions);
}

export function countSessionsWithEnv(sessions: Session[]): number {
  return withEnv(sessions).length;
}

/** Hourly study intensity (0–100) for a time-of-day heatmap, by minutes studied. */
export function computeHourlyHeatmap(sessions: Session[]): HourlyHeatCell[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    scores: [] as number[],
    minutes: 0,
  }));

  for (const s of sessions) {
    const hour = Number.parseInt(s.start.split(":")[0] ?? "0", 10);
    if (hour >= 0 && hour < 24) {
      buckets[hour].scores.push(s.focusScore);
      buckets[hour].minutes += s.durationMin;
    }
  }

  const maxMinutes = Math.max(1, ...buckets.map((b) => b.minutes));

  return buckets.map(({ hour, scores, minutes }) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    sessions: scores.length,
    minutes,
    avgLoad: scores.length ? Math.round(avg(scores) ?? 0) : 0,
    intensity: minutes > 0 ? Math.round((minutes / maxMinutes) * 100) : 0,
  }));
}

/** Short copy for the dashboard insights teaser card. */
export function computeDashboardInsightTeaser(sessions: Session[]): DashboardInsightTeaser {
  const envCount = countSessionsWithEnv(sessions);
  const total = sessions.length;

  if (total < 3) {
    return {
      ready: false,
      envSessionCount: envCount,
      totalSessions: total,
      bestTimeLabel: null,
      headline: "Unlock focus insights",
      detail: `Log ${3 - total} more session${3 - total === 1 ? "" : "s"} to see when you focus most and how your workspace stacks up.`,
    };
  }

  const insights = computeSessionInsights(sessions);
  const best = insights.bestTimeSlot;

  if (!best) {
    return {
      ready: true,
      envSessionCount: envCount,
      totalSessions: total,
      bestTimeLabel: null,
      headline: "Your focus patterns are ready",
      detail: "Open Insights to see your best hours, workspace conditions, and study-time trends.",
    };
  }

  const shortLabel = best.label.split(" (")[0] ?? best.label;

  return {
    ready: true,
    envSessionCount: envCount,
    totalSessions: total,
    bestTimeLabel: best.label,
    headline: `You study most in the ${shortLabel}`,
    detail: `${best.totalMinutes} min across ${best.sessions} session${best.sessions === 1 ? "" : "s"}. Open Insights for workspace conditions and study-time trends.`,
  };
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function withEnv(sessions: Session[]): Session[] {
  return sessions.filter((s) => s.noiseAvg != null || s.tempC != null || s.lightLux != null);
}

function hourBucket(start: string): string {
  const h = Number.parseInt(start.split(":")[0] ?? "0", 10);
  if (h >= 6 && h < 12) return "Morning (6–12)";
  if (h >= 12 && h < 17) return "Afternoon (12–17)";
  if (h >= 17 && h < 22) return "Evening (17–22)";
  return "Night (22–6)";
}

const TIME_ORDER = ["Morning (6–12)", "Afternoon (12–17)", "Evening (17–22)", "Night (22–6)"];

function computeTimeOfDay(sessions: Session[]): TimeOfDaySlot[] {
  const buckets = new Map<string, { scores: number[]; minutes: number }>();
  for (const s of sessions) {
    const label = hourBucket(s.start);
    const row = buckets.get(label) ?? { scores: [], minutes: 0 };
    row.scores.push(s.focusScore);
    row.minutes += s.durationMin;
    buckets.set(label, row);
  }

  return TIME_ORDER.filter((label) => buckets.has(label)).map((label) => {
    const row = buckets.get(label)!;
    return {
      label,
      sessions: row.scores.length,
      avgLoad: Math.round(avg(row.scores) ?? 0),
      totalMinutes: row.minutes,
    };
  });
}

const ALL_MODES: SessionMode[] = ["Deep Focus", "Study", "Reading", "Review", "Homework"];
const ALL_STATUSES: SessionStatus[] = ["completed", "interrupted", "aborted"];

export function computeSessionInsights(sessions: Session[]): SessionInsights {
  const timeOfDay = computeTimeOfDay(sessions);
  // "Best" = where the user actually puts in the most focus time (minutes),
  // never the highest load. Ties broken by session count.
  const bestTimeSlot =
    timeOfDay.length === 0
      ? null
      : [...timeOfDay].sort(
          (a, b) => b.totalMinutes - a.totalMinutes || b.sessions - a.sessions,
        )[0];

  const modeBreakdown = ALL_MODES.map((mode) => {
    const rows = sessions.filter((s) => s.mode === mode);
    return {
      mode,
      count: rows.length,
      avgLoad: rows.length ? Math.round(avg(rows.map((s) => s.focusScore)) ?? 0) : 0,
      totalMinutes: rows.reduce((sum, s) => sum + s.durationMin, 0),
    };
  }).filter((r) => r.count > 0);

  const statusBreakdown = ALL_STATUSES.map((status) => {
    const count = sessions.filter((s) => s.status === status).length;
    return {
      status,
      count,
      pct: sessions.length ? Math.round((count / sessions.length) * 100) : 0,
    };
  }).filter((r) => r.count > 0);

  return { timeOfDay, bestTimeSlot, modeBreakdown, statusBreakdown };
}
