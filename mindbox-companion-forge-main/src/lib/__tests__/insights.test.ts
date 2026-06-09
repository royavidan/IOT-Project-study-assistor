import { describe, expect, it } from "vitest";

import {
  computeDashboardInsightTeaser,
  computeEnvScatterPoints,
  computeHourlyHeatmap,
  computeSessionInsights,
} from "@/lib/insights";
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
  it("returns null ideal conditions with too few env sessions", () => {
    const insights = computeSessionInsights([session(), session({ id: "2" })]);
    expect(insights.idealConditions).toBeNull();
  });

  it("derives ideal conditions from top quartile sessions", () => {
    const sessions = Array.from({ length: 8 }, (_, i) =>
      session({
        id: String(i),
        focusScore: 40 + i * 8,
        noiseAvg: 0.5 - i * 0.04,
        tempC: 24 - i * 0.5,
        lightLux: 200 + i * 30,
      }),
    );
    const insights = computeSessionInsights(sessions);
    expect(insights.idealConditions).not.toBeNull();
    expect(insights.idealConditions!.sessionCount).toBeGreaterThanOrEqual(2);
    expect(insights.idealConditions!.summary).toMatch(/highest-scoring/i);
  });

  it("groups time-of-day buckets and picks a best slot", () => {
    const insights = computeSessionInsights([
      session({ start: "09:00", focusScore: 80 }),
      session({ id: "2", start: "10:00", focusScore: 75 }),
      session({ id: "3", start: "20:00", focusScore: 50 }),
    ]);
    expect(insights.timeOfDay.some((t) => t.label.includes("Morning"))).toBe(true);
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

  it("builds scatter points from sessions with noise", () => {
    const points = computeEnvScatterPoints([
      session({ id: "a", noiseAvg: 0.2, focusScore: 80 }),
      session({ id: "b", noiseAvg: 0.5, focusScore: 55 }),
    ]);
    expect(points).toHaveLength(2);
    expect(points[0].noise).toBe(0.2);
  });

  it("builds hourly heatmap cells for all 24 hours", () => {
    const cells = computeHourlyHeatmap([
      session({ start: "09:00", focusScore: 70 }),
      session({ id: "2", start: "09:30", focusScore: 90 }),
      session({ id: "3", start: "14:00", focusScore: 50 }),
    ]);
    expect(cells).toHaveLength(24);
    expect(cells[9].sessions).toBe(2);
    expect(cells[9].avgFocusScore).toBe(80);
  });

  it("dashboard teaser prompts for more sessions when data is sparse", () => {
    const teaser = computeDashboardInsightTeaser([session()]);
    expect(teaser.ready).toBe(false);
    expect(teaser.headline).toMatch(/unlock/i);
  });

  it("dashboard teaser highlights best time when enough env data exists", () => {
    const sessions = Array.from({ length: 4 }, (_, i) =>
      session({
        id: String(i),
        start: i < 2 ? "09:00" : "20:00",
        focusScore: i < 2 ? 85 : 50,
      }),
    );
    const teaser = computeDashboardInsightTeaser(sessions);
    expect(teaser.ready).toBe(true);
    expect(teaser.headline).toMatch(/Morning/i);
  });
});
