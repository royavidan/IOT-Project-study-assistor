import { describe, expect, it } from "vitest";

import { externalLoadFromSchedule } from "@/features/insights/schedule-load";
import { LECTURE_PASSIVE_FACTOR } from "@/lib/study-strain";
import type { ScheduleEvent } from "@/features/schedule/schedule";

function event(over: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    title: "Course",
    courseCode: null,
    location: null,
    color: "#6366f1",
    category: "class",
    subtype: "lecture",
    kind: "once",
    dayOfWeek: null,
    eventDate: "2026-06-02",
    startTime: "09:00",
    endTime: "11:00",
    notes: null,
    examWeight: null,
    examScore: null,
    planGenerated: false,
    ...over,
  };
}

describe("externalLoadFromSchedule", () => {
  it("converts an attended class to a dated entry, passive-weighted", () => {
    const loads = externalLoadFromSchedule(
      [event({ title: "Algorithms", startTime: "09:00", endTime: "11:00" })],
      "2026-06-01",
      "2026-06-07",
    );
    expect(loads).toHaveLength(1);
    expect(loads[0].kind).toBe("dated");
    expect(loads[0].date).toBe("2026-06-02");
    // 2h × passive factor
    expect(loads[0].hours).toBeCloseTo(2 * LECTURE_PASSIVE_FACTOR, 5);
    expect(loads[0].label).toBe("Algorithms");
  });

  it("counts lectures, tutorials and labs but ignores exams and study blocks", () => {
    const loads = externalLoadFromSchedule(
      [
        event({ subtype: "lecture" }),
        event({ subtype: "tutorial" }),
        event({ subtype: "lab" }),
        event({ category: "exam", subtype: null }),
        event({ category: "study", subtype: null }),
      ],
      "2026-06-01",
      "2026-06-07",
    );
    expect(loads).toHaveLength(3);
  });

  it("expands weekly classes across the window", () => {
    // 2026-06-01 is a Monday; a Monday weekly class over two weeks → two dates.
    const loads = externalLoadFromSchedule(
      [
        event({
          kind: "weekly",
          dayOfWeek: 1,
          eventDate: null,
          startTime: "10:00",
          endTime: "12:00",
        }),
      ],
      "2026-06-01",
      "2026-06-14",
    );
    expect(loads).toHaveLength(2);
    expect(loads.every((l) => Math.abs(l.hours - 2 * LECTURE_PASSIVE_FACTOR) < 1e-9)).toBe(true);
  });

  it("skips zero-length or malformed times", () => {
    const loads = externalLoadFromSchedule(
      [event({ startTime: "10:00", endTime: "10:00" })],
      "2026-06-01",
      "2026-06-07",
    );
    expect(loads).toHaveLength(0);
  });
});
