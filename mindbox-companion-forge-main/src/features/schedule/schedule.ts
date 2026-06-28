import { parseDateKey, toDateKey } from "@/lib/dates";
import type { Session } from "@/lib/types";
import type { ScheduleEventInput } from "@/features/schedule/queries";

export type ScheduleKind = "weekly" | "once";
export type ScheduleCategory = "class" | "exam";
export type MeetingType = "lecture" | "tutorial" | "lab";

export interface ScheduleEvent {
  id: string;
  title: string;
  courseCode: string | null;
  location: string | null;
  color: string;
  /** What it is — a recurring class or a one-off exam. */
  category: ScheduleCategory;
  /** For classes: 'lecture' | 'tutorial' | 'lab'. Null for exams. */
  subtype: string | null;
  kind: ScheduleKind;
  dayOfWeek: number | null;
  eventDate: string | null;
  startTime: string;
  endTime: string;
  notes: string | null;
  /** Exam only: points toward the final grade. Null otherwise / not set. */
  examWeight: number | null;
  /** Exam only: recorded score 0–100. Null until graded. */
  examScore: number | null;
}

export interface ScheduleOccurrence {
  occurrenceKey: string;
  eventId: string;
  date: string;
  title: string;
  courseCode: string | null;
  location: string | null;
  color: string;
  category: ScheduleCategory;
  subtype: string | null;
  startTime: string;
  endTime: string;
  notes: string | null;
  kind: ScheduleKind;
}

export interface AgendaItem {
  type: "course" | "focus";
  id: string;
  startMinutes: number;
  endMinutes: number;
  label: string;
  sublabel?: string;
  color?: string;
  href?: string;
  /** Set for course items so the UI can style exams distinctly. */
  category?: ScheduleCategory;
  /** Meeting kind for class items: 'lecture' | 'tutorial' | 'lab'. */
  subtype?: string | null;
}

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DAY_LABELS_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const COURSE_COLORS = [
  { id: "indigo", value: "#6366f1", label: "Indigo" },
  { id: "sky", value: "#0ea5e9", label: "Sky" },
  { id: "emerald", value: "#10b981", label: "Emerald" },
  { id: "amber", value: "#f59e0b", label: "Amber" },
  { id: "rose", value: "#f43f5e", label: "Rose" },
  { id: "violet", value: "#8b5cf6", label: "Violet" },
] as const;

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Parse HH:MM to minutes since midnight. Returns null when invalid. */
export function parseTimeToMinutes(time: string): number | null {
  const match = TIME_RE.exec(time.trim());
  if (!match) return null;
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

/** Format HH:MM for display (e.g. 9:00 AM). */
export function formatTimeDisplay(time: string): string {
  const mins = parseTimeToMinutes(time);
  if (mins == null) return time;
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function formatDurationMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function validateScheduleTimes(startTime: string, endTime: string): string | null {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);
  if (start == null || end == null) return "Use 24-hour times like 09:00 or 14:30.";
  if (end <= start) return "End time must be after start time.";
  return null;
}

/** Expand stored events into concrete occurrences between two date keys (inclusive). */
export function expandScheduleEvents(
  events: ScheduleEvent[],
  from: string,
  to: string,
  /** Optional semester term — weekly classes only repeat within this window. */
  weeklyBounds?: { start?: string | null; end?: string | null },
): ScheduleOccurrence[] {
  const out: ScheduleOccurrence[] = [];

  for (const event of events) {
    if (event.kind === "once") {
      // One-off events (e.g. exams) always show on their explicit date.
      if (!event.eventDate || event.eventDate < from || event.eventDate > to) continue;
      out.push(toOccurrence(event, event.eventDate));
      continue;
    }

    if (event.dayOfWeek == null) continue;

    // Intersect the requested range with the semester term, if set.
    const winFrom = weeklyBounds?.start && weeklyBounds.start > from ? weeklyBounds.start : from;
    const winTo = weeklyBounds?.end && weeklyBounds.end < to ? weeklyBounds.end : to;
    if (winFrom > winTo) continue;

    const start = parseDateKey(winFrom);
    const end = parseDateKey(winTo);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== event.dayOfWeek) continue;
      out.push(toOccurrence(event, toDateKey(d)));
    }
  }

  return out.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (parseTimeToMinutes(a.startTime) ?? 0) - (parseTimeToMinutes(b.startTime) ?? 0);
  });
}

function toOccurrence(event: ScheduleEvent, date: string): ScheduleOccurrence {
  return {
    occurrenceKey: `${event.id}:${date}`,
    eventId: event.id,
    date,
    title: event.title,
    courseCode: event.courseCode,
    location: event.location,
    color: event.color,
    category: event.category,
    subtype: event.subtype,
    startTime: event.startTime,
    endTime: event.endTime,
    notes: event.notes,
    kind: event.kind,
  };
}

export function occurrencesForDay(
  occurrences: ScheduleOccurrence[],
  dateKey: string,
): ScheduleOccurrence[] {
  return occurrences.filter((o) => o.date === dateKey);
}

export function sessionsForDay(sessions: Session[], dateKey: string): Session[] {
  return sessions
    .filter((s) => s.date === dateKey)
    .sort((a, b) => (parseTimeToMinutes(a.start) ?? 0) - (parseTimeToMinutes(b.start) ?? 0));
}

/** Merge courses and MindBox focus sessions into one sorted day timeline. */
export function buildDayAgenda(
  occurrences: ScheduleOccurrence[],
  sessions: Session[],
  dateKey: string,
): AgendaItem[] {
  const items: AgendaItem[] = [];

  for (const o of occurrencesForDay(occurrences, dateKey)) {
    const start = parseTimeToMinutes(o.startTime);
    const end = parseTimeToMinutes(o.endTime);
    if (start == null || end == null) continue;
    const bits = [o.courseCode, o.location].filter(Boolean);
    items.push({
      type: "course",
      id: o.occurrenceKey,
      startMinutes: start,
      endMinutes: end,
      label: o.title,
      sublabel: bits.length ? bits.join(" · ") : undefined,
      color: o.color,
      category: o.category,
      subtype: o.subtype,
    });
  }

  for (const s of sessionsForDay(sessions, dateKey)) {
    const start = parseTimeToMinutes(s.start) ?? 0;
    items.push({
      type: "focus",
      id: s.id,
      startMinutes: start,
      endMinutes: start + s.durationMin,
      label: s.mode,
      sublabel: `${s.durationMin} min · focus ${s.focusScore}`,
      href: `/session/${s.id}`,
    });
  }

  return items.sort((a, b) => a.startMinutes - b.startMinutes);
}

export function datesWithCourses(occurrences: ScheduleOccurrence[]): Set<string> {
  return new Set(occurrences.map((o) => o.date));
}

export function datesWithFocus(sessions: Session[]): Set<string> {
  return new Set(sessions.map((s) => s.date));
}

/** A course-colored dot for a calendar day. */
export interface CourseMarker {
  color: string;
  category: ScheduleCategory;
}

export const MAX_DAY_MARKERS = 3;

/**
 * Group occurrences into per-day markers for the month grid, colored by course.
 * Distinct by (color + category); exams come first so an exam ring is never
 * dropped by the per-day cap; capped at MAX_DAY_MARKERS per day.
 */
export function courseMarkersByDate(
  occurrences: ScheduleOccurrence[],
): Map<string, CourseMarker[]> {
  const rank = (c: ScheduleCategory) => (c === "exam" ? 0 : 1);
  const ordered = [...occurrences].sort((a, b) => rank(a.category) - rank(b.category));

  const byDate = new Map<string, CourseMarker[]>();
  const seen = new Map<string, Set<string>>();

  for (const o of ordered) {
    let markers = byDate.get(o.date);
    let keys = seen.get(o.date);
    if (!markers || !keys) {
      markers = [];
      keys = new Set<string>();
      byDate.set(o.date, markers);
      seen.set(o.date, keys);
    }
    const key = `${o.color}|${o.category}`;
    if (keys.has(key) || markers.length >= MAX_DAY_MARKERS) continue;
    keys.add(key);
    markers.push({ color: o.color, category: o.category });
  }

  return byDate;
}

/** Monday-based week containing `anchor` (local calendar). */
export function weekDateKeys(anchor: string): string[] {
  const d = parseDateKey(anchor);
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + mondayOffset);

  const keys: string[] = [];
  for (let i = 0; i < 7; i++) {
    keys.push(toDateKey(d));
    d.setDate(d.getDate() + 1);
  }
  return keys;
}

export function monthDateRange(month: Date): { from: string; to: string } {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  return { from: toDateKey(start), to: toDateKey(end) };
}

export function friendlyDateLabel(dateKey: string, now = new Date()): string {
  const today = toDateKey(now);
  const tomorrow = toDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  if (dateKey === today) return "Today";
  if (dateKey === tomorrow) return "Tomorrow";
  const d = parseDateKey(dateKey);
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** Whole days from today to `dateKey` (0 = today, negative = past). */
export function daysUntil(dateKey: string, now = new Date()): number {
  const today = parseDateKey(toDateKey(now));
  const target = parseDateKey(dateKey);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Short countdown copy, e.g. "Today", "Tomorrow", "in 5 days". */
export function countdownLabel(dateKey: string, now = new Date()): string {
  const n = daysUntil(dateKey, now);
  if (n <= 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n < 7) return `in ${n} days`;
  if (n < 14) return "in 1 week";
  return `in ${Math.round(n / 7)} weeks`;
}

export interface UpcomingExam {
  event: ScheduleEvent;
  dateKey: string;
  daysUntil: number;
}

/** Future exams (today onward) within `horizonDays`, soonest first. */
export function upcomingExams(
  events: ScheduleEvent[],
  now = new Date(),
  horizonDays = 120,
): UpcomingExam[] {
  const todayKey = toDateKey(now);
  return events
    .filter((e) => e.category === "exam" && e.eventDate && e.eventDate >= todayKey)
    .map((e) => ({
      event: e,
      dateKey: e.eventDate as string,
      daysUntil: daysUntil(e.eventDate as string, now),
    }))
    .filter((u) => u.daysUntil <= horizonDays)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

// --- Course builder (one course → many weekly meetings + exams) -------------

const EXAM_COLOR = "#f43f5e";

export const MEETING_TYPES: { value: MeetingType; label: string }[] = [
  { value: "lecture", label: "Lecture" },
  { value: "tutorial", label: "Tutorial" },
  { value: "lab", label: "Lab" },
];

export function meetingTypeLabel(subtype: string | null | undefined): string {
  return MEETING_TYPES.find((m) => m.value === subtype)?.label ?? "Class";
}

export interface CourseMeetingDraft {
  subtype: MeetingType;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  location: string;
}

export interface CourseExamDraft {
  title: string;
  eventDate: string;
  startTime: string;
  endTime: string;
}

export interface CourseDraft {
  name: string;
  courseCode: string;
  color: string;
  notes: string;
  meetings: CourseMeetingDraft[];
  exams: CourseExamDraft[];
}

/**
 * Expand a course into the individual schedule events to persist: one weekly
 * event per meeting (lecture/tutorial/lab) plus one dated event per exam.
 * Pure — the dialog validates first, this just maps.
 */
export function buildCourseEvents(course: CourseDraft): ScheduleEventInput[] {
  const name = course.name.trim();
  const code = course.courseCode.trim() || null;
  const notes = course.notes.trim() || null;
  const events: ScheduleEventInput[] = [];

  for (const m of course.meetings) {
    events.push({
      title: name,
      courseCode: code,
      location: m.location.trim() || null,
      color: course.color,
      category: "class",
      subtype: m.subtype,
      kind: "weekly",
      dayOfWeek: m.dayOfWeek,
      eventDate: null,
      startTime: m.startTime,
      endTime: m.endTime,
      notes,
    });
  }

  for (const ex of course.exams) {
    const label = ex.title.trim();
    events.push({
      title: label ? `${name} — ${label}` : `${name} exam`,
      courseCode: code,
      location: null,
      color: EXAM_COLOR,
      category: "exam",
      subtype: null,
      kind: "once",
      dayOfWeek: null,
      eventDate: ex.eventDate,
      startTime: ex.startTime,
      endTime: ex.endTime,
      notes,
    });
  }

  return events;
}
