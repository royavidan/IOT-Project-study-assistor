// Timetable → external-load bridge. Turns the student's real attended classes
// (lectures / tutorials / labs already in the schedule) into ExternalLoadEntry
// items that feed the Focus Battery's load term — so class time drains the
// battery WITHOUT the student re-typing it into "Other commitments". Attended
// class time is passive, so it is down-weighted by LECTURE_PASSIVE_FACTOR.
// Pure + unit-tested; no React/Supabase.

import type { ScheduleEvent } from "@/features/schedule/schedule";
import { expandScheduleEvents } from "@/features/schedule/schedule";
import { LECTURE_PASSIVE_FACTOR } from "@/lib/study-strain";
import type { ExternalLoadEntry } from "@/lib/wellbeing";

function durationMinutes(startTime: string, endTime: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map((x) => Number.parseInt(x, 10));
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  return Math.max(0, toMin(endTime) - toMin(startTime));
}

/**
 * Passive external load from attended classes in `[from, to]`. Every class
 * occurrence (category `"class"` — lecture/tutorial/lab) becomes a **dated**
 * entry weighted by `LECTURE_PASSIVE_FACTOR`. Exams and self-planned study
 * blocks are excluded (study blocks are the user's own logged focus time).
 */
export function externalLoadFromSchedule(
  events: ScheduleEvent[],
  from: string,
  to: string,
  weeklyBounds?: { start?: string | null; end?: string | null },
): ExternalLoadEntry[] {
  const occurrences = expandScheduleEvents(events, from, to, weeklyBounds);
  const out: ExternalLoadEntry[] = [];
  for (const o of occurrences) {
    if (o.category !== "class") continue;
    const mins = durationMinutes(o.startTime, o.endTime);
    if (mins <= 0) continue;
    out.push({
      label: o.title || "Class",
      kind: "dated",
      hours: (mins / 60) * LECTURE_PASSIVE_FACTOR,
      date: o.date,
    });
  }
  return out;
}
