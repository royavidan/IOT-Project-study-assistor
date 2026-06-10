import { describe, expect, it } from "vitest";

import {
  buildCourseEvents,
  buildDayAgenda,
  countdownLabel,
  daysUntil,
  expandScheduleEvents,
  meetingTypeLabel,
  parseTimeToMinutes,
  upcomingExams,
  validateScheduleTimes,
  weekDateKeys,
} from "@/lib/schedule";
import type { ScheduleEvent } from "@/lib/schedule";
import type { Session } from "@/lib/types";

const weeklyLecture: ScheduleEvent = {
  id: "a",
  title: "Algorithms",
  courseCode: "CS301",
  location: "Room 12",
  color: "#6366f1",
  category: "class",
  subtype: "lecture",
  kind: "weekly",
  dayOfWeek: 1,
  eventDate: null,
  startTime: "09:00",
  endTime: "10:30",
  notes: null,
};

describe("schedule helpers", () => {
  it("parses and validates times", () => {
    expect(parseTimeToMinutes("09:30")).toBe(570);
    expect(parseTimeToMinutes("24:00")).toBeNull();
    expect(validateScheduleTimes("09:00", "10:00")).toBeNull();
    expect(validateScheduleTimes("10:00", "09:00")).toMatch(/after/);
  });

  it("expands weekly events across a range", () => {
    const expanded = expandScheduleEvents([weeklyLecture], "2026-06-01", "2026-06-14");
    const mondays = expanded.filter((o) => o.date.endsWith("-02") || o.date.endsWith("-09"));
    expect(expanded.length).toBeGreaterThanOrEqual(2);
    expect(mondays.every((o) => o.title === "Algorithms")).toBe(true);
  });

  it("includes one-off events on their date only", () => {
    const exam: ScheduleEvent = {
      ...weeklyLecture,
      id: "b",
      kind: "once",
      dayOfWeek: null,
      eventDate: "2026-06-05",
      title: "Midterm",
    };
    const expanded = expandScheduleEvents([exam], "2026-06-01", "2026-06-14");
    expect(expanded).toHaveLength(1);
    expect(expanded[0]?.title).toBe("Midterm");
  });

  it("merges courses and focus sessions into a day agenda", () => {
    const expanded = expandScheduleEvents([weeklyLecture], "2026-06-01", "2026-06-01");
    const session: Session = {
      id: "s1",
      date: "2026-06-01",
      start: "14:00",
      durationMin: 45,
      mode: "Study",
      status: "completed",
      focusScore: 80,
      breaks: 1,
      subject: "Study",
      noiseAvg: null,
      tempC: null,
      lightLux: null,
      presenceInterruptions: 0,
    };
    const agenda = buildDayAgenda(expanded, [session], "2026-06-01");
    expect(agenda).toHaveLength(2);
    expect(agenda[0]?.type).toBe("course");
    expect(agenda[1]?.type).toBe("focus");
  });

  it("builds a Monday-based week", () => {
    expect(weekDateKeys("2026-06-04")).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
    ]);
  });
});

describe("semester bounds + exams", () => {
  it("bounds weekly classes to the semester term", () => {
    const within = expandScheduleEvents([weeklyLecture], "2026-06-01", "2026-06-30", {
      start: "2026-06-08",
      end: "2026-06-15",
    });
    // June 2026 Mondays: 1, 8, 15, 22, 29 — only 8 & 15 fall in the term.
    expect(within.map((o) => o.date)).toEqual(["2026-06-08", "2026-06-15"]);
  });

  it("never bounds one-off events to the semester term", () => {
    const exam = {
      ...weeklyLecture,
      id: "x",
      kind: "once" as const,
      dayOfWeek: null,
      eventDate: "2026-07-01",
      category: "exam" as const,
      title: "Final",
    };
    const expanded = expandScheduleEvents([exam], "2026-06-01", "2026-12-31", {
      start: "2026-06-01",
      end: "2026-06-30",
    });
    expect(expanded).toHaveLength(1);
    expect(expanded[0]?.category).toBe("exam");
  });

  it("computes days until and countdown labels", () => {
    const now = new Date(2026, 5, 10);
    expect(daysUntil("2026-06-10", now)).toBe(0);
    expect(daysUntil("2026-06-13", now)).toBe(3);
    expect(countdownLabel("2026-06-10", now)).toBe("Today");
    expect(countdownLabel("2026-06-11", now)).toBe("Tomorrow");
    expect(countdownLabel("2026-06-13", now)).toMatch(/in 3 days/);
  });

  it("lists upcoming exams soonest first, excluding past and non-exams", () => {
    const now = new Date(2026, 5, 10);
    const mk = (id: string, date: string, title: string) => ({
      ...weeklyLecture,
      id,
      kind: "once" as const,
      dayOfWeek: null,
      eventDate: date,
      category: "exam" as const,
      title,
    });
    const list = upcomingExams(
      [
        mk("e2", "2026-06-20", "Final"),
        mk("e1", "2026-06-12", "Midterm"),
        mk("p1", "2026-06-01", "Past"),
        weeklyLecture,
      ],
      now,
    );
    expect(list.map((u) => u.event.title)).toEqual(["Midterm", "Final"]);
    expect(list[0]?.daysUntil).toBe(2);
  });
});

describe("course builder", () => {
  it("expands a course into weekly meetings + dated exams", () => {
    const events = buildCourseEvents({
      name: "Algorithms",
      courseCode: "CS301",
      color: "#6366f1",
      notes: "",
      meetings: [
        { subtype: "lecture", dayOfWeek: 1, startTime: "09:00", endTime: "10:30", location: "R12" },
        { subtype: "lecture", dayOfWeek: 3, startTime: "09:00", endTime: "10:30", location: "R12" },
        { subtype: "tutorial", dayOfWeek: 4, startTime: "14:00", endTime: "15:00", location: "" },
      ],
      exams: [{ title: "Final", eventDate: "2026-07-01", startTime: "09:00", endTime: "11:00" }],
    });

    expect(events).toHaveLength(4);
    const classes = events.filter((e) => e.category === "class");
    expect(classes).toHaveLength(3);
    expect(classes.every((e) => e.kind === "weekly" && e.title === "Algorithms")).toBe(true);
    expect(classes.map((e) => e.subtype)).toEqual(["lecture", "lecture", "tutorial"]);

    const exam = events.find((e) => e.category === "exam");
    expect(exam?.kind).toBe("once");
    expect(exam?.eventDate).toBe("2026-07-01");
    expect(exam?.title).toBe("Algorithms — Final");
    expect(exam?.subtype).toBeNull();
  });

  it("labels meeting types", () => {
    expect(meetingTypeLabel("lecture")).toBe("Lecture");
    expect(meetingTypeLabel("tutorial")).toBe("Tutorial");
    expect(meetingTypeLabel(null)).toBe("Class");
  });
});
