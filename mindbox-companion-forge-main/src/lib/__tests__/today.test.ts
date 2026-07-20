import { describe, expect, it } from "vitest";

import {
  completedStepCount,
  courseSnapshot,
  dueSoon,
  greetingFor,
  isEngaged,
  nextExam,
  onboardingSteps,
  pickNextAction,
  pickUrgentCourse,
  todaysOccurrences,
} from "@/features/dashboard/today";
import type { CourseSummary, OverallSummary } from "@/features/courses/courses";
import type { ScheduleEvent } from "@/features/schedule/schedule";
import { toDateKey } from "@/lib/dates";
import type { HomeworkAssignment } from "@/lib/types";

// Fixed "today" so day-math is deterministic (local time on both sides).
const NOW = new Date(2026, 5, 29, 12, 0, 0); // 2026-06-29
const TODAY = toDateKey(NOW); // "2026-06-29"

function hw(overrides: Partial<HomeworkAssignment> = {}): HomeworkAssignment {
  return {
    id: Math.random().toString(36).slice(2),
    courseCode: "CS101",
    title: "HW",
    description: null,
    dueDate: TODAY,
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

function event(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: Math.random().toString(36).slice(2),
    title: "CS101",
    courseCode: "CS101",
    location: null,
    color: "#6366f1",
    category: "class",
    subtype: "lecture",
    kind: "weekly",
    dayOfWeek: NOW.getDay(),
    eventDate: null,
    startTime: "10:00",
    endTime: "12:00",
    notes: null,
    examWeight: null,
    examScore: null,
    ...overrides,
  };
}

function summary(overrides: Partial<CourseSummary> = {}): CourseSummary {
  return {
    course: {
      id: Math.random().toString(36).slice(2),
      code: "CS101",
      name: "Intro",
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
    },
    meetings: { lecture: 0, tutorial: 0, lab: 0, total: 0 },
    examCount: 0,
    nextExam: null,
    homeworkTotal: 0,
    homeworkByStatus: { pending: 0, submitted: 0, graded: 0 },
    completionPct: 0,
    gradeAverage: null,
    targetGrade: null,
    gradeVsTarget: null,
    gradeBreakdown: { components: [], assignedWeight: 0, scoredWeight: 0, earnedPoints: 0 },
    ...overrides,
  };
}

describe("todaysOccurrences", () => {
  it("returns weekly classes on today's weekday and one-off exams dated today, time-sorted", () => {
    const events = [
      event({ startTime: "14:00", endTime: "16:00", title: "Late" }),
      event({ startTime: "09:00", endTime: "10:00", title: "Early" }),
      event({ dayOfWeek: (NOW.getDay() + 1) % 7, title: "Tomorrow's class" }),
      event({
        category: "exam",
        subtype: null,
        kind: "once",
        dayOfWeek: null,
        eventDate: TODAY,
        startTime: "16:00",
        endTime: "18:00",
        title: "Exam today",
      }),
    ];
    const occ = todaysOccurrences(events, TODAY);
    expect(occ.map((o) => o.title)).toEqual(["Early", "Late", "Exam today"]);
  });
});

describe("dueSoon", () => {
  it("includes overdue + due-within-horizon, excludes finished and far-future, soonest first", () => {
    const items = [
      hw({ title: "overdue", dueDate: "2026-06-27" }),
      hw({ title: "today", dueDate: TODAY }),
      hw({ title: "in 3 days", dueDate: "2026-07-02" }),
      hw({ title: "far", dueDate: "2026-07-20" }),
      hw({ title: "done", dueDate: TODAY, status: "graded", grade: 95 }),
      hw({ title: "manual-100", dueDate: TODAY, progressPct: 100 }),
    ];
    const due = dueSoon(items, 7, NOW);
    expect(due.map((d) => d.hw.title)).toEqual(["overdue", "today", "in 3 days"]);
    expect(due[0].overdue).toBe(true);
    expect(due[1].overdue).toBe(false);
  });
});

describe("nextExam", () => {
  it("returns the soonest future exam", () => {
    const events = [
      event({
        category: "exam",
        kind: "once",
        dayOfWeek: null,
        eventDate: "2026-07-10",
        title: "B",
      }),
      event({
        category: "exam",
        kind: "once",
        dayOfWeek: null,
        eventDate: "2026-07-01",
        title: "A",
      }),
      event({
        category: "exam",
        kind: "once",
        dayOfWeek: null,
        eventDate: "2026-06-01",
        title: "past",
      }),
    ];
    expect(nextExam(events, NOW)?.event.title).toBe("A");
  });
});

describe("pickNextAction", () => {
  it("prioritises an overdue/due-today assignment over a near exam", () => {
    const due = dueSoon([hw({ title: "due today", dueDate: TODAY })], 7, NOW);
    const exam = nextExam(
      [event({ category: "exam", kind: "once", dayOfWeek: null, eventDate: "2026-07-02" })],
      NOW,
    );
    const action = pickNextAction(due, exam);
    expect(action.kind).toBe("homework");
  });

  it("picks an exam within a week when nothing is due yet", () => {
    const due = dueSoon([hw({ title: "later", dueDate: "2026-07-05" })], 3, NOW); // empty (horizon 3)
    const exam = nextExam(
      [event({ category: "exam", kind: "once", dayOfWeek: null, eventDate: "2026-07-03" })],
      NOW,
    );
    expect(pickNextAction(due, exam).kind).toBe("exam");
  });

  it("falls back to a session nudge when nothing is pending", () => {
    expect(pickNextAction([], null).kind).toBe("session");
  });
});

describe("pickUrgentCourse / courseSnapshot", () => {
  it("prefers the course with the soonest exam", () => {
    const a = summary({
      nextExam: { event: event({ category: "exam" }), dateKey: "2026-07-10", daysUntil: 11 },
    });
    const b = summary({
      nextExam: { event: event({ category: "exam" }), dateKey: "2026-07-02", daysUntil: 3 },
    });
    const picked = pickUrgentCourse([a, b]);
    expect(picked?.reason).toBe("exam");
    expect(picked?.summary).toBe(b);
  });

  it("falls back to the least-finished course with outstanding homework", () => {
    const a = summary({ homeworkTotal: 4, completionPct: 80 });
    const b = summary({ homeworkTotal: 4, completionPct: 25 });
    const done = summary({ homeworkTotal: 2, completionPct: 100 });
    const picked = pickUrgentCourse([a, done, b]);
    expect(picked?.reason).toBe("homework");
    expect(picked?.summary).toBe(b);
  });

  it("returns null when nothing is pressing, and wraps overall in courseSnapshot", () => {
    const overall: OverallSummary = {
      courseCount: 1,
      totalCredits: 3,
      homeworkTotal: 0,
      completionPct: 0,
      creditWeightedGradeAverage: null,
    };
    const snap = courseSnapshot(overall, [summary()]);
    expect(snap.urgent).toBeNull();
    expect(snap.overall).toBe(overall);
  });
});

describe("greetingFor", () => {
  it("varies by time of day and includes the name", () => {
    expect(greetingFor("Taiyo", new Date(2026, 5, 29, 9))).toBe("Good morning, Taiyo");
    expect(greetingFor("Taiyo", new Date(2026, 5, 29, 14))).toBe("Good afternoon, Taiyo");
    expect(greetingFor("Taiyo", new Date(2026, 5, 29, 20))).toBe("Good evening, Taiyo");
  });

  it("drops the name when empty/blank", () => {
    expect(greetingFor(null, new Date(2026, 5, 29, 9))).toBe("Good morning");
    expect(greetingFor("  ", new Date(2026, 5, 29, 20))).toBe("Good evening");
  });
});

describe("onboarding / engagement", () => {
  it("marks each step done from real data and counts completion", () => {
    const steps = onboardingSteps({
      hasCourses: true,
      hasSchedule: true,
      hasDevice: false,
      hasSessions: false,
    });
    expect(steps.map((s) => s.key)).toEqual(["courses", "schedule", "device", "session"]);
    expect(steps.find((s) => s.key === "courses")?.done).toBe(true);
    expect(steps.find((s) => s.key === "device")?.done).toBe(false);
    expect(completedStepCount(steps)).toBe(2);
  });

  it("isEngaged is true once a device is paired OR a session exists", () => {
    expect(isEngaged({ hasDevice: false, hasSessions: false })).toBe(false);
    expect(isEngaged({ hasDevice: true, hasSessions: false })).toBe(true);
    expect(isEngaged({ hasDevice: false, hasSessions: true })).toBe(true);
  });
});
