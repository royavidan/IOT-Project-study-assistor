import { describe, expect, it } from "vitest";

import { computeWellbeing } from "@/lib/wellbeing";
import type { Session } from "@/lib/types";

/** Date key `daysAgo` days before the fixed anchor 2026-06-10. */
function key(daysAgo: number): string {
  const d = new Date(2026, 5, 10);
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

let idCounter = 0;
function session(overrides: Partial<Session> = {}): Session {
  idCounter += 1;
  return {
    id: `s${idCounter}`,
    date: key(0),
    start: "09:00",
    durationMin: 45,
    mode: "Study",
    status: "completed",
    focusScore: 70,
    breaks: 0,
    subject: "Study",
    noiseAvg: null,
    tempC: null,
    lightLux: null,
    presenceInterruptions: 0,
    userId: "u1",
    ...overrides,
  };
}

describe("computeWellbeing — readiness", () => {
  it("is not ready with no sessions", () => {
    const report = computeWellbeing([]);
    expect(report.ready).toBe(false);
    expect(report.sessionCount).toBe(0);
    expect(report.recovery.ready).toBe(false);
    expect(report.circadian.ready).toBe(false);
    expect(report.consistency.ready).toBe(false);
  });

  it("is not ready with only a couple of sessions", () => {
    const report = computeWellbeing([session({ date: key(0) }), session({ date: key(1) })]);
    expect(report.ready).toBe(false);
    expect(report.circadian.ready).toBe(false);
    expect(report.consistency.ready).toBe(false);
  });
});

describe("recovery balance", () => {
  it("reads balanced with regular rest days and daytime work", () => {
    const days = [0, 1, 2, 4, 5, 6, 8, 9, 11, 13]; // 10 active of 14 → 4 rest days
    const report = computeWellbeing(days.map((d) => session({ date: key(d), start: "09:00" })));
    expect(report.recovery.ready).toBe(true);
    expect(report.recovery.status).toBe("balanced");
    expect(report.recovery.score).toBeGreaterThanOrEqual(70);
    expect(report.recovery.factors).toHaveLength(3);
  });

  it("reads strained with no rest days and heavy late-night work", () => {
    const sessions = Array.from({ length: 14 }, (_, d) =>
      session({ date: key(d), start: "23:00" }),
    );
    const report = computeWellbeing(sessions);
    expect(report.recovery.ready).toBe(true);
    expect(report.recovery.status).toBe("strained");
    expect(report.recovery.score).toBeLessThan(45);
    expect(report.recovery.suggestion.length).toBeGreaterThan(0);
  });

  it("surfaces a load-change factor when a prior window exists", () => {
    const recent = [0, 1, 3, 4, 6, 7, 9, 10, 12, 13].map((d) =>
      session({ date: key(d), start: "09:00", durationMin: 180 }),
    );
    const prior = [16, 19, 22, 25].map((d) =>
      session({ date: key(d), start: "09:00", durationMin: 30 }),
    );
    const report = computeWellbeing([...recent, ...prior]);
    const loadFactor = report.recovery.factors.find((f) => f.label.startsWith("Load"));
    expect(loadFactor?.value).toContain("%");
    expect(loadFactor?.value).not.toBe("—");
  });

  it("is not ready without enough recent active days", () => {
    const report = computeWellbeing([
      session({ date: key(0) }),
      session({ date: key(0) }),
      session({ date: key(1) }),
    ]);
    expect(report.recovery.ready).toBe(false);
  });
});

describe("circadian alignment", () => {
  it("reads aligned for consistent daytime focus with no late-night work", () => {
    const sessions = Array.from({ length: 8 }, (_, i) =>
      session({ date: key(i), start: "09:00", focusScore: 80 }),
    );
    const report = computeWellbeing(sessions);
    expect(report.circadian.ready).toBe(true);
    expect(report.circadian.status).toBe("aligned");
    expect(report.circadian.bestWindow).toContain("Morning");
    expect(report.circadian.score).toBeGreaterThanOrEqual(70);
  });

  it("reads misaligned when most focus time is late at night", () => {
    const sessions = Array.from({ length: 8 }, (_, i) =>
      session({ date: key(i), start: "23:30", focusScore: 50 }),
    );
    const report = computeWellbeing(sessions);
    expect(report.circadian.ready).toBe(true);
    expect(report.circadian.status).toBe("misaligned");
    expect(report.circadian.score).toBeLessThan(40);
  });

  it("identifies the best window when sessions span morning and night", () => {
    const morning = Array.from({ length: 5 }, (_, i) =>
      session({ date: key(i), start: "09:00", focusScore: 85 }),
    );
    const night = Array.from({ length: 5 }, (_, i) =>
      session({ date: key(i + 5), start: "23:30", focusScore: 50 }),
    );
    const report = computeWellbeing([...morning, ...night]);
    expect(report.circadian.bestWindow).toContain("Morning");
    expect(report.circadian.status).not.toBe("aligned");
  });
});

describe("routine consistency", () => {
  it("reads steady with the same start time across many days", () => {
    const sessions = Array.from({ length: 10 }, (_, d) =>
      session({ date: key(d), start: "09:00" }),
    );
    const report = computeWellbeing(sessions);
    expect(report.consistency.ready).toBe(true);
    expect(report.consistency.status).toBe("steady");
    expect(report.consistency.typicalStart).toBe("09:00");
    expect(report.consistency.score).toBeGreaterThanOrEqual(70);
  });

  it("handles times that wrap around midnight without distortion", () => {
    // 23:40 and 00:20 are 40 minutes apart, not ~23 hours.
    const sessions = [
      session({ date: key(0), start: "23:40" }),
      session({ date: key(1), start: "00:20" }),
      session({ date: key(2), start: "23:50" }),
      session({ date: key(3), start: "00:10" }),
      session({ date: key(4), start: "00:00" }),
    ];
    const report = computeWellbeing(sessions);
    expect(report.consistency.ready).toBe(true);
    // Tight cluster around midnight → not irregular on timing grounds.
    const spread = report.consistency.factors.find((f) => f.label === "Start-time spread");
    expect(spread).toBeDefined();
    expect(Number.parseInt(spread!.value.replace(/[^0-9]/g, ""), 10)).toBeLessThan(60);
  });

  it("reads irregular with scattered times on sporadic days", () => {
    const sessions = [
      session({ date: key(0), start: "06:00" }),
      session({ date: key(7), start: "23:00" }),
      session({ date: key(14), start: "12:00" }),
      session({ date: key(21), start: "02:00" }),
      session({ date: key(28), start: "18:00" }),
    ];
    const report = computeWellbeing(sessions);
    expect(report.consistency.ready).toBe(true);
    expect(report.consistency.status).toBe("irregular");
  });

  it("is not ready with fewer than four distinct days", () => {
    const sessions = [
      session({ date: key(0) }),
      session({ date: key(0) }),
      session({ date: key(1) }),
      session({ date: key(1) }),
      session({ date: key(2) }),
    ];
    const report = computeWellbeing(sessions);
    expect(report.consistency.ready).toBe(false);
  });
});
