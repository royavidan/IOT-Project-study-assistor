import { describe, expect, it } from "vitest";

import type { ReportMeta } from "@/features/reports/export";
import {
  buildReportHtml,
  escapeHtml,
  svgBarChart,
  svgGauge,
  svgHourHeatmap,
  svgLineChart,
  type ReportModel,
} from "@/features/reports/report-model";

const meta: ReportMeta = {
  user: "Taiyo",
  from: "2026-07-14",
  to: "2026-07-21",
  generatedAt: "2026-07-21T12:00:00Z",
};

describe("SVG chart helpers", () => {
  it("bar chart emits one rect per bar and is valid svg", () => {
    const svg = svgBarChart([
      { label: "Mon", value: 30 },
      { label: "Tue", value: 60 },
      { label: "Wed", value: 0 },
    ]);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect((svg.match(/<rect/g) ?? []).length).toBe(3);
  });

  it("line chart draws a path and skips null gaps", () => {
    const svg = svgLineChart([
      { x: 0, y: 10 },
      { x: 1, y: null },
      { x: 2, y: 40 },
    ]);
    expect(svg).toContain("<path");
    // Two segments (M before the gap, M after) → two moves.
    expect((svg.match(/M/g) ?? []).length).toBe(2);
  });

  it("gauge renders a confidence band when a CI is given", () => {
    expect(svgGauge(58, [40, 76])).toMatch(/rect/);
    expect(svgGauge(58).startsWith("<svg")).toBe(true);
  });

  it("hour heatmap renders 24 cells", () => {
    const svg = svgHourHeatmap(new Array(24).fill(0).map((_, i) => i));
    expect((svg.match(/<rect/g) ?? []).length).toBe(24);
  });
});

describe("escapeHtml", () => {
  it("escapes html-special characters", () => {
    expect(escapeHtml('<b>"x"&y</b>')).toBe("&lt;b&gt;&quot;x&quot;&amp;y&lt;/b&gt;");
  });
});

describe("buildReportHtml", () => {
  const weekly: ReportModel = {
    scope: "weekly",
    meta,
    narrative: {
      headline: "Solid week",
      paragraphs: ["You studied consistently."],
      highlights: ["Best in the morning"],
      source: "ai",
    },
    stats: [{ label: "Sessions", value: "12" }],
    focus: {
      energyScore: 58,
      energyCI: [40, 76],
      headline: "Moderate focus energy",
      reliability: "Still learning — 3/8 check-ins",
      trendLabel: "holding steady",
      drivers: [{ label: "Session load", effect: "adds" }],
    },
    wellbeing: {
      ready: true,
      signals: [
        { title: "Recovery balance", score: 72, status: "balanced", headline: "Good rest" },
      ],
    },
    overload: { level: "warning", rules: ["Tiredness mean ≥ 4/5"] },
    insights: {
      bestTime: "Morning",
      modes: [{ mode: "Deep Focus", minutes: 200, count: 4 }],
      hourly: new Array(24).fill(0).map((_, i) => (i >= 9 && i < 12 ? 40 : 0)),
      weekly: [
        { label: "Mon", minutes: 60 },
        { label: "Tue", minutes: 90 },
      ],
    },
    studyTime: { rawMin: 300, effectiveMin: 240, ratio: 0.8, sweetSpot: "~50 min" },
    conditions: {
      score: 70,
      band: "Good",
      factors: [{ label: "Noise", value: "0.3", band: "Good", tip: "Keep it quiet" }],
    },
    checkin: {
      count: 3,
      avgTiredness: 2.7,
      distribution: [0, 1, 1, 1, 0],
      notes: [{ date: "2026-07-18", tiredness: 4, text: "Rough day" }],
    },
    academic: {
      overall: { completionPct: 60, gradeAvg: 84 },
      courses: [{ code: "CS201", name: "OS", completionPct: 70, grade: 88, target: 90 }],
      upcomingExams: [{ title: "Midterm", course: "CS201", daysUntil: 3 }],
      homeworkDue: [{ title: "HW3", course: "CS201", due: "2026-07-24", status: "pending" }],
    },
    sessions: [
      {
        date: "2026-07-18",
        start: "09:00",
        durationMin: 50,
        mode: "Deep Focus",
        status: "completed",
        focusScore: 55,
        tiredness: 4,
      },
    ],
  };

  it("renders all weekly sections in a self-contained document", () => {
    const html = buildReportHtml(weekly);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Weekly Focus Report");
    expect(html).toContain("Focus Model");
    expect(html).toContain("Wellbeing patterns");
    expect(html).toContain("Load check");
    expect(html).toContain("When &amp; how you studied");
    expect(html).toContain("Your check-in feedback");
    expect(html).toContain("Academic context");
    expect(html).toContain("Session log");
    // Check-in note (the newly surfaced user feedback) appears.
    expect(html).toContain("Rough day");
    // Charts are inline SVG (no external asset).
    expect(html).toContain("<svg");
    expect(html).not.toContain("<img");
  });

  it("renders the per-session scope with the per-minute chart, not academic", () => {
    const session: ReportModel = {
      scope: "session",
      meta,
      sessionDetail: {
        mode: "Deep Focus",
        status: "completed",
        durationMin: 50,
        breaks: 1,
        presenceInterruptions: 2,
        dynamics: {
          loadMean: 45,
          loadPeak: 80,
          loadVolatility: 12,
          loadSlope: 8,
          sustainedHighShare: 0.3,
          envNoiseCoupling: 0.4,
        },
        series: [
          { tMin: 1, focus: 20, noise: 0.2 },
          { tMin: 2, focus: 40, noise: 0.4 },
          { tMin: 3, focus: 60, noise: 0.5 },
        ],
        checkin: { tiredness: 3, note: "Focused start, faded" },
      },
    };
    const html = buildReportHtml(session);
    expect(html).toContain("Session Report");
    expect(html).toContain("Within-session dynamics");
    expect(html).toContain("Focused start, faded");
    expect(html).toContain("<path"); // the per-minute line chart
    expect(html).not.toContain("Academic context");
  });
});
