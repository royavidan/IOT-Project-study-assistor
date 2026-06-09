export type DeviceState = "work" | "break" | "sync" | "warning" | "danger" | "idle";
export type SessionMode = "Deep Focus" | "Study" | "Reading" | "Review";
export type SessionStatus = "completed" | "interrupted" | "aborted";

export interface Session {
  id: string;
  date: string;        // YYYY-MM-DD
  start: string;       // HH:MM
  durationMin: number;
  mode: SessionMode;
  status: SessionStatus;
  focusScore: number;  // 0-100
  breaks: number;
  subject: string;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  minutes: number;
  streak: number;
  you?: boolean;
}

export interface Reviewer {
  id: string;
  name: string;
  email: string;
  role: "Parent" | "Tutor" | "Mentor";
  status: "active" | "pending";
}

// --- Deterministic PRNG so mock data is stable across renders ---
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const subjects = ["Calculus", "History", "Physics", "Reading", "Spanish", "Biology", "Essay", "Chem"];
const modes: SessionMode[] = ["Deep Focus", "Study", "Reading", "Review"];

function pad(n: number) { return n.toString().padStart(2, "0"); }
function fmtDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function buildSessions(): Session[] {
  const rand = mulberry32(20260609);
  const out: Session[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 30-day window ending today
  for (let i = 29; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);

    // Skip a few days entirely (rest days) — but never the most recent 2
    const skip = i > 2 && rand() < 0.18;
    if (skip) continue;

    const sessionsToday = 1 + Math.floor(rand() * 3); // 1-3 sessions
    let hour = 8 + Math.floor(rand() * 3);
    for (let s = 0; s < sessionsToday; s++) {
      const min = Math.floor(rand() * 60);
      const duration = 25 + Math.floor(rand() * 75); // 25-100 min
      const score = 55 + Math.floor(rand() * 45);
      const breaks = Math.floor(duration / 50);
      const status: SessionStatus = rand() < 0.85 ? "completed" : rand() < 0.6 ? "interrupted" : "aborted";
      out.push({
        id: `s-${i}-${s}`,
        date: fmtDate(day),
        start: `${pad(hour)}:${pad(min)}`,
        durationMin: duration,
        mode: modes[Math.floor(rand() * modes.length)],
        status,
        focusScore: score,
        breaks,
        subject: subjects[Math.floor(rand() * subjects.length)],
      });
      hour += 1 + Math.floor(rand() * 3);
      if (hour > 21) break;
    }
  }
  // newest first
  return out.sort((a, b) => (a.date === b.date ? b.start.localeCompare(a.start) : b.date.localeCompare(a.date)));
}

export const mockSessions: Session[] = buildSessions();

// --- Derived helpers ---
export function todayKey() {
  const d = new Date(); d.setHours(0,0,0,0);
  return fmtDate(d);
}

export function sessionsOn(date: string) {
  return mockSessions.filter((s) => s.date === date);
}

export function minutesOn(date: string) {
  return sessionsOn(date).reduce((sum, s) => sum + s.durationMin, 0);
}

/** Streak = consecutive days (ending today or yesterday) with at least one session.
 *  Resets when a day passes with no logged session. */
export function computeStreak(): number {
  const days = new Set(mockSessions.map((s) => s.date));
  let streak = 0;
  const d = new Date(); d.setHours(0,0,0,0);
  // allow today to be empty; start from yesterday if today empty
  if (!days.has(fmtDate(d))) d.setDate(d.getDate() - 1);
  while (days.has(fmtDate(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/** Daily aggregates for charts within an inclusive date range. */
export function dailyAggregates(from: string, to: string) {
  const start = new Date(from);
  const end = new Date(to);
  const out: { date: string; minutes: number; avgScore: number; sessions: number }[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = fmtDate(d);
    const day = sessionsOn(key);
    const minutes = day.reduce((s, x) => s + x.durationMin, 0);
    const avg = day.length ? Math.round(day.reduce((s, x) => s + x.focusScore, 0) / day.length) : 0;
    out.push({ date: key, minutes, avgScore: avg, sessions: day.length });
  }
  return out;
}

export const mockLeaderboard: LeaderboardEntry[] = [
  { rank: 1, name: "Ava P.", minutes: 1240, streak: 14 },
  { rank: 2, name: "Marcus T.", minutes: 1180, streak: 9 },
  { rank: 3, name: "You", minutes: 1050, streak: computeStreak(), you: true },
  { rank: 4, name: "Lena S.", minutes: 980, streak: 6 },
  { rank: 5, name: "Devon R.", minutes: 870, streak: 4 },
];

export const mockReviewers: Reviewer[] = [
  { id: "r1", name: "Sarah Kim", email: "sarah@example.com", role: "Parent", status: "active" },
  { id: "r2", name: "Mr. Alvarez", email: "alvarez@school.edu", role: "Tutor", status: "pending" },
];

const goalMinutes = 180;
const todayMinutes = minutesOn(todayKey());
const activeNow = mockSessions[0] && mockSessions[0].date === todayKey();

export const todayStats = {
  focusMinutes: todayMinutes,
  goalMinutes,
  sessions: sessionsOn(todayKey()).length,
  streak: computeStreak(),
  deviceState: (activeNow ? "work" : "idle") as DeviceState,
  battery: 78,
  wifi: "Strong",
  activeSession: activeNow ? mockSessions[0] : null,
};
