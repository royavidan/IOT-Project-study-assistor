import { describe, expect, it } from "vitest";

import {
  buildGradeBreakdown,
  componentContributionLabel,
  contribution,
  examChoices,
  projectFinalWithExam,
} from "@/features/courses/grades";
import type { ScheduleEvent } from "@/features/schedule/schedule";
import type { HomeworkAssignment } from "@/lib/types";

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

function exam(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: Math.random().toString(36).slice(2),
    title: "Exam",
    courseCode: "CS101",
    location: null,
    color: "#6366f1",
    category: "exam",
    subtype: null,
    kind: "once",
    dayOfWeek: null,
    eventDate: "2026-08-01",
    startTime: "09:00",
    endTime: "12:00",
    notes: null,
    examWeight: null,
    examScore: null,
    ...overrides,
  };
}

describe("grade contribution", () => {
  it("computes points earned: 80 on a 5-point item = 4 / 5", () => {
    expect(contribution({ weight: 5, score: 80 })).toBe(4);
    expect(componentContributionLabel({ weight: 5, score: 80 })).toBe("4 / 5");
  });

  it("unscored items contribute 0", () => {
    expect(contribution({ weight: 90, score: null })).toBe(0);
  });
});

describe("buildGradeBreakdown", () => {
  it("sums assigned weight and earned points, excluding null-weight items", () => {
    const homework = [
      hw({ status: "graded", grade: 80, weight: 5 }),
      hw({ status: "graded", grade: 90, weight: 5 }),
      hw({ status: "pending", weight: null }), // no weight → excluded
      hw({ status: "submitted", weight: 10 }), // weighted but unscored
    ];
    const exams = [exam({ examWeight: 90 })]; // weighted, unscored
    const b = buildGradeBreakdown(homework, exams);

    expect(b.components).toHaveLength(4); // 3 weighted hw + 1 exam
    expect(b.assignedWeight).toBe(110); // 5 + 5 + 10 + 90
    expect(b.scoredWeight).toBe(10); // only the two graded hw
    expect(b.earnedPoints).toBe(8.5); // 4 + 4.5
  });
});

describe("projectFinalWithExam", () => {
  it("projects final = scored contributions + hypothetical exam contribution", () => {
    const homework = [
      hw({ status: "graded", grade: 80, weight: 5 }),
      hw({ status: "graded", grade: 90, weight: 5 }),
    ];
    const exams = [exam({ id: "e1", examWeight: 90 })];
    const b = buildGradeBreakdown(homework, exams);

    // earned 8.5 + 0.85 * 90 = 8.5 + 76.5 = 85
    expect(projectFinalWithExam(b, "exam:e1", 85)).toBe(85);
    // earned 8.5 + 0.70 * 90 = 8.5 + 63 = 71.5
    expect(projectFinalWithExam(b, "exam:e1", 70)).toBe(71.5);
  });

  it("replaces an already-scored exam's contribution when projecting it", () => {
    const exams = [exam({ id: "e1", examWeight: 100, examScore: 50 })];
    const b = buildGradeBreakdown([], exams);
    expect(b.earnedPoints).toBe(50);
    expect(projectFinalWithExam(b, "exam:e1", 90)).toBe(90); // not 50 + 90
  });

  it("lists exam choices for the picker by id", () => {
    const exams = [
      exam({ id: "a", title: "Moed A", examWeight: 90 }),
      exam({ id: "b", title: "Moed B", examWeight: 90 }),
    ];
    const b = buildGradeBreakdown([], exams);
    expect(examChoices(b).map((c) => c.id)).toEqual(["exam:a", "exam:b"]);
  });
});
