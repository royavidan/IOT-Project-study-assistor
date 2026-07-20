import { describe, expect, it } from "vitest";

import {
  escapeCsv,
  sessionsToCsv,
  sessionsToJson,
  summarize,
  type ReportMeta,
} from "@/features/reports/export";
import type { Session } from "@/lib/types";

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    date: "2026-06-01",
    start: "09:00",
    durationMin: 50,
    mode: "Study",
    status: "completed",
    focusScore: 70,
    breaks: 1,
    subject: "Study",
    noiseAvg: 0.4,
    tempC: 22,
    lightLux: 300,
    presenceInterruptions: 2,
    ...overrides,
  };
}

const meta: ReportMeta = {
  user: "you@example.com",
  from: "2026-06-01",
  to: "2026-06-30",
  generatedAt: "2026-06-09T00:00:00.000Z",
};

describe("escapeCsv", () => {
  it("leaves plain values untouched", () => {
    expect(escapeCsv("Study")).toBe("Study");
    expect(escapeCsv(50)).toBe("50");
    expect(escapeCsv(null)).toBe("");
  });

  it("quotes and escapes values containing commas, quotes, or newlines", () => {
    expect(escapeCsv("a,b")).toBe('"a,b"');
    expect(escapeCsv('she said "hi"')).toBe('"she said ""hi"""');
    expect(escapeCsv("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("sessionsToCsv", () => {
  it("emits a header row plus one row per session", () => {
    const csv = sessionsToCsv([session(), session({ id: "s2" })]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Date");
    expect(lines[0]).toContain("Focus Load Estimate");
    expect(lines[1]).toContain("2026-06-01");
  });

  it("renders null environment readings as empty cells", () => {
    const csv = sessionsToCsv([session({ noiseAvg: null, tempC: null, lightLux: null })]);
    const row = csv.split("\r\n")[1];
    // ...presence(2),noise(),temp(),light() -> trailing empties
    expect(row.endsWith("2,,,")).toBe(true);
  });
});

describe("summarize", () => {
  it("totals minutes and averages scores + environment", () => {
    const s = summarize([
      session({ durationMin: 30, focusScore: 60, noiseAvg: 0.2, tempC: 20, lightLux: 200 }),
      session({ durationMin: 50, focusScore: 80, noiseAvg: 0.4, tempC: 24, lightLux: 400 }),
    ]);
    expect(s.sessionCount).toBe(2);
    expect(s.totalFocusMin).toBe(80);
    expect(s.avgFocusScore).toBe(70);
    expect(s.avgNoise).toBe(0.3);
    expect(s.avgTempC).toBe(22);
    expect(s.avgLightLux).toBe(300);
  });

  it("ignores null environment values when averaging", () => {
    const s = summarize([session({ noiseAvg: 0.5 }), session({ noiseAvg: null })]);
    expect(s.avgNoise).toBe(0.5);
  });

  it("returns null averages and zeros for an empty range", () => {
    const s = summarize([]);
    expect(s.sessionCount).toBe(0);
    expect(s.totalFocusMin).toBe(0);
    expect(s.avgFocusScore).toBe(0);
    expect(s.avgNoise).toBeNull();
  });
});

describe("sessionsToJson", () => {
  it("produces parseable JSON carrying meta, summary, and sessions", () => {
    const parsed = JSON.parse(sessionsToJson([session()], meta));
    expect(parsed.meta.user).toBe("you@example.com");
    expect(parsed.summary.sessionCount).toBe(1);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.note).toMatch(/heuristic/i);
  });
});
