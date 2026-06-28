import type { ScheduleEvent } from "@/features/schedule/schedule";
import { daysUntil, expandScheduleEvents } from "@/features/schedule/schedule";
import { toDateKey } from "@/lib/dates";
import type { HomeworkAssignment, HomeworkStatus } from "@/lib/types";
import { buildGradeBreakdown, type GradeBreakdown } from "@/features/courses/grades";

// A real course entity. Schedule events and homework still link to it by the
// free-text `code` (the join key) — see matchesCode below.
export interface Course {
  id: string;
  code: string;
  name: string;
  color: string;
  instructor: string | null;
  credits: number | null;
  /** 0–100 target, nullable. */
  targetGrade: number | null;
  notes: string | null;
  /** Manual "watched" counters per meeting type (schedule vs actual). */
  watchedLectures: number;
  watchedTutorials: number;
  watchedLabs: number;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingCounts {
  lecture: number;
  tutorial: number;
  lab: number;
  total: number;
}

export interface CourseExamRef {
  event: ScheduleEvent;
  dateKey: string;
  daysUntil: number;
}

export interface CourseSummary {
  course: Course;
  meetings: MeetingCounts;
  examCount: number;
  nextExam: CourseExamRef | null;
  homeworkTotal: number;
  homeworkByStatus: Record<HomeworkStatus, number>;
  /** "Both" model: per-assignment % overrides status; mean across homework, 0–100. */
  completionPct: number;
  /** Mean of graded homework grades (includes 0), or null when none graded. */
  gradeAverage: number | null;
  targetGrade: number | null;
  /** gradeAverage − targetGrade, or null when either is missing. */
  gradeVsTarget: number | null;
  /** Weighted "points out of 100" scheme (homework + exams). */
  gradeBreakdown: GradeBreakdown;
}

export interface OverallSummary {
  courseCount: number;
  totalCredits: number;
  homeworkTotal: number;
  completionPct: number;
  /** Σ(avg·credits) / Σ(credits) over graded courses with credits, else null. */
  creditWeightedGradeAverage: number | null;
}

/** Case-insensitive, trimmed code match so old free-text rows aren't orphaned. */
export function matchesCode(rowCode: string | null | undefined, courseCode: string): boolean {
  if (rowCode == null) return false;
  return rowCode.trim().toLowerCase() === courseCode.trim().toLowerCase();
}

/** Completion for one homework: a manual % overrides; otherwise status decides. */
export function completionPctForHomework(
  hw: Pick<HomeworkAssignment, "status" | "progressPct">,
): number {
  if (hw.progressPct != null) return Math.max(0, Math.min(100, hw.progressPct));
  return hw.status === "pending" ? 0 : 100;
}

/** Mean completion across a set of homework (0 when empty). */
export function homeworkCompletion(
  items: Pick<HomeworkAssignment, "status" | "progressPct">[],
): number {
  if (items.length === 0) return 0;
  const sum = items.reduce((acc, hw) => acc + completionPctForHomework(hw), 0);
  return Math.round(sum / items.length);
}

/** Count weekly class meetings for a course by subtype. */
export function meetingCountsBySubtype(events: ScheduleEvent[], code: string): MeetingCounts {
  const counts: MeetingCounts = { lecture: 0, tutorial: 0, lab: 0, total: 0 };
  for (const e of events) {
    if (e.category !== "class") continue;
    if (!matchesCode(e.courseCode, code)) continue;
    counts.total += 1;
    if (e.subtype === "lecture") counts.lecture += 1;
    else if (e.subtype === "tutorial") counts.tutorial += 1;
    else if (e.subtype === "lab") counts.lab += 1;
  }
  return counts;
}

/** Exam events (category 'exam') for a course, soonest first. */
export function examsForCourse(events: ScheduleEvent[], code: string): ScheduleEvent[] {
  return events
    .filter((e) => e.category === "exam" && matchesCode(e.courseCode, code) && e.eventDate)
    .sort((a, b) => (a.eventDate as string).localeCompare(b.eventDate as string));
}

/** The soonest future exam for a course (today onward), or null. */
export function nextExamForCourse(
  events: ScheduleEvent[],
  code: string,
  now = new Date(),
): CourseExamRef | null {
  const todayKey = toDateKey(now);
  const upcoming = examsForCourse(events, code).filter((e) => (e.eventDate as string) >= todayKey);
  const next = upcoming[0];
  if (!next) return null;
  const dateKey = next.eventDate as string;
  return { event: next, dateKey, daysUntil: daysUntil(dateKey, now) };
}

/** Homework rows belonging to a course. */
export function homeworkForCourse(
  homework: HomeworkAssignment[],
  code: string,
): HomeworkAssignment[] {
  return homework.filter((hw) => matchesCode(hw.courseCode, code));
}

/** Average of graded homework grades (includes 0), and the gap to target. */
export function gradeAverageVsTarget(
  homework: HomeworkAssignment[],
  targetGrade: number | null,
): { gradeAverage: number | null; gradeVsTarget: number | null } {
  const graded = homework.filter((hw) => hw.status === "graded" && hw.grade != null);
  if (graded.length === 0) {
    return { gradeAverage: null, gradeVsTarget: null };
  }
  const sum = graded.reduce((acc, hw) => acc + (hw.grade as number), 0);
  const gradeAverage = Math.round((sum / graded.length) * 10) / 10;
  const gradeVsTarget =
    targetGrade == null ? null : Math.round((gradeAverage - targetGrade) * 10) / 10;
  return { gradeAverage, gradeVsTarget };
}

function emptyStatusCounts(): Record<HomeworkStatus, number> {
  return { pending: 0, submitted: 0, graded: 0 };
}

/** Build the aggregated summary for a single course. */
export function buildCourseSummary(
  course: Course,
  events: ScheduleEvent[],
  homework: HomeworkAssignment[],
  now = new Date(),
): CourseSummary {
  const courseHomework = homeworkForCourse(homework, course.code);
  const homeworkByStatus = emptyStatusCounts();
  for (const hw of courseHomework) homeworkByStatus[hw.status] += 1;

  const { gradeAverage, gradeVsTarget } = gradeAverageVsTarget(courseHomework, course.targetGrade);

  const courseExams = examsForCourse(events, course.code);

  return {
    course,
    meetings: meetingCountsBySubtype(events, course.code),
    examCount: courseExams.length,
    nextExam: nextExamForCourse(events, course.code, now),
    homeworkTotal: courseHomework.length,
    homeworkByStatus,
    completionPct: homeworkCompletion(courseHomework),
    gradeAverage,
    targetGrade: course.targetGrade,
    gradeVsTarget,
    gradeBreakdown: buildGradeBreakdown(courseHomework, courseExams),
  };
}

/**
 * Planned meeting count per subtype across the semester term, so the UI can show
 * "watched 8 of 12". With no term set (no `weeklyBounds`), falls back to the
 * weekly template counts from `meetingCountsBySubtype`.
 */
export function plannedMeetingCounts(
  events: ScheduleEvent[],
  code: string,
  weeklyBounds?: { start?: string | null; end?: string | null },
): MeetingCounts {
  const start = weeklyBounds?.start;
  const end = weeklyBounds?.end;
  if (!start || !end || start > end) {
    return meetingCountsBySubtype(events, code);
  }

  const classes = events.filter((e) => e.category === "class" && matchesCode(e.courseCode, code));
  const occurrences = expandScheduleEvents(classes, start, end, { start, end });
  const counts: MeetingCounts = { lecture: 0, tutorial: 0, lab: 0, total: 0 };
  for (const o of occurrences) {
    counts.total += 1;
    if (o.subtype === "lecture") counts.lecture += 1;
    else if (o.subtype === "tutorial") counts.tutorial += 1;
    else if (o.subtype === "lab") counts.lab += 1;
  }
  return counts;
}

/** Credit-weighted mean of course grade averages (courses without credits or a
 * grade average are excluded). Returns null when nothing qualifies. */
export function overallGradeAverage(summaries: CourseSummary[]): number | null {
  let weightedSum = 0;
  let weightTotal = 0;
  for (const s of summaries) {
    if (s.gradeAverage == null || s.course.credits == null || s.course.credits <= 0) continue;
    weightedSum += s.gradeAverage * s.course.credits;
    weightTotal += s.course.credits;
  }
  if (weightTotal === 0) return null;
  return Math.round((weightedSum / weightTotal) * 10) / 10;
}

/** Build per-course summaries plus an overall roll-up for the /courses page. */
export function buildCourseSummaries(
  courses: Course[],
  events: ScheduleEvent[],
  homework: HomeworkAssignment[],
  now = new Date(),
): { perCourse: CourseSummary[]; overall: OverallSummary } {
  const perCourse = courses
    .map((c) => buildCourseSummary(c, events, homework, now))
    .sort((a, b) => a.course.code.localeCompare(b.course.code));

  const totalCredits = courses.reduce((acc, c) => acc + (c.credits ?? 0), 0);
  const allCourseHomework = courses.flatMap((c) => homeworkForCourse(homework, c.code));

  return {
    perCourse,
    overall: {
      courseCount: courses.length,
      totalCredits: Math.round(totalCredits * 10) / 10,
      homeworkTotal: allCourseHomework.length,
      completionPct: homeworkCompletion(allCourseHomework),
      creditWeightedGradeAverage: overallGradeAverage(perCourse),
    },
  };
}
