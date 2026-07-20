import { describe, expect, it } from "vitest";

import {
  bestSessionLength,
  effectiveMinutes,
  efficiencyAt,
  summarizeStudyTime,
} from "@/lib/study-time";
import type { Session } from "@/lib/types";

function session(over: Partial<Session> = {}): Session {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    date: "2026-06-01",
    start: "10:00",
    durationMin: over.durationMin ?? 60,
    mode: "Study",
    status: over.status ?? "completed",
    focusScore: 50,
    breaks: 0,
    subject: "x",
    noiseAvg: null,
    tempC: null,
    lightLux: null,
    presenceInterruptions: 0,
    ...over,
  };
}

describe("efficiencyAt", () => {
  it("is full up to 45 min, then decays to a 0.5 floor by 90", () => {
    expect(efficiencyAt(0)).toBe(1);
    expect(efficiencyAt(45)).toBe(1);
    expect(efficiencyAt(67.5)).toBeCloseTo(0.75, 5);
    expect(efficiencyAt(90)).toBeCloseTo(0.5, 5);
    expect(efficiencyAt(150)).toBe(0.5);
  });
});

describe("effectiveMinutes", () => {
  it("equals raw minutes under 45", () => {
    expect(effectiveMinutes(30)).toBe(30);
    expect(effectiveMinutes(45)).toBe(45);
    expect(effectiveMinutes(0)).toBe(0);
  });

  it("discounts long sessions (78.75 at 90, +0.5/min after)", () => {
    expect(effectiveMinutes(90)).toBeCloseTo(78.75, 5);
    expect(effectiveMinutes(120)).toBeCloseTo(93.75, 5);
  });

  it("matches a numeric integral of efficiencyAt", () => {
    const numeric = (dur: number) => {
      let sum = 0;
      const step = 0.01;
      for (let t = 0; t < dur; t += step) sum += efficiencyAt(t) * step;
      return sum;
    };
    for (const dur of [20, 60, 90, 130]) {
      expect(effectiveMinutes(dur)).toBeCloseTo(numeric(dur), 1);
    }
  });
});

describe("bestSessionLength", () => {
  it("picks the band with the best completion rate (≥2 sessions)", () => {
    const sessions = [
      // 30–60 band: 3 sessions, all completed → rate 1.0
      session({ durationMin: 40, status: "completed" }),
      session({ durationMin: 50, status: "completed" }),
      session({ durationMin: 55, status: "completed" }),
      // 90+ band: 2 sessions, both aborted → rate 0
      session({ durationMin: 120, status: "aborted" }),
      session({ durationMin: 100, status: "aborted" }),
    ];
    expect(bestSessionLength(sessions)?.label).toBe("30–60 min");
  });

  it("returns null without enough data in any band", () => {
    expect(bestSessionLength([session({ durationMin: 50 })])).toBeNull();
  });
});

describe("summarizeStudyTime", () => {
  it("aggregates raw vs effective minutes and a ratio", () => {
    const s = summarizeStudyTime([session({ durationMin: 30 }), session({ durationMin: 120 })]);
    expect(s.rawMin).toBe(150);
    expect(s.effectiveMin).toBe(Math.round(30 + 93.75)); // 124
    expect(s.ratio).toBeCloseTo((30 + 93.75) / 150, 3);
    expect(s.avgSessionMin).toBe(75);
  });

  it("falls back to a research default sweet spot", () => {
    expect(summarizeStudyTime([]).sweetSpotLabel).toBe("about 45–60 min");
  });
});
