// Exam/DND downlink derivation. OUR deterministic rule, stated explicitly:
//
//   effective examMode = manual toggle OR an exam occurs TODAY (owner-local).
//
// Auto wins: the settings switch can extend DND to non-exam days, but cannot
// turn it off on an exam day. While on, the box mutes every chime except the
// explicit "ring my device" and suppresses coaching nudges. The next exam
// (today included) inside the look-ahead window also rides down for the idle
// badge ("EXAM 3d").

import { sanitizeDeviceString, truncateUtf8Bytes } from "./device-string";

export const EXAM_LOOKAHEAD_DAYS = 14;
export const DEVICE_EXAM_TITLE_MAX_BYTES = 23;

export interface ExamOccurrenceLike {
  /** "YYYY-MM-DD" (owner-local). */
  date: string;
  category: string;
  title: string;
}

export interface ExamDownlink {
  examMode: boolean;
  /** Days until the next exam: 0 = today, -1 = none in the window. */
  nextExamDays: number;
  nextExamTitle: string;
}

export function deriveExamDownlink(
  manualOn: boolean,
  todayKey: string,
  upcoming: ExamOccurrenceLike[],
): ExamDownlink {
  const exams = upcoming
    .filter((o) => o.category === "exam" && o.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date));
  const next = exams[0];
  const nextExamDays = next ? diffDayKeys(todayKey, next.date) : -1;
  return {
    examMode: manualOn || nextExamDays === 0,
    nextExamDays,
    nextExamTitle: next
      ? truncateUtf8Bytes(sanitizeDeviceString(next.title), DEVICE_EXAM_TITLE_MAX_BYTES).trimEnd()
      : "",
  };
}

/** Whole-day difference between two date keys (UTC math — keys are pure days). */
export function diffDayKeys(fromKey: string, toKey: string): number {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return -1;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}
