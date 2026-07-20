import { describe, expect, it } from "vitest";

import { assessOverload, type OverloadInput } from "@/features/insights/overload";
import { addDaysKey } from "@/features/planner/planner";
import { toDateKey } from "@/lib/dates";
import type { ScheduleEvent } from "@/features/schedule/schedule";
import type { HomeworkAssignment, Session } from "@/lib/types";

const NOW = new Date(2026, 5, 10, 12, 0, 0); // 2026-06-10 local
const TODAY = toDateKey(NOW);

function session(over: Partial<Session> = {}): Session {
  return {
    id: over.id ?? `s-${Math.abs(hash(JSON.stringify(over)))}`,
    date: over.date ?? TODAY,
    start: over.start ?? "14:00",
    durationMin: over.durationMin ?? 60,
    mode: "Study",
    status: "completed",
    focusScore: 40,
    breaks: 1,
    subject: "Study",
    noiseAvg: null,
    tempC: null,
    lightLux: null,
    presenceInterruptions: 0,
    ...over,
  };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function studyBlock(dateKey: string, startTime: string, endTime: string): ScheduleEvent {
  return {
    id: `sb-${dateKey}-${startTime}`,
    title: "Study",
    courseCode: null,
    location: null,
    color: "#14b8a6",
    category: "study",
    subtype: null,
    kind: "once",
    dayOfWeek: null,
    eventDate: dateKey,
    startTime,
    endTime,
    notes: null,
    examWeight: null,
    examScore: null,
    planGenerated: true,
  };
}

function exam(dateKey: string): ScheduleEvent {
  return { ...studyBlock(dateKey, "09:00", "12:00"), id: `exam-${dateKey}`, category: "exam" };
}

function hw(over: Partial<HomeworkAssignment> = {}): HomeworkAssignment {
  return {
    id: over.id ?? "hw1",
    courseCode: null,
    title: "HW",
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

function input(over: Partial<OverloadInput> = {}): OverloadInput {
  return {
    now: NOW,
    sessions: [],
    externalLoad: [],
    events: [],
    homework: [],
    weeklyCapMin: 240 * 5,
    recentTiredness: [],
    ...over,
  };
}

/** A dense, late-night 14-day session history that strains recovery. */
function strainedSessions(): Session[] {
  const out: Session[] = [];
  for (let i = 0; i < 14; i += 1) {
    const date = addDaysKey(TODAY, -i);
    out.push(session({ id: `a${i}`, date, start: "23:00", durationMin: 180 }));
    out.push(session({ id: `b${i}`, date, start: "01:00", durationMin: 120 }));
  }
  return out;
}

describe("assessOverload", () => {
  it("returns ok with no data", () => {
    const a = assessOverload(input());
    expect(a.level).toBe("ok");
    expect(a.triggeredRules).toHaveLength(0);
  });

  it("rule 2: fires at mean tiredness >= 4, not below", () => {
    expect(assessOverload(input({ recentTiredness: [4, 4, 4] })).level).toBe("warning");
    expect(
      assessOverload(input({ recentTiredness: [4, 4, 3] })).triggeredRules.map((r) => r.id),
    ).not.toContain("tiredness");
    expect(assessOverload(input({ recentTiredness: [] })).triggeredRules).toHaveLength(0);
  });

  it("rule 3: fires when planned study exceeds 1.25x the weekly cap", () => {
    // Cap 1200 min → limit 1500. Plan 6 days × 5h = 1800 min.
    const events = Array.from({ length: 6 }, (_, i) =>
      studyBlock(addDaysKey(TODAY, i), "10:00", "15:00"),
    );
    const a = assessOverload(input({ events, weeklyCapMin: 1200 }));
    expect(a.triggeredRules.map((r) => r.id)).toContain("overplanned");
    expect(a.metrics.plannedStudyMinNext7).toBe(1800);

    // At exactly the limit it does NOT fire (strictly above).
    const atLimit = Array.from({ length: 5 }, (_, i) =>
      studyBlock(addDaysKey(TODAY, i), "10:00", "15:00"),
    );
    expect(
      assessOverload(input({ events: atLimit, weeklyCapMin: 1200 })).triggeredRules.map(
        (r) => r.id,
      ),
    ).not.toContain("overplanned");
  });

  it("rule 4: fires at 6 consecutive active days, not 5", () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      session({ id: `d${i}`, date: addDaysKey(TODAY, -i) }),
    );
    const a = assessOverload(input({ sessions: six }));
    expect(a.triggeredRules.map((r) => r.id)).toContain("no-rest");
    expect(a.metrics.consecutiveActiveDays).toBe(6);

    const five = six.slice(0, 5);
    expect(assessOverload(input({ sessions: five })).triggeredRules.map((r) => r.id)).not.toContain(
      "no-rest",
    );
  });

  it("rule 5: fires only when an exam is within 72h AND homework backlog > 6h", () => {
    const bigBacklog = [hw({ estimatedMinutes: 400 })]; // 6h40m
    const withExam = assessOverload(
      input({ events: [exam(addDaysKey(TODAY, 2))], homework: bigBacklog }),
    );
    expect(withExam.triggeredRules.map((r) => r.id)).toContain("exam-crunch");

    // Exam too far away → no fire.
    const farExam = assessOverload(
      input({ events: [exam(addDaysKey(TODAY, 6))], homework: bigBacklog }),
    );
    expect(farExam.triggeredRules.map((r) => r.id)).not.toContain("exam-crunch");

    // Small backlog → no fire.
    const smallBacklog = assessOverload(
      input({ events: [exam(addDaysKey(TODAY, 2))], homework: [hw({ estimatedMinutes: 120 })] }),
    );
    expect(smallBacklog.triggeredRules.map((r) => r.id)).not.toContain("exam-crunch");
  });

  it("danger requires the strained rule PLUS another rule", () => {
    // Strained alone → warning.
    const alone = assessOverload(input({ sessions: strainedSessions() }));
    expect(alone.triggeredRules.map((r) => r.id)).toContain("strained");
    // The dense history may also trip no-rest; filter to check the level logic
    // via tiredness instead: strained + tiredness must be danger.
    const combined = assessOverload(
      input({ sessions: strainedSessions(), recentTiredness: [5, 5, 5] }),
    );
    expect(combined.level).toBe("danger");

    // Non-strained rules alone never reach danger.
    const warningOnly = assessOverload(input({ recentTiredness: [5, 5, 5] }));
    expect(warningOnly.level).toBe("warning");
  });
});
