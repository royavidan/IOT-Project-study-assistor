import { completionPctForHomework } from "@/features/courses/courses";
import type { CourseSummary, OverallSummary } from "@/features/courses/courses";
import { daysUntil, expandScheduleEvents, upcomingExams } from "@/features/schedule/schedule";
import type { ScheduleEvent, ScheduleOccurrence, UpcomingExam } from "@/features/schedule/schedule";
import type { HomeworkAssignment } from "@/lib/types";

// Pure "what do I do today?" aggregation for the dashboard. No React/Supabase —
// it folds already-loaded schedule events, homework, and course summaries into
// the handful of things a student needs above the fold. Unit-tested.

/** Concrete class/study/exam occurrences on `dateKey`, time-sorted. */
export function todaysOccurrences(
  events: ScheduleEvent[],
  dateKey: string,
  weeklyBounds?: { start?: string | null; end?: string | null },
): ScheduleOccurrence[] {
  return expandScheduleEvents(events, dateKey, dateKey, weeklyBounds);
}

export interface DueItem {
  hw: HomeworkAssignment;
  /** Whole days from today to the due date (negative = overdue). */
  daysUntil: number;
  overdue: boolean;
}

/**
 * Unfinished homework due within `horizonDays` (overdue items always included),
 * soonest first. "Finished" = completion ≥ 100 (submitted/graded or a manual 100).
 */
export function dueSoon(
  homework: HomeworkAssignment[],
  horizonDays = 7,
  now = new Date(),
): DueItem[] {
  return homework
    .filter((hw) => hw.dueDate && completionPctForHomework(hw) < 100)
    .map((hw) => {
      const d = daysUntil(hw.dueDate.slice(0, 10), now);
      return { hw, daysUntil: d, overdue: d < 0 };
    })
    .filter((it) => it.daysUntil <= horizonDays)
    .sort((a, b) => a.daysUntil - b.daysUntil || a.hw.dueDate.localeCompare(b.hw.dueDate));
}

/** The soonest upcoming exam across every course, or null. */
export function nextExam(events: ScheduleEvent[], now = new Date()): UpcomingExam | null {
  return upcomingExams(events, now, 365)[0] ?? null;
}

/** The single most important thing to do next. */
export type NextAction =
  | { kind: "homework"; hw: HomeworkAssignment; overdue: boolean; daysUntil: number }
  | { kind: "exam"; exam: UpcomingExam }
  | { kind: "session" };

/**
 * Choose the one dominant call-to-action:
 *  1. an assignment due today or overdue,
 *  2. else an exam within a week,
 *  3. else the next assignment due within the horizon,
 *  4. else a gentle nudge to start a focus session.
 */
export function pickNextAction(due: DueItem[], exam: UpcomingExam | null): NextAction {
  const urgentHw = due[0] ?? null;
  if (urgentHw && urgentHw.daysUntil <= 0) {
    return {
      kind: "homework",
      hw: urgentHw.hw,
      overdue: urgentHw.overdue,
      daysUntil: urgentHw.daysUntil,
    };
  }
  if (exam && exam.daysUntil <= 7) {
    return { kind: "exam", exam };
  }
  if (urgentHw) {
    return {
      kind: "homework",
      hw: urgentHw.hw,
      overdue: urgentHw.overdue,
      daysUntil: urgentHw.daysUntil,
    };
  }
  return { kind: "session" };
}

export interface UrgentCourse {
  summary: CourseSummary;
  reason: "exam" | "homework";
}

/**
 * The course that most needs attention: the soonest exam wins; otherwise the
 * course with the least-finished homework (and some still outstanding).
 */
export function pickUrgentCourse(perCourse: CourseSummary[]): UrgentCourse | null {
  const withExam = perCourse
    .filter((s) => s.nextExam)
    .sort(
      (a, b) =>
        (a.nextExam as NonNullable<CourseSummary["nextExam"]>).daysUntil -
        (b.nextExam as NonNullable<CourseSummary["nextExam"]>).daysUntil,
    );
  if (withExam.length) return { summary: withExam[0], reason: "exam" };

  const withHomework = perCourse
    .filter((s) => s.homeworkTotal > 0 && s.completionPct < 100)
    .sort((a, b) => a.completionPct - b.completionPct);
  if (withHomework.length) return { summary: withHomework[0], reason: "homework" };

  return null;
}

export interface CourseSnapshot {
  overall: OverallSummary;
  urgent: UrgentCourse | null;
}

/** Convenience roll-up for the dashboard's course snapshot card. */
export function courseSnapshot(
  overall: OverallSummary,
  perCourse: CourseSummary[],
): CourseSnapshot {
  return { overall, urgent: pickUrgentCourse(perCourse) };
}

// --- First-run / engagement state -------------------------------------------

/** Time-of-day greeting with the user's name (falls back to a plain greeting). */
export function greetingFor(name: string | null | undefined, now = new Date()): string {
  const h = now.getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const who = (name ?? "").trim();
  return who ? `${part}, ${who}` : part;
}

export interface OnboardingState {
  hasCourses: boolean;
  hasSchedule: boolean;
  hasDevice: boolean;
  hasSessions: boolean;
}

export interface OnboardingStep {
  key: "courses" | "schedule" | "device" | "session";
  label: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
}

/** The 4-step getting-started checklist; each step's done-ness comes from real data. */
export function onboardingSteps(s: OnboardingState): OnboardingStep[] {
  return [
    {
      key: "courses",
      label: "Add your courses",
      description: "Pull lectures, exams and homework into one place.",
      href: "/courses",
      cta: "Add course",
      done: s.hasCourses,
    },
    {
      key: "schedule",
      label: "Build your week",
      description: "Add classes or import a calendar (.ics).",
      href: "/calendar",
      cta: "Open calendar",
      done: s.hasSchedule,
    },
    {
      key: "device",
      label: "Connect your MindBox",
      description: "Pair the focus device so sessions sync automatically.",
      href: "/device",
      cta: "Connect",
      done: s.hasDevice,
    },
    {
      key: "session",
      label: "Log your first session",
      description: "No hardware yet? Log one in the simulator.",
      href: "/simulator",
      cta: "Log session",
      done: s.hasSessions,
    },
  ];
}

/** How many checklist steps are complete. */
export function completedStepCount(steps: OnboardingStep[]): number {
  return steps.reduce((n, s) => n + (s.done ? 1 : 0), 0);
}

/** The dashboard is "engaged" (show device/session stats) once a device is paired
 * or any session has been logged — otherwise we show the getting-started flow. */
export function isEngaged(s: Pick<OnboardingState, "hasDevice" | "hasSessions">): boolean {
  return s.hasDevice || s.hasSessions;
}
