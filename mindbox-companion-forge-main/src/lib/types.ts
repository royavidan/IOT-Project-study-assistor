export type DeviceState = "work" | "break" | "sync" | "warning" | "danger" | "idle";
export type SessionMode = "Deep Focus" | "Study" | "Reading" | "Review";
export type SessionStatus = "completed" | "interrupted" | "aborted";

export interface Session {
  id: string;
  date: string;
  start: string;
  durationMin: number;
  mode: SessionMode;
  status: SessionStatus;
  focusScore: number;
  breaks: number;
  subject: string;
  /** Average environmental readings for the session (Story 8). null when unlogged. */
  noiseAvg: number | null;
  tempC: number | null;
  lightLux: number | null;
  presenceInterruptions: number;
  /** Owner of the session row (for reviewer scoping). */
  userId?: string;
  /** ISO timestamp when the session ended (for inactivity nudges). */
  endedAt?: string;
}

export interface DeviceStatusSnapshot {
  state: DeviceState;
  battery: number;
  wifi: string;
  sensorHealth: Record<string, unknown> | null;
}

export interface DailyAggregate {
  date: string;
  minutes: number;
  avgScore: number;
  sessions: number;
}

export interface TodayStats {
  focusMinutes: number;
  goalMinutes: number;
  sessions: number;
  streak: number;
  deviceState: DeviceState;
  battery: number;
  wifi: string;
}

export interface LeaderboardEntry {
  rank: number;
  display_name: string;
  minutes_this_week: number;
  streak: number;
  is_you: boolean;
}

export type HomeworkStatus = "pending" | "submitted" | "graded";

export interface HomeworkAssignment {
  id: string;
  courseCode: string | null;
  title: string;
  description: string | null;
  dueDate: string;
  status: HomeworkStatus;
  fileUrl: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  grade: number | null;
  /** Optional 0–100 manual progress. Null = derive completion from status. */
  progressPct: number | null;
  /** Points this assignment is worth toward the final grade. Null = not counted. */
  weight: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
