import { describe, expect, it } from "vitest";

import {
  computeDashboardInsightTeaser,
  computeHourlyHeatmap,
  computeSessionInsights,
} from "@/features/insights/insights";
import type { Session } from "@/lib/types";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "1",
    date: "2026-06-01",
    start: "09:00",
    durationMin: 45,
    mode: "Study",
    status: "completed",
    focusScore: 70,
    breaks: 0,
    subject: "Study",
    noiseAvg: 0.3,
    tempC: 22,
    lightLux: 300,
    presenceInterruptions: 0,
    userId: "u1",
    ...overrides,
  };
}

describe("computeSessionInsights", () => {
  it("groups time-of-day buckets and picks the busiest slot (by minutes)", () => {
    const insights = computeSessionInsights([
      session({ start: "09:00", durationMin: 60 }),
      session({ id: "2", start: "10:00", durationMin: 60 }),
      session({ id: "3", start: "20:00", durationMin: 30 }),
    ]);
    expect(insights.timeOfDay.some((t) => t.label.includes("Morning"))).toBe(true);
    expect(insights.bestTimeSlot?.label).toContain("Morning");
  });

  it("best slot follows minutes, NOT load (higher load must not win)", () => {
    const insights = computeSessionInsights([
      // Evening has one short but very high-load session…
      session({ id: "e", start: "20:00", durationMin: 20, focusScore: 95 }),
      // …Morning has more total minutes at lower load — Morning should win.
      session({ id: "m1", start: "09:00", durationMin: 60, focusScore: 40 }),
      session({ id: "m2", start: "10:00", durationMin: 60, focusScore: 40 }),
    ]);
    expect(insights.bestTimeSlot?.label).toContain("Morning");
  });

  it("breaks down modes and statuses", () => {
    const insights = computeSessionInsights([
      session({ mode: "Study", status: "completed" }),
      session({ id: "2", mode: "Reading", status: "interrupted" }),
    ]);
    expect(insights.modeBreakdown).toHaveLength(2);
    expect(insights.statusBreakdown).toHaveLength(2);
  });

  it("builds hourly heatmap cells for all 24 hours, intensity by minutes", () => {
    const cells = computeHourlyHeatmap([
      session({ start: "09:00", durationMin: 30 }),
      session({ id: "2", start: "09:30", durationMin: 30 }),
      session({ id: "3", start: "14:00", durationMin: 20 }),
    ]);
    expect(cells).toHaveLength(24);
    expect(cells[9].sessions).toBe(2);
    expect(cells[9].minutes).toBe(60);
    expect(cells[9].intensity).toBe(100); // busiest hour
    expect(cells[14].intensity).toBeLessThan(100);
  });

  it("dashboard teaser prompts for more sessions when data is sparse", () => {
    const teaser = computeDashboardInsightTeaser([session()]);
    expect(teaser.ready).toBe(false);
    expect(teaser.headline).toMatch(/unlock/i);
  });

  it("dashboard teaser highlights the busiest time when enough data exists", () => {
    const sessions = Array.from({ length: 4 }, (_, i) =>
      session({
        id: String(i),
        start: i < 2 ? "09:00" : "20:00",
        durationMin: i < 2 ? 60 : 20,
      }),
    );
    const teaser = computeDashboardInsightTeaser(sessions);
    expect(teaser.ready).toBe(true);
    expect(teaser.headline).toMatch(/Morning/i);
  });
});
