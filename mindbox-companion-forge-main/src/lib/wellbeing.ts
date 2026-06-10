// Wellbeing pattern estimators.
//
// IMPORTANT — read before changing the copy or thresholds:
// These are *behavioral pattern* estimates derived from session timing and
// load. They are NOT clinical or diagnostic measures of fatigue, brain fog,
// burnout, or mental health, and must never be labeled as such in the UI
// (same design rule as the Focus Load Estimate, Story 10). Each signal is a
// transparent heuristic with the data it used shown to the user.
//
// Why these three (and what they're grounded in):
//  - Recovery balance: the effort–recovery model (Meijman & Mulder, 1998) and
//    Job Demands–Resources model (Demerouti et al., 2001) — sustained demand
//    without recovery (rest days, sleep) is the behavioral risk pattern behind
//    burnout. We surface load-vs-recovery, never a "burnout score".
//  - Circadian alignment: time-of-day affects cognition (Schmidt et al., 2007),
//    and late-night work displaces sleep, which degrades attention. We reward
//    using stronger windows and flag heavy late-night load.
//  - Routine consistency: schedule/sleep-timing regularity is linked to better
//    outcomes in students (Phillips et al., 2017, "Irregular sleep/wake
//    patterns are associated with poorer academic performance", Sci. Reports).
//    We measure how regular the daily start time and cadence are.
//
// All scores are 0..100 where HIGHER = healthier pattern, so a fuller bar always
// reads as "better". Confidence scales with how much data backs the estimate.

import type { Session } from "@/lib/types";
import { parseDateKey, toDateKey } from "@/lib/dates";

export type Confidence = "low" | "medium" | "high";

/** An external commitment that adds to overall load (factored into Recovery balance). */
export interface ExternalLoadEntry {
  id?: string;
  label: string;
  kind: "weekly" | "dated";
  /** Hours of load. Weekly = hours per week; dated = hours on that date. */
  hours: number;
  /** YYYY-MM-DD — required when kind is "dated". */
  date?: string | null;
}

interface WellbeingBase {
  /** False when there isn't enough data to say anything responsibly. */
  ready: boolean;
  /** 0..100, higher = healthier behavioral pattern. */
  score: number;
  confidence: Confidence;
  headline: string;
  detail: string;
  /** One concrete, gentle action. Empty string when not ready. */
  suggestion: string;
  /** The raw inputs behind the estimate, shown to the user for transparency. */
  factors: { label: string; value: string }[];
}

export interface RecoveryBalance extends WellbeingBase {
  status: "balanced" | "moderate" | "strained";
}

export interface CircadianAlignment extends WellbeingBase {
  status: "aligned" | "mixed" | "misaligned";
  bestWindow: string | null;
}

export interface RoutineConsistency extends WellbeingBase {
  status: "steady" | "variable" | "irregular";
  typicalStart: string | null;
}

export interface WellbeingReport {
  /** True when at least one signal has enough data. */
  ready: boolean;
  sessionCount: number;
  recovery: RecoveryBalance;
  circadian: CircadianAlignment;
  consistency: RoutineConsistency;
}

// --- shared helpers ---------------------------------------------------------

const RECOVERY_WINDOW_DAYS = 14;
const TWO_PI = Math.PI * 2;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round(n: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function hourOf(start: string): number {
  return Number.parseInt(start.split(":")[0] ?? "0", 10);
}

function minutesOf(start: string): number {
  const [h, m] = start.split(":").map((x) => Number.parseInt(x, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** The typical human sleep window — studying here displaces sleep. */
function isLateNight(start: string): boolean {
  const h = hourOf(start);
  return h >= 22 || h < 6;
}

function formatClock(totalMin: number): string {
  const m = ((Math.round(totalMin) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function latestDateKey(sessions: Session[]): string | null {
  let max: string | null = null;
  for (const s of sessions) if (s.date && (!max || s.date > max)) max = s.date; // keys sort chronologically
  return max;
}

function earliestDateKey(sessions: Session[]): string | null {
  let min: string | null = null;
  for (const s of sessions) if (s.date && (!min || s.date < min)) min = s.date;
  return min;
}

function shiftKey(key: string, deltaDays: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + deltaDays);
  return toDateKey(d);
}

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((parseDateKey(toKey).getTime() - parseDateKey(fromKey).getTime()) / 86_400_000);
}

function distinctDays(sessions: Session[]): number {
  return new Set(sessions.map((s) => s.date)).size;
}

/**
 * Circular mean & standard deviation of clock times (minutes 0..1440), so that
 * 23:30 and 00:30 are treated as one hour apart, not 23. Mardia's circular SD.
 */
function circularStats(minutes: number[]): { meanMin: number; stdMin: number } {
  let c = 0;
  let s = 0;
  for (const m of minutes) {
    const a = (TWO_PI * m) / 1440;
    c += Math.cos(a);
    s += Math.sin(a);
  }
  const n = Math.max(1, minutes.length);
  c /= n;
  s /= n;
  const r = Math.min(1, Math.sqrt(c * c + s * s));
  let meanAngle = Math.atan2(s, c);
  if (meanAngle < 0) meanAngle += TWO_PI;
  const meanMin = (meanAngle / TWO_PI) * 1440;
  const stdRad = Math.sqrt(-2 * Math.log(Math.max(r, 1e-6)));
  const stdMin = (stdRad / TWO_PI) * 1440;
  return { meanMin, stdMin };
}

function firstStartPerDay(sessions: Session[]): number[] {
  const byDay = new Map<string, number>();
  for (const s of sessions) {
    const m = minutesOf(s.start);
    const cur = byDay.get(s.date);
    if (cur == null || m < cur) byDay.set(s.date, m);
  }
  return [...byDay.values()];
}

// --- 1. Recovery balance ----------------------------------------------------

function recoveryNotReady(): RecoveryBalance {
  return {
    ready: false,
    score: 0,
    status: "moderate",
    confidence: "low",
    headline: "Not enough recent activity",
    detail: "Log sessions across several days to estimate your load-vs-recovery balance.",
    suggestion: "",
    factors: [],
  };
}

function computeRecoveryBalance(
  sessions: Session[],
  anchorKey: string,
  externalLoad: ExternalLoadEntry[],
): RecoveryBalance {
  const recentStart = shiftKey(anchorKey, -(RECOVERY_WINDOW_DAYS - 1));
  const recent = sessions.filter((s) => s.date >= recentStart && s.date <= anchorKey);

  // Readiness is gated on session data — external load alone can't power it.
  const sessionActiveDays = distinctDays(recent);
  if (recent.length < 4 || sessionActiveDays < 3) return recoveryNotReady();

  // Window span is capped to the data we actually have, so a user with 5 days
  // of history isn't credited 9 phantom "rest" days.
  const firstRecent = earliestDateKey(recent)!;
  const windowSpanDays = Math.max(1, daysBetween(firstRecent, anchorKey) + 1);

  // External commitments (lectures, labs, etc.): weekly recurring + dated.
  const weeklyHours = externalLoad
    .filter((e) => e.kind === "weekly")
    .reduce((sum, e) => sum + Math.max(0, e.hours), 0);
  const datedInWindow = externalLoad.filter(
    (e) => e.kind === "dated" && e.date && e.date >= recentStart && e.date <= anchorKey,
  );
  const externalRecentMin =
    weeklyHours * 60 * (windowSpanDays / 7) +
    datedInWindow.reduce((sum, e) => sum + Math.max(0, e.hours), 0) * 60;

  // A day with a dated commitment isn't a "rest" day.
  const activeDayKeys = new Set(recent.map((s) => s.date));
  for (const e of datedInWindow) if (e.date) activeDayKeys.add(e.date);
  const activeDaysRecent = activeDayKeys.size;
  const restDays = Math.max(0, windowSpanDays - activeDaysRecent);
  const restDayRatio = restDays / windowSpanDays;

  const recentMinutes = recent.reduce((sum, s) => sum + s.durationMin, 0);
  const lateMinutes = recent
    .filter((s) => isLateNight(s.start))
    .reduce((sum, s) => sum + s.durationMin, 0);
  const lateShare = recentMinutes > 0 ? lateMinutes / recentMinutes : 0;

  // Compare per-day total load (study + commitments) against the prior 14 days.
  const priorEnd = shiftKey(recentStart, -1);
  const priorStart = shiftKey(priorEnd, -(RECOVERY_WINDOW_DAYS - 1));
  const prior = sessions.filter((s) => s.date >= priorStart && s.date <= priorEnd);
  let loadChangePct: number | null = null;
  if (prior.length >= 3) {
    const datedPriorMin =
      externalLoad
        .filter((e) => e.kind === "dated" && e.date && e.date >= priorStart && e.date <= priorEnd)
        .reduce((sum, e) => sum + Math.max(0, e.hours), 0) * 60;
    const externalPriorMin = weeklyHours * 60 * (RECOVERY_WINDOW_DAYS / 7) + datedPriorMin;
    const priorRate =
      (prior.reduce((sum, s) => sum + s.durationMin, 0) + externalPriorMin) / RECOVERY_WINDOW_DAYS;
    const recentRate = (recentMinutes + externalRecentMin) / windowSpanDays;
    if (priorRate > 0) loadChangePct = (recentRate - priorRate) / priorRate;
  }

  // Sub-scores (0..1, 1 = healthy). Recovery weighted highest: rest is the
  // single best-supported lever in the effort–recovery model.
  const recoveryScore = clamp01(restDayRatio / 0.14); // ~1 rest day per 7 → full credit
  const hoursScore = 1 - clamp01(lateShare / 0.5); // 50%+ late-night → 0
  const loadScore = loadChangePct == null ? 1 : 1 - clamp01((loadChangePct - 0.5) / 1.0);

  const score = round((0.5 * recoveryScore + 0.3 * hoursScore + 0.2 * loadScore) * 100);
  const status = score >= 70 ? "balanced" : score >= 45 ? "moderate" : "strained";

  const confidence: Confidence =
    recent.length >= 12 && windowSpanDays >= 14
      ? "high"
      : recent.length >= 6 && windowSpanDays >= 10
        ? "medium"
        : "low";

  const factors = [
    { label: "Rest days", value: `${restDays} of last ${windowSpanDays}` },
    { label: "Late-night load", value: `${round(lateShare * 100)}%` },
    {
      label: "Load vs. prior 2 wks",
      value:
        loadChangePct == null
          ? "—"
          : `${loadChangePct >= 0 ? "+" : ""}${round(loadChangePct * 100)}%`,
    },
  ];
  if (externalRecentMin > 0) {
    factors.push({
      label: "External load (in window)",
      value: `${round(externalRecentMin / 60)}h`,
    });
  }

  if (status === "balanced") {
    return {
      ready: true,
      score,
      status,
      confidence,
      headline: "Your load and recovery look sustainable",
      detail: `You took ${restDays} rest day${restDays === 1 ? "" : "s"} in the last ${windowSpanDays} and kept late-night work low.`,
      suggestion: "Keep the rhythm — steady effort with regular rest is what makes it stick.",
      factors,
    };
  }

  // Pick the weakest lever to drive the message.
  const weakest = Math.min(recoveryScore, hoursScore, loadScore);
  let headline: string;
  let detail: string;
  let suggestion: string;
  if (weakest === recoveryScore) {
    headline = restDays === 0 ? "No rest days recently" : "Little recovery time";
    detail = `You had activity on ${activeDaysRecent} of the last ${windowSpanDays} days with ${restDays} full rest day${restDays === 1 ? "" : "s"}.`;
    suggestion =
      "Schedule a lighter or off day this week — recovery is when learning consolidates.";
  } else if (weakest === hoursScore) {
    headline = "A lot of late-night studying";
    detail = `About ${round(lateShare * 100)}% of your focus time fell between 22:00 and 06:00.`;
    suggestion =
      "Move some of that work earlier — late-night sessions trade away the sleep that fuels focus.";
  } else {
    headline = "Your overall load jumped recently";
    detail = `Your daily load${externalRecentMin > 0 ? " (study + commitments)" : ""} is up ~${round((loadChangePct ?? 0) * 100)}% versus the prior two weeks.`;
    suggestion = "Ramp up gradually rather than all at once to keep the pace sustainable.";
  }

  return { ready: true, score, status, confidence, headline, detail, suggestion, factors };
}

// --- 2. Circadian alignment -------------------------------------------------

const BUCKETS: { label: string; test: (h: number) => boolean }[] = [
  { label: "Morning (6–12)", test: (h) => h >= 6 && h < 12 },
  { label: "Afternoon (12–17)", test: (h) => h >= 12 && h < 17 },
  { label: "Evening (17–22)", test: (h) => h >= 17 && h < 22 },
  { label: "Night (22–6)", test: (h) => h >= 22 || h < 6 },
];

function bucketLabel(start: string): string {
  const h = hourOf(start);
  return BUCKETS.find((b) => b.test(h))!.label;
}

function circadianNotReady(): CircadianAlignment {
  return {
    ready: false,
    score: 0,
    status: "mixed",
    bestWindow: null,
    confidence: "low",
    headline: "Not enough sessions yet",
    detail: "Log a handful of sessions so we can see when you focus best.",
    suggestion: "",
    factors: [],
  };
}

function computeCircadianAlignment(sessions: Session[]): CircadianAlignment {
  if (sessions.length < 5) return circadianNotReady();

  const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMin, 0);
  if (totalMinutes <= 0) return circadianNotReady();

  type Stat = { label: string; scores: number[]; minutes: number };
  const stats = new Map<string, Stat>();
  for (const s of sessions) {
    const label = bucketLabel(s.start);
    const row = stats.get(label) ?? { label, scores: [], minutes: 0 };
    row.scores.push(s.focusScore);
    row.minutes += s.durationMin;
    stats.set(label, row);
  }

  // A window is comparable once it has >= 2 sessions.
  const qualifying = [...stats.values()].filter((b) => b.scores.length >= 2);
  const best =
    qualifying.length > 0 ? [...qualifying].sort((a, b) => avg(b.scores) - avg(a.scores))[0] : null;

  const lateMinutes = sessions
    .filter((s) => isLateNight(s.start))
    .reduce((sum, s) => sum + s.durationMin, 0);
  const lateShare = lateMinutes / totalMinutes;
  const lateScore = 1 - clamp01(lateShare / 0.4); // 40%+ late-night → 0

  // Fit: share of minutes spent in at-or-above-median-scoring windows.
  let fitScore = 1;
  if (qualifying.length >= 2) {
    const sortedAvgs = qualifying.map((b) => avg(b.scores)).sort((a, b) => a - b);
    const median = sortedAvgs[Math.floor(sortedAvgs.length / 2)];
    const goodMinutes = qualifying
      .filter((b) => avg(b.scores) >= median)
      .reduce((sum, b) => sum + b.minutes, 0);
    const qualifyingMinutes = qualifying.reduce((sum, b) => sum + b.minutes, 0);
    fitScore = qualifyingMinutes > 0 ? goodMinutes / qualifyingMinutes : 1;
  }

  const score = round((0.7 * lateScore + 0.3 * fitScore) * 100);
  const status = score >= 70 ? "aligned" : score >= 40 ? "mixed" : "misaligned";

  // Delta between the best window and late-night sessions, when both exist.
  const lateScores = sessions.filter((s) => isLateNight(s.start)).map((s) => s.focusScore);
  const delta = best && lateScores.length >= 2 ? round(avg(best.scores) - avg(lateScores)) : null;

  const confidence: Confidence =
    sessions.length >= 16 && qualifying.length >= 3
      ? "high"
      : sessions.length >= 8 && qualifying.length >= 2
        ? "medium"
        : "low";

  const bestWindow = best?.label ?? null;
  const factors = [
    { label: "Best window", value: bestWindow ?? "—" },
    { label: "Late-night load", value: `${round(lateShare * 100)}%` },
    {
      label: "Best vs. late-night",
      value: delta == null ? "—" : `${delta >= 0 ? "+" : ""}${delta} pts`,
    },
  ];

  let headline: string;
  let detail: string;
  let suggestion: string;
  if (status === "aligned") {
    headline = bestWindow
      ? `You focus best in the ${shortWindow(bestWindow)}`
      : "Your timing looks healthy";
    detail =
      delta != null && delta > 0
        ? `Your best window scores about ${delta} points higher than your late-night sessions.`
        : "Most of your focus time lands in your stronger windows, with little late-night work.";
    suggestion = bestWindow
      ? `Protect the ${shortWindow(bestWindow).toLowerCase()} for your hardest work.`
      : "Keep heavy work out of the late-night hours.";
  } else {
    headline = "A lot of work fights your body clock";
    detail = `About ${round(lateShare * 100)}% of your focus time is between 22:00 and 06:00${
      delta != null && delta > 0 ? `, and it scores ~${delta} pts lower than your best window` : ""
    }.`;
    suggestion = bestWindow
      ? `Shift heavier work toward the ${shortWindow(bestWindow).toLowerCase()}; late-night studying costs you sleep and focus.`
      : "Shift heavier work out of the late-night hours; it costs you sleep and focus.";
  }

  return {
    ready: true,
    score,
    status,
    bestWindow,
    confidence,
    headline,
    detail,
    suggestion,
    factors,
  };
}

function shortWindow(label: string): string {
  return label.split(" (")[0] ?? label;
}

// --- 3. Routine consistency -------------------------------------------------

function consistencyNotReady(): RoutineConsistency {
  return {
    ready: false,
    score: 0,
    status: "variable",
    typicalStart: null,
    confidence: "low",
    headline: "Not enough days yet",
    detail: "Log sessions on several different days to estimate how regular your routine is.",
    suggestion: "",
    factors: [],
  };
}

function computeRoutineConsistency(sessions: Session[], anchorKey: string): RoutineConsistency {
  const active = distinctDays(sessions);
  if (sessions.length < 5 || active < 4) return consistencyNotReady();

  const anchorStarts = firstStartPerDay(sessions); // one "anchor" start time per day
  const { meanMin, stdMin } = circularStats(anchorStarts);

  const firstKey = earliestDateKey(sessions)!;
  const spanDays = Math.max(1, daysBetween(firstKey, anchorKey) + 1);
  const activeDayRatio = active / spanDays;

  // Regularity of the daily start time. <=45 min spread → very regular,
  // >=180 min → irregular.
  const timeScore = 1 - clamp01((stdMin - 45) / 135);
  // Cadence: studying ~4 days/week (≈0.57) earns full credit; daily isn't required.
  const cadenceScore = clamp01(activeDayRatio / 0.57);

  const score = round((0.6 * timeScore + 0.4 * cadenceScore) * 100);
  const status = score >= 70 ? "steady" : score >= 45 ? "variable" : "irregular";

  const confidence: Confidence =
    active >= 10 && spanDays >= 14 ? "high" : active >= 6 ? "medium" : "low";

  const typicalStart = formatClock(meanMin);
  const factors = [
    { label: "Typical start", value: typicalStart },
    { label: "Start-time spread", value: `±${round(stdMin)} min` },
    { label: "Active days", value: `${active} of ${spanDays}` },
  ];

  if (status === "steady") {
    return {
      ready: true,
      score,
      status,
      typicalStart,
      confidence,
      headline: `You usually start around ${typicalStart}`,
      detail: `You studied ${active} of the last ${spanDays} days at a fairly consistent time (±${round(stdMin)} min).`,
      suggestion: "A steady schedule supports sleep regularity and recall — keep it up.",
      factors,
    };
  }

  const headline =
    timeScore <= cadenceScore
      ? "Your study times swing day to day"
      : "Your study days are sporadic";
  const detail =
    timeScore <= cadenceScore
      ? `Your start time varies by about ±${round(stdMin)} minutes from day to day.`
      : `You studied on ${active} of the last ${spanDays} days, with gaps in between.`;
  const suggestion =
    "Anchoring study to a similar time each day tends to improve focus and sleep regularity.";

  return {
    ready: true,
    score,
    status,
    typicalStart,
    confidence,
    headline,
    detail,
    suggestion,
    factors,
  };
}

// --- top level --------------------------------------------------------------

/**
 * Behavioral wellbeing patterns over the provided sessions. Windows are anchored
 * to the most recent session in the input, so it adapts to whatever date range
 * the page is showing (and is deterministic for tests).
 */
export function computeWellbeing(
  sessions: Session[],
  externalLoad: ExternalLoadEntry[] = [],
): WellbeingReport {
  const anchor = latestDateKey(sessions);
  if (!anchor) {
    return {
      ready: false,
      sessionCount: 0,
      recovery: recoveryNotReady(),
      circadian: circadianNotReady(),
      consistency: consistencyNotReady(),
    };
  }

  const recovery = computeRecoveryBalance(sessions, anchor, externalLoad);
  const circadian = computeCircadianAlignment(sessions);
  const consistency = computeRoutineConsistency(sessions, anchor);

  return {
    ready: recovery.ready || circadian.ready || consistency.ready,
    sessionCount: sessions.length,
    recovery,
    circadian,
    consistency,
  };
}
