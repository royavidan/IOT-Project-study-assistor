import { describe, expect, it } from "vitest";

import { planFingerprint } from "@/features/planner/fingerprint";
import type { ScheduleEvent } from "@/features/schedule/schedule";
import type { HomeworkAssignment } from "@/lib/types";

function event(over: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: over.id ?? "e1",
    title: over.title ?? "Algebra",
    courseCode: "MATH1",
    location: null,
    color: "#6366f1",
    category: over.category ?? "class",
    subtype: null,
    kind: over.kind ?? "weekly",
    dayOfWeek: over.dayOfWeek ?? 1,
    eventDate: over.eventDate ?? null,
    startTime: over.startTime ?? "10:00",
    endTime: over.endTime ?? "12:00",
    notes: null,
    examWeight: null,
    examScore: null,
    planGenerated: over.planGenerated ?? false,
  };
}

function hw(over: Partial<HomeworkAssignment> = {}): HomeworkAssignment {
  return {
    id: over.id ?? "hw1",
    courseCode: "MATH1",
    title: "HW 3",
    description: null,
    dueDate: over.dueDate ?? "2026-06-08",
    status: over.status ?? "pending",
    fileUrl: null,
    fileName: null,
    fileSizeBytes: null,
    grade: null,
    progressPct: over.progressPct ?? null,
    weight: null,
    estimatedMinutes: over.estimatedMinutes ?? null,
    notes: null,
    createdAt: "",
    updatedAt: "",
  };
}

describe("planFingerprint", () => {
  it("is stable across input ordering", () => {
    const a = planFingerprint([event({ id: "a" }), event({ id: "b" })], [hw()]);
    const b = planFingerprint([event({ id: "b" }), event({ id: "a" })], [hw()]);
    expect(a).toBe(b);
  });

  it("changes when an event time changes", () => {
    const before = planFingerprint([event()], []);
    const after = planFingerprint([event({ startTime: "11:00" })], []);
    expect(before).not.toBe(after);
  });

  it("changes when homework due date or progress changes", () => {
    const base = planFingerprint([], [hw()]);
    expect(planFingerprint([], [hw({ dueDate: "2026-06-09" })])).not.toBe(base);
    expect(planFingerprint([], [hw({ progressPct: 50 })])).not.toBe(base);
  });

  it("ignores planner-generated study blocks (committing a plan isn't staleness)", () => {
    const generated = event({
      id: "gen1",
      category: "study",
      kind: "once",
      eventDate: "2026-06-02",
      planGenerated: true,
    });
    expect(planFingerprint([event(), generated], [hw()])).toBe(planFingerprint([event()], [hw()]));
  });

  it("still counts hand-made study blocks", () => {
    const handMade = event({
      id: "own1",
      category: "study",
      kind: "once",
      eventDate: "2026-06-02",
      planGenerated: false,
    });
    expect(planFingerprint([event(), handMade], [])).not.toBe(planFingerprint([event()], []));
  });
});
