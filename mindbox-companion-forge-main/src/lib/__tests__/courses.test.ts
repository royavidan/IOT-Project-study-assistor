import { describe, expect, it } from "vitest";

import {
  buildCourseSummaries,
  buildCourseSummary,
  completionPctForHomework,
  gradeAverageVsTarget,
  homeworkCompletion,
  matchesCode,
  meetingCountsBySubtype,
  nextExamForCourse,
  overallGradeAverage,
  type Course,
} from "@/features/courses/courses";
import type { ScheduleEvent } from "@/features/schedule/schedule";
import type { HomeworkAssignment } from "@/lib/types";

const NOW = new Date("2026-06-27T12:00:00");

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: "c1",
    code: "CS101",
    name: "Intro to CS",
    color: "#6366f1",
    instructor: null,
    credits: null,
    targetGrade: null,
    notes: null,
    watchedLectures: 0,
    watchedTutorials: 0,
    watchedLabs: 0,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function ev(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: Math.random().toString(36).slice(2),
    title: "Intro to CS",
    courseCode: "CS101",
    location: null,
    color: "#6366f1",
    category: "class",
    subtype: "lecture",
    kind: "weekly",
    dayOfWeek: 1,
    eventDate: null,
    startTime: "09:00",
    endTime: "10:30",
    notes: null,
    examWeight: null,
    examScore: null,
    ...overrides,
  };
}

function hw(overrides: Partial<HomeworkAssignment> = {}): HomeworkAssignment {
  return {
    id: Math.random().toString(36).slice(2),
    courseCode: "CS101",
    title: "HW",
    description: null,
    dueDate: "2026-07-01",
    status: "pending",
    fileUrl: null,
    fileName: null,
    fileSizeBytes: null,
    grade: null,
    progressPct: null,
    weight: null,
    notes: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("matchesCode", () => {
  it("matches case-insensitively and trims", () => {
    expect(matchesCode(" cs101 ", "CS101")).toBe(true);
    expect(matchesCode("CS101", "cs101")).toBe(true);
    expect(matchesCode("CS102", "CS101")).toBe(false);
    expect(matchesCode(null, "CS101")).toBe(false);
  });
});

describe("completion (the 'both' model)", () => {
  it("uses manual progress when set, otherwise derives from status", () => {
    expect(completionPctForHomework(hw({ status: "pending", progressPct: null }))).toBe(0);
    expect(completionPctForHomework(hw({ status: "pending", progressPct: 40 }))).toBe(40);
    expect(completionPctForHomework(hw({ status: "submitted", progressPct: null }))).toBe(100);
    expect(completionPctForHomework(hw({ status: "graded", progressPct: null }))).toBe(100);
  });

  it("averages completion across homework; empty is 0", () => {
    expect(homeworkCompletion([])).toBe(0);
    const items = [hw({ status: "pending" }), hw({ status: "submitted" })];
    expect(homeworkCompletion(items)).toBe(50);
    const partial = [
      hw({ status: "pending", progressPct: 40 }),
      hw({ status: "pending", progressPct: 60 }),
    ];
    expect(homeworkCompletion(partial)).toBe(50);
  });
});

describe("meetingCountsBySubtype", () => {
  it("counts class meetings by subtype and ignores exams / other courses", () => {
    const events = [
      ev({ subtype: "lecture" }),
      ev({ subtype: "lecture" }),
      ev({ subtype: "tutorial" }),
      ev({ subtype: "lab" }),
      ev({ category: "exam", subtype: null, kind: "once", eventDate: "2026-07-10" }),
      ev({ courseCode: "MATH200", subtype: "lecture" }),
    ];
    const counts = meetingCountsBySubtype(events, "cs101");
    expect(counts).toEqual({ lecture: 2, tutorial: 1, lab: 1, total: 4 });
  });
});

describe("nextExamForCourse", () => {
  it("picks the soonest future exam, ignoring past ones", () => {
    const events = [
      ev({ category: "exam", subtype: null, kind: "once", eventDate: "2026-06-01", title: "Past" }),
      ev({
        category: "exam",
        subtype: null,
        kind: "once",
        eventDate: "2026-08-01",
        title: "Final",
      }),
      ev({
        category: "exam",
        subtype: null,
        kind: "once",
        eventDate: "2026-07-01",
        title: "Midterm",
      }),
    ];
    const next = nextExamForCourse(events, "CS101", NOW);
    expect(next?.event.title).toBe("Midterm");
    expect(next?.daysUntil).toBeGreaterThan(0);
  });

  it("returns null when there is no upcoming exam", () => {
    const events = [ev({ category: "exam", subtype: null, kind: "once", eventDate: "2026-06-01" })];
    expect(nextExamForCourse(events, "CS101", NOW)).toBeNull();
  });
});

describe("gradeAverageVsTarget", () => {
  it("averages graded grades including a literal 0 and excludes ungraded", () => {
    const items = [
      hw({ status: "graded", grade: 0 }),
      hw({ status: "graded", grade: 100 }),
      hw({ status: "submitted", grade: null }),
    ];
    const { gradeAverage, gradeVsTarget } = gradeAverageVsTarget(items, 80);
    expect(gradeAverage).toBe(50);
    expect(gradeVsTarget).toBe(-30);
  });

  it("returns null when nothing is graded", () => {
    expect(gradeAverageVsTarget([hw({ status: "pending" })], 90)).toEqual({
      gradeAverage: null,
      gradeVsTarget: null,
    });
  });
});

describe("buildCourseSummary", () => {
  it("aggregates meetings, exams, homework, and completion for a course", () => {
    const events = [
      ev({ subtype: "lecture" }),
      ev({ subtype: "tutorial" }),
      ev({ category: "exam", subtype: null, kind: "once", eventDate: "2026-07-05" }),
    ];
    const homework = [
      hw({ status: "graded", grade: 90 }),
      hw({ status: "pending", progressPct: 50 }),
    ];
    const summary = buildCourseSummary(course({ targetGrade: 85 }), events, homework, NOW);
    expect(summary.meetings.total).toBe(2);
    expect(summary.examCount).toBe(1);
    expect(summary.nextExam?.dateKey).toBe("2026-07-05");
    expect(summary.homeworkTotal).toBe(2);
    expect(summary.homeworkByStatus.graded).toBe(1);
    expect(summary.completionPct).toBe(75); // (100 + 50) / 2
    expect(summary.gradeAverage).toBe(90);
    expect(summary.gradeVsTarget).toBe(5);
  });
});

describe("overall roll-up", () => {
  it("credit-weights the grade average across courses", () => {
    const courses = [
      course({ id: "a", code: "CS101", credits: 3, targetGrade: null }),
      course({ id: "b", code: "MATH200", credits: 1, targetGrade: null }),
    ];
    const homework = [
      hw({ courseCode: "CS101", status: "graded", grade: 90 }),
      hw({ courseCode: "MATH200", status: "graded", grade: 70 }),
    ];
    const { overall, perCourse } = buildCourseSummaries(courses, [], homework, NOW);
    expect(overall.courseCount).toBe(2);
    expect(overall.totalCredits).toBe(4);
    expect(overall.completionPct).toBe(100);
    // (90*3 + 70*1) / 4 = 85
    expect(overall.creditWeightedGradeAverage).toBe(85);
    expect(overallGradeAverage(perCourse)).toBe(85);
  });

  it("returns null overall average when no graded course has credits", () => {
    const courses = [course({ credits: null })];
    const homework = [hw({ status: "graded", grade: 90 })];
    const { overall } = buildCourseSummaries(courses, [], homework, NOW);
    expect(overall.creditWeightedGradeAverage).toBeNull();
  });
});
