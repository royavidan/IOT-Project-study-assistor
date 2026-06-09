import type { Session, SessionMode, SessionStatus } from "@/lib/types";

export interface EnvCorrelation {
  metric: "noise" | "temp" | "light";
  label: string;
  correlation: number | null;
  interpretation: string;
}

export interface IdealConditions {
  sessionCount: number;
  avgFocusScore: number;
  noiseAvg: number | null;
  tempC: number | null;
  lightLux: number | null;
  summary: string;
}

export interface TimeOfDaySlot {
  label: string;
  sessions: number;
  avgFocusScore: number;
  totalMinutes: number;
}

export interface ModeBreakdownRow {
  mode: SessionMode;
  count: number;
  avgFocusScore: number;
  totalMinutes: number;
}

export interface StatusBreakdownRow {
  status: SessionStatus;
  count: number;
  pct: number;
}

export interface SessionInsights {
  envCorrelations: EnvCorrelation[];
  idealConditions: IdealConditions | null;
  timeOfDay: TimeOfDaySlot[];
  bestTimeSlot: TimeOfDaySlot | null;
  modeBreakdown: ModeBreakdownRow[];
  statusBreakdown: StatusBreakdownRow[];
}

export interface EnvScatterPoint {
  id: string;
  noise: number;
  focusScore: number;
  label: string;
}

export interface HourlyHeatCell {
  hour: number;
  label: string;
  sessions: number;
  avgFocusScore: number;
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

/** One point per session for noise ↔ Focus Load Estimate scatter plots. */
export function computeEnvScatterPoints(sessions: Session[]): EnvScatterPoint[] {
  return withEnv(sessions)
    .filter((s) => s.noiseAvg != null)
    .map((s) => ({
      id: s.id,
      noise: Math.round((s.noiseAvg ?? 0) * 100) / 100,
      focusScore: s.focusScore,
      label: `${s.date} ${s.start}`,
    }));
}

/** Hourly focus intensity (0–100) for a time-of-day heatmap. */
export function computeHourlyHeatmap(sessions: Session[]): HourlyHeatCell[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    scores: [] as number[],
  }));

  for (const s of sessions) {
    const hour = Number.parseInt(s.start.split(":")[0] ?? "0", 10);
    if (hour >= 0 && hour < 24) {
      buckets[hour].scores.push(s.focusScore);
    }
  }

  const maxScore = Math.max(
    1,
    ...buckets.filter((b) => b.scores.length > 0).map((b) => avg(b.scores) ?? 0),
  );

  return buckets.map(({ hour, scores }) => {
    const avgScore = scores.length ? Math.round(avg(scores) ?? 0) : 0;
    return {
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      sessions: scores.length,
      avgFocusScore: avgScore,
      intensity: scores.length ? Math.round((avgScore / maxScore) * 100) : 0,
    };
  });
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
      headline: "Unlock workspace insights",
      detail: `Log ${3 - total} more session${3 - total === 1 ? "" : "s"} to see when and where you focus best.`,
    };
  }

  if (envCount < 3) {
    return {
      ready: false,
      envSessionCount: envCount,
      totalSessions: total,
      bestTimeLabel: null,
      headline: "Add environment readings",
      detail:
        "Use the simulator’s environment sensors or sync from your MindBox so we can correlate noise, light, and temperature with your focus.",
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
      detail: "Open Insights to explore correlations and ideal workspace conditions.",
    };
  }

  const shortLabel = best.label.split(" (")[0] ?? best.label;

  return {
    ready: true,
    envSessionCount: envCount,
    totalSessions: total,
    bestTimeLabel: best.label,
    headline: `Your best focus window: ${shortLabel}`,
    detail: `Avg Focus Load Est. ${best.avgFocusScore} across ${best.sessions} session${best.sessions === 1 ? "" : "s"} · ${insights.idealConditions?.summary ?? "See ideal workspace conditions in Insights."}`,
  };
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const mx = avg(xs)!;
  const my = avg(ys)!;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const vx = xs[i] - mx;
    const vy = ys[i] - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  const denom = Math.sqrt(dx * dy);
  if (denom === 0) return null;
  return num / denom;
}

function interpretCorrelation(metric: string, r: number | null): string {
  if (r == null) return `Not enough ${metric} data to estimate a trend.`;
  const abs = Math.abs(r);
  const dir = r > 0 ? "higher" : "lower";
  if (abs < 0.15)
    return `${metric} shows little relationship with your Focus Load Estimate in this range.`;
  if (abs < 0.35)
    return `Slightly ${dir} ${metric} tends to coincide with ${dir} estimated load (heuristic).`;
  return `Noticeably ${dir} ${metric} aligns with ${dir} Focus Load Estimates in your history.`;
}

function withEnv(sessions: Session[]): Session[] {
  return sessions.filter((s) => s.noiseAvg != null || s.tempC != null || s.lightLux != null);
}

function computeIdealConditions(sessions: Session[]): IdealConditions | null {
  const envSessions = withEnv(sessions);
  if (envSessions.length < 3) return null;

  const ranked = [...envSessions].sort((a, b) => b.focusScore - a.focusScore);
  const topCount = Math.max(1, Math.ceil(ranked.length * 0.25));
  const top = ranked.slice(0, topCount);

  const noiseAvg = avg(top.map((s) => s.noiseAvg!).filter((v) => v != null));
  const tempC = avg(top.map((s) => s.tempC!).filter((v) => v != null));
  const lightLux = avg(top.map((s) => s.lightLux!).filter((v) => v != null));
  const avgFocusScore = Math.round(avg(top.map((s) => s.focusScore)) ?? 0);

  const parts: string[] = [];
  if (noiseAvg != null) parts.push(`quieter noise (~${noiseAvg.toFixed(2)})`);
  if (tempC != null) parts.push(`~${tempC.toFixed(0)}°C`);
  if (lightLux != null) parts.push(`~${Math.round(lightLux)} lux`);

  return {
    sessionCount: top.length,
    avgFocusScore,
    noiseAvg: noiseAvg == null ? null : Math.round(noiseAvg * 100) / 100,
    tempC: tempC == null ? null : Math.round(tempC * 10) / 10,
    lightLux: lightLux == null ? null : Math.round(lightLux),
    summary:
      parts.length > 0
        ? `Your highest-scoring sessions often had ${parts.join(", ")}.`
        : "Your top sessions share similar environment readings.",
  };
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
      avgFocusScore: Math.round(avg(row.scores) ?? 0),
      totalMinutes: row.minutes,
    };
  });
}

const ALL_MODES: SessionMode[] = ["Deep Focus", "Study", "Reading", "Review"];
const ALL_STATUSES: SessionStatus[] = ["completed", "interrupted", "aborted"];

export function computeSessionInsights(sessions: Session[]): SessionInsights {
  const envSessions = withEnv(sessions);
  const scores = envSessions.map((s) => s.focusScore);

  const envCorrelations: EnvCorrelation[] = [
    {
      metric: "noise",
      label: "Ambient noise",
      correlation: pearson(
        envSessions.map((s) => s.noiseAvg ?? 0),
        scores,
      ),
      interpretation: interpretCorrelation(
        "noise",
        pearson(
          envSessions.map((s) => s.noiseAvg ?? 0),
          scores,
        ),
      ),
    },
    {
      metric: "temp",
      label: "Temperature",
      correlation: pearson(
        envSessions.filter((s) => s.tempC != null).map((s) => s.tempC!),
        envSessions.filter((s) => s.tempC != null).map((s) => s.focusScore),
      ),
      interpretation: interpretCorrelation(
        "temperature",
        pearson(
          envSessions.filter((s) => s.tempC != null).map((s) => s.tempC!),
          envSessions.filter((s) => s.tempC != null).map((s) => s.focusScore),
        ),
      ),
    },
    {
      metric: "light",
      label: "Lighting",
      correlation: pearson(
        envSessions.filter((s) => s.lightLux != null).map((s) => s.lightLux!),
        envSessions.filter((s) => s.lightLux != null).map((s) => s.focusScore),
      ),
      interpretation: interpretCorrelation(
        "light",
        pearson(
          envSessions.filter((s) => s.lightLux != null).map((s) => s.lightLux!),
          envSessions.filter((s) => s.lightLux != null).map((s) => s.focusScore),
        ),
      ),
    },
  ];

  const timeOfDay = computeTimeOfDay(sessions);
  const bestTimeSlot =
    timeOfDay.length === 0
      ? null
      : [...timeOfDay].sort((a, b) => b.avgFocusScore - a.avgFocusScore)[0];

  const modeBreakdown = ALL_MODES.map((mode) => {
    const rows = sessions.filter((s) => s.mode === mode);
    return {
      mode,
      count: rows.length,
      avgFocusScore: rows.length ? Math.round(avg(rows.map((s) => s.focusScore)) ?? 0) : 0,
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

  return {
    envCorrelations,
    idealConditions: computeIdealConditions(sessions),
    timeOfDay,
    bestTimeSlot,
    modeBreakdown,
    statusBreakdown,
  };
}
