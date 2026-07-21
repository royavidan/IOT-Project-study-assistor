import { describe, expect, it } from "vitest";

import {
  addDaysKey,
  busyIntervalsForDay,
  examReviewOffsets,
  freeSlotsForDay,
  heuristicHomeworkMinutes,
  lectureBacklogFor,
  MEAL_BREAKS,
  mergeOverlaps,
  minutesToTime,
  planStudyBlocks,
  quietIntervalsWithin,
  urgencyFromDays,
  weekKeyFor,
  type PlanInput,
} from "@/features/planner/planner";
import type { ScheduleEvent, ScheduleOccurrence } from "@/features/schedule/schedule";
import type { Course } from "@/features/courses/courses";
import { toDateKey } from "@/lib/dates";
import type { HomeworkAssignment, Session } from "@/lib/types";

// Fixed "today" — 2026-06-01 is a Monday; 09:00 local so the today-window clamp
// leaves the whole default 09:00–21:00 window free.
const NOW = new Date(2026, 5, 1, 9, 0, 0);
const TODAY = toDateKey(NOW); // "2026-06-01"

function occ(
  date: string,
  startTime: string,
  endTime: string,
  over: Partial<ScheduleOccurrence> = {},
): ScheduleOccurrence {
  return {
    occurrenceKey: `${over.eventId ?? "e"}:${date}`,
    eventId: over.eventId ?? "e",
    date,
    title: over.title ?? "Class",
    courseCode: over.courseCode ?? "CS101",
    location: null,
    color: "#000",
    category: over.category ?? "class",
    subtype: over.subtype ?? "lecture",
    startTime,
    endTime,
    notes: null,
    kind: over.kind ?? "weekly",
    planGenerated: over.planGenerated ?? false,
  };
}

function hw(over: Partial<HomeworkAssignment> = {}): HomeworkAssignment {
  return {
    id: over.id ?? "hw1",
    courseCode: "CS101",
    title: over.title ?? "Assignment",
    description: null,
    dueDate: over.dueDate ?? addDaysKey(TODAY, 5),
    status: over.status ?? "pending",
    fileUrl: null,
    fileName: null,
    fileSizeBytes: null,
    grade: null,
    progressPct: over.progressPct ?? null,
    weight: over.weight ?? null,
    estimatedMinutes: over.estimatedMinutes ?? null,
    notes: null,
    createdAt: "",
    updatedAt: "",
  };
}

function examEvent(over: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: over.id ?? "exam1",
    title: over.title ?? "Midterm",
    courseCode: "CS101",
    location: null,
    color: "#f00",
    category: "exam",
    subtype: null,
    kind: "once",
    dayOfWeek: null,
    eventDate: over.eventDate ?? addDaysKey(TODAY, 10),
    startTime: over.startTime ?? "10:00",
    endTime: over.endTime ?? "12:00",
    notes: null,
    examWeight: over.examWeight ?? null,
    examScore: null,
  };
}

function course(over: Partial<Course> = {}): Course {
  return {
    id: over.id ?? "c1",
    code: over.code ?? "CS101",
    name: over.name ?? "Intro CS",
    color: over.color ?? "#0ea5e9",
    instructor: null,
    credits: null,
    targetGrade: null,
    notes: null,
    watchedLectures: over.watchedLectures ?? 0,
    watchedTutorials: over.watchedTutorials ?? 0,
    watchedLabs: over.watchedLabs ?? 0,
    createdAt: "",
    updatedAt: "",
  };
}

function classEvent(over: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: over.id ?? "cls1",
    title: over.title ?? "Lecture",
    courseCode: over.courseCode ?? "CS101",
    location: null,
    color: "#000",
    category: "class",
    subtype: over.subtype ?? "lecture",
    kind: over.kind ?? "weekly",
    dayOfWeek: over.dayOfWeek ?? 1, // Monday
    eventDate: over.eventDate ?? null,
    startTime: over.startTime ?? "10:00",
    endTime: over.endTime ?? "11:00",
    notes: null,
    examWeight: null,
    examScore: null,
  };
}

function baseInput(over: Partial<PlanInput> = {}): PlanInput {
  return {
    now: NOW,
    horizonDays: 14,
    events: [],
    sessions: [],
    homework: [],
    mode: "balanced",
    dayStartMin: 9 * 60,
    dayEndMin: 21 * 60,
    quietStart: null,
    quietEnd: null,
    semesterStart: null,
    semesterEnd: null,
    recovery: null,
    bestWindow: null,
    ...over,
  };
}

describe("time helpers", () => {
  it("minutesToTime formats and clamps", () => {
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(9 * 60 + 5)).toBe("09:05");
    expect(minutesToTime(14 * 60 + 30)).toBe("14:30");
  });

  it("addDaysKey / weekKeyFor are Sunday-based", () => {
    expect(addDaysKey("2026-06-01", 5)).toBe("2026-06-06");
    // 2026-06-01 is a Monday → its week starts Sunday 2026-05-31.
    expect(weekKeyFor("2026-06-01")).toBe("2026-05-31");
  });

  it("mergeOverlaps merges touching + overlapping intervals", () => {
    expect(
      mergeOverlaps([
        { start: 100, end: 200 },
        { start: 180, end: 240 },
        { start: 240, end: 300 },
        { start: 400, end: 450 },
      ]),
    ).toEqual([
      { start: 100, end: 300 },
      { start: 400, end: 450 },
    ]);
  });
});

describe("quietIntervalsWithin", () => {
  it("returns empty when unset or equal", () => {
    expect(quietIntervalsWithin(null, 60)).toEqual([]);
    expect(quietIntervalsWithin(60, 60)).toEqual([]);
  });

  it("same-day window is one interval", () => {
    expect(quietIntervalsWithin(13 * 60, 14 * 60)).toEqual([{ start: 780, end: 840 }]);
  });

  it("overnight window splits into two", () => {
    expect(quietIntervalsWithin(22 * 60, 7 * 60)).toEqual([
      { start: 0, end: 420 },
      { start: 1320, end: 1440 },
    ]);
  });
});

describe("freeSlotsForDay", () => {
  const opts = {
    dayStartMin: 9 * 60,
    dayEndMin: 21 * 60,
    quietStart: null,
    quietEnd: null,
    minSlotMin: 50,
  };

  it("empty day → one big slot", () => {
    expect(freeSlotsForDay([], opts)).toEqual([{ start: 540, end: 1260 }]);
  });

  it("reserves the default meal windows (lunch + dinner)", () => {
    // Empty day, but MEAL_BREAKS carves out 12:30–13:30 and 18:30–19:30.
    const withMeals = freeSlotsForDay([], { ...opts, meals: MEAL_BREAKS });
    expect(withMeals).toEqual([
      { start: 540, end: 750 }, // 09:00–12:30 (before lunch)
      { start: 810, end: 1110 }, // 13:30–18:30 (after lunch, before dinner)
      { start: 1170, end: 1260 }, // 19:30–21:00 (after dinner)
    ]);
  });

  it("inverts a busy interval into gaps", () => {
    const slots = freeSlotsForDay([{ start: 10 * 60, end: 12 * 60 }], opts);
    expect(slots).toEqual([
      { start: 540, end: 600 },
      { start: 720, end: 1260 },
    ]);
  });

  it("clamps an event crossing the window start", () => {
    // Class 08:00–09:30 leaves 09:30–21:00 free (09:00–09:30 stays busy).
    const slots = freeSlotsForDay([{ start: 8 * 60, end: 9 * 60 + 30 }], opts);
    expect(slots).toEqual([{ start: 570, end: 1260 }]);
  });

  it("merges overlapping busy intervals before inverting", () => {
    const slots = freeSlotsForDay(
      [
        { start: 10 * 60, end: 12 * 60 },
        { start: 11 * 60, end: 13 * 60 },
      ],
      opts,
    );
    expect(slots).toEqual([
      { start: 540, end: 600 },
      { start: 780, end: 1260 },
    ]);
  });

  it("subtracts overnight quiet hours inside the window", () => {
    // Window 08:00–23:00, quiet 22:00–07:00 → lose 22:00–23:00.
    const slots = freeSlotsForDay([], {
      dayStartMin: 8 * 60,
      dayEndMin: 23 * 60,
      quietStart: 22 * 60,
      quietEnd: 7 * 60,
      minSlotMin: 50,
    });
    expect(slots).toEqual([{ start: 480, end: 1320 }]);
  });

  it("drops gaps shorter than minSlotMin", () => {
    // Only a 40-min gap remains before the block; 50-min min filters it out.
    const slots = freeSlotsForDay([{ start: 9 * 60 + 40, end: 20 * 60 }], opts);
    expect(slots).toEqual([{ start: 1200, end: 1260 }]);
  });

  it("fully-blocked day yields no slots", () => {
    expect(freeSlotsForDay([{ start: 9 * 60, end: 21 * 60 }], opts)).toEqual([]);
  });
});

describe("busyIntervalsForDay", () => {
  it("includes classes and today's past sessions; reports bad times", () => {
    const warnings: string[] = [];
    const occs = [occ(TODAY, "10:00", "11:00"), occ(TODAY, "13:00", "12:00", { title: "Bad" })];
    const sessions: Session[] = [
      {
        id: "s1",
        date: TODAY,
        start: "15:00",
        durationMin: 60,
        mode: "Study",
        status: "completed",
        focusScore: 80,
        breaks: 0,
        subject: "x",
        noiseAvg: null,
        tempC: null,
        lightLux: null,
        presenceInterruptions: 0,
      },
    ];
    const busy = busyIntervalsForDay(occs, sessions, TODAY, warnings);
    expect(busy).toEqual([
      { start: 600, end: 660 },
      { start: 900, end: 960 },
    ]);
    expect(warnings.some((w) => w.includes("Bad"))).toBe(true);
  });
});

describe("examReviewOffsets", () => {
  it("compresses when the exam is < 7 days out", () => {
    expect(examReviewOffsets(5)).toEqual([3, 2, 1]);
  });
  it("standard 1/3/7/14 for 7–21 days", () => {
    expect(examReviewOffsets(14)).toEqual([14, 7, 3, 1]);
    expect(examReviewOffsets(10)).toEqual([7, 3, 1]);
  });
  it("extends with 30/60 when far out", () => {
    expect(examReviewOffsets(40)).toEqual([30, 14, 7, 3, 1]);
    expect(examReviewOffsets(90)).toEqual([60, 30, 14, 7, 3, 1]);
  });
  it("returns nothing for an exam today/past", () => {
    expect(examReviewOffsets(0)).toEqual([]);
  });
});

describe("scoring helpers", () => {
  it("urgency buckets by days-until", () => {
    expect(urgencyFromDays(0)).toBe(10);
    expect(urgencyFromDays(3)).toBe(8);
    expect(urgencyFromDays(7)).toBe(6);
    expect(urgencyFromDays(14)).toBe(4);
    expect(urgencyFromDays(30)).toBe(2);
  });
  it("heuristic homework minutes scale with weight", () => {
    expect(heuristicHomeworkMinutes(null)).toBe(60);
    expect(heuristicHomeworkMinutes(5)).toBe(60);
    expect(heuristicHomeworkMinutes(10)).toBe(120);
    expect(heuristicHomeworkMinutes(25)).toBe(180);
  });
});

describe("planStudyBlocks", () => {
  it("schedules homework as study blocks before its deadline, none on/after it", () => {
    const input = baseInput({
      homework: [hw({ dueDate: addDaysKey(TODAY, 3), estimatedMinutes: 100, weight: 10 })],
    });
    const plan = planStudyBlocks(input);
    expect(plan.blocks.length).toBeGreaterThan(0);
    const deadline = addDaysKey(TODAY, 3);
    for (const b of plan.blocks) {
      expect(b.dateKey < deadline).toBe(true);
      expect(b.taskKind).toBe("homework");
    }
  });

  it("front-loads: earlier days carry at least as much as later days", () => {
    const input = baseInput({
      horizonDays: 8,
      homework: [hw({ dueDate: addDaysKey(TODAY, 6), estimatedMinutes: 500, weight: 10 })],
    });
    const plan = planStudyBlocks(input);
    const perDay = new Map<string, number>();
    for (const b of plan.blocks) perDay.set(b.dateKey, (perDay.get(b.dateKey) ?? 0) + 1);
    const days = [...perDay.keys()].sort();
    for (let i = 1; i < days.length; i += 1) {
      expect(perDay.get(days[0])!).toBeGreaterThanOrEqual(perDay.get(days[i])!);
    }
  });

  it("never schedules in the past on today (window clamps to now)", () => {
    const afternoon = new Date(2026, 5, 1, 19, 30, 0); // 19:30, only 90 min left before 21:00
    const input = baseInput({
      now: afternoon,
      homework: [hw({ dueDate: addDaysKey(TODAY, 1), estimatedMinutes: 300, weight: 20 })],
    });
    const plan = planStudyBlocks(input);
    const todays = plan.blocks.filter((b) => b.dateKey === TODAY);
    for (const b of todays) expect(b.startTime >= "19:30").toBe(true);
  });

  it("respects the daily cap (balanced = 240 min)", () => {
    const input = baseInput({
      horizonDays: 4,
      homework: [hw({ dueDate: addDaysKey(TODAY, 3), estimatedMinutes: 3000, weight: 30 })],
    });
    const plan = planStudyBlocks(input);
    const perDay = new Map<string, number>();
    for (const b of plan.blocks) perDay.set(b.dateKey, (perDay.get(b.dateKey) ?? 0) + 50);
    for (const mins of perDay.values()) expect(mins).toBeLessThanOrEqual(240);
  });

  it("deep_focus caps at 2 blocks/day", () => {
    const input = baseInput({
      mode: "deep_focus",
      horizonDays: 5,
      homework: [hw({ dueDate: addDaysKey(TODAY, 4), estimatedMinutes: 3000, weight: 30 })],
    });
    const plan = planStudyBlocks(input);
    const perDay = new Map<string, number>();
    for (const b of plan.blocks) perDay.set(b.dateKey, (perDay.get(b.dateKey) ?? 0) + 1);
    for (const n of perDay.values()) expect(n).toBeLessThanOrEqual(2);
  });

  it("throttles ~25% when recovery is ready && strained", () => {
    const hwItem = hw({ dueDate: addDaysKey(TODAY, 6), estimatedMinutes: 600, weight: 10 });
    const normal = planStudyBlocks(baseInput({ horizonDays: 8, homework: [hwItem] }));
    const strained = planStudyBlocks(
      baseInput({
        horizonDays: 8,
        homework: [hwItem],
        recovery: { ready: true, status: "strained" },
      }),
    );
    expect(strained.totalPlannedMin).toBeLessThan(normal.totalPlannedMin);
  });

  it("places spaced exam-review blocks before an exam", () => {
    const input = baseInput({
      horizonDays: 14,
      events: [examEvent({ eventDate: addDaysKey(TODAY, 12), examWeight: 40 })],
    });
    const plan = planStudyBlocks(input);
    const reviews = plan.blocks.filter((b) => b.taskKind === "exam-review");
    expect(reviews.length).toBeGreaterThan(0);
    // Offsets for 12 days out are 7/3/1 → review dates day 5, 9, 11.
    const dates = new Set(reviews.map((b) => b.dateKey));
    expect(dates.has(addDaysKey(TODAY, 5))).toBe(true);
    expect(dates.has(addDaysKey(TODAY, 11))).toBe(true);
  });

  it("does not schedule during class time", () => {
    const classEv: ScheduleEvent = {
      id: "c1",
      title: "Lecture",
      courseCode: "CS101",
      location: null,
      color: "#000",
      category: "class",
      subtype: "lecture",
      kind: "weekly",
      dayOfWeek: NOW.getDay(),
      eventDate: null,
      startTime: "09:00",
      endTime: "13:00",
      notes: null,
      examWeight: null,
      examScore: null,
    };
    const input = baseInput({
      horizonDays: 1,
      events: [classEv],
      homework: [hw({ dueDate: addDaysKey(TODAY, 1), estimatedMinutes: 200, weight: 10 })],
    });
    const plan = planStudyBlocks(input);
    // Deadline is tomorrow and horizon is only today → catch-up allowed today,
    // but nothing may overlap the 09:00–13:00 class.
    for (const b of plan.blocks.filter((x) => x.dateKey === TODAY)) {
      expect(b.startTime >= "13:00").toBe(true);
    }
  });

  it("is deterministic — identical input yields identical output", () => {
    const mk = () =>
      baseInput({
        horizonDays: 10,
        homework: [
          hw({ id: "a", dueDate: addDaysKey(TODAY, 5), estimatedMinutes: 300, weight: 15 }),
          hw({ id: "b", dueDate: addDaysKey(TODAY, 7), estimatedMinutes: 200, weight: 8 }),
        ],
        events: [examEvent({ eventDate: addDaysKey(TODAY, 9), examWeight: 30 })],
      });
    expect(planStudyBlocks(mk())).toEqual(planStudyBlocks(mk()));
  });

  it("warns when there is nothing to schedule", () => {
    const plan = planStudyBlocks(baseInput());
    expect(plan.blocks).toEqual([]);
    expect(plan.warnings.some((w) => w.includes("Nothing to schedule"))).toBe(true);
  });

  it("skips finished homework", () => {
    const input = baseInput({
      homework: [hw({ status: "graded", progressPct: 100, dueDate: addDaysKey(TODAY, 3) })],
    });
    const plan = planStudyBlocks(input);
    expect(plan.blocks.filter((b) => b.taskKind === "homework")).toEqual([]);
  });
});

describe("lectureBacklogFor", () => {
  // A weekly Monday class; TODAY (2026-06-01) is a Monday.
  const cls = classEvent({ dayOfWeek: 1 });

  it("counts occurred-minus-watched meetings within the semester term", () => {
    // Mondays in [TODAY-21, TODAY] = 05-11, 05-18, 05-25, 06-01 → 4 occurred.
    const backlog = lectureBacklogFor(
      course({ watchedLectures: 1 }),
      [cls],
      NOW,
      addDaysKey(TODAY, -21),
      addDaysKey(TODAY, 60),
    );
    expect(backlog).toBe(3);
  });

  it("is zero once caught up", () => {
    expect(
      lectureBacklogFor(course({ watchedLectures: 10 }), [cls], NOW, addDaysKey(TODAY, -21), null),
    ).toBe(0);
  });

  it("falls back to an 8-week lookback when no semester bounds", () => {
    // 56-day lookback: Mondays TODAY-56 … TODAY inclusive = 9.
    expect(lectureBacklogFor(course({ watchedLectures: 0 }), [cls], NOW, null, null)).toBe(9);
  });

  it("is zero for a course with no class events", () => {
    expect(
      lectureBacklogFor(course({ code: "PHYS1" }), [cls], NOW, addDaysKey(TODAY, -21), null),
    ).toBe(0);
  });
});

describe("planStudyBlocks — lecture review catch-up", () => {
  const semStart = addDaysKey(TODAY, -21);
  const semEnd = addDaysKey(TODAY, 60);
  const cls = classEvent({ dayOfWeek: 1 });

  it("schedules catch-up blocks for an unwatched backlog", () => {
    const plan = planStudyBlocks(
      baseInput({
        horizonDays: 10,
        events: [cls],
        courses: [course({ watchedLectures: 0 })],
        includeLectureReview: true,
        semesterStart: semStart,
        semesterEnd: semEnd,
      }),
    );
    const lec = plan.blocks.filter((b) => b.taskKind === "lecture-review");
    expect(lec.length).toBeGreaterThan(0);
    expect(lec.every((b) => b.title.includes("Catch up"))).toBe(true);
  });

  it("adds nothing when caught up", () => {
    const plan = planStudyBlocks(
      baseInput({
        horizonDays: 10,
        events: [cls],
        courses: [course({ watchedLectures: 50 })],
        includeLectureReview: true,
        semesterStart: semStart,
        semesterEnd: semEnd,
      }),
    );
    expect(plan.blocks.filter((b) => b.taskKind === "lecture-review")).toEqual([]);
  });

  it("adds nothing when the toggle is off", () => {
    const plan = planStudyBlocks(
      baseInput({
        horizonDays: 10,
        events: [cls],
        courses: [course({ watchedLectures: 0 })],
        includeLectureReview: false,
        semesterStart: semStart,
        semesterEnd: semEnd,
      }),
    );
    expect(plan.blocks.filter((b) => b.taskKind === "lecture-review")).toEqual([]);
  });

  it("spreads catch-up before the course's next exam", () => {
    const examDate = addDaysKey(TODAY, 6);
    const plan = planStudyBlocks(
      baseInput({
        horizonDays: 12,
        events: [cls, examEvent({ eventDate: examDate })],
        courses: [course({ watchedLectures: 0 })],
        includeLectureReview: true,
        semesterStart: semStart,
        semesterEnd: semEnd,
      }),
    );
    const lec = plan.blocks.filter((b) => b.taskKind === "lecture-review");
    expect(lec.length).toBeGreaterThan(0);
    for (const b of lec) expect(b.dateKey < examDate).toBe(true);
  });
});
