import { describe, expect, it } from "vitest";

import { findPendingCheckin, shouldReplan } from "@/features/sessions/checkin";
import type { Session } from "@/lib/types";

const NOW = new Date("2026-06-01T18:00:00Z");

function session(over: Partial<Session> = {}): Session {
  return {
    id: over.id ?? "s1",
    date: "2026-06-01",
    start: "16:00",
    durationMin: 50,
    mode: "Study",
    status: over.status ?? "completed",
    focusScore: 40,
    breaks: 1,
    subject: "Study",
    noiseAvg: null,
    tempC: null,
    lightLux: null,
    presenceInterruptions: 0,
    endedAt: over.endedAt ?? "2026-06-01T17:00:00Z",
    checkinAt: over.checkinAt,
    tiredness: over.tiredness,
    ...over,
  };
}

describe("findPendingCheckin", () => {
  it("returns the latest completed, unanswered session inside the window", () => {
    const older = session({ id: "old", endedAt: "2026-06-01T14:00:00Z" });
    const newer = session({ id: "new", endedAt: "2026-06-01T17:00:00Z" });
    expect(findPendingCheckin([older, newer], NOW)?.id).toBe("new");
  });

  it("skips answered, non-completed, and out-of-window sessions", () => {
    expect(findPendingCheckin([session({ checkinAt: "2026-06-01T17:10:00Z" })], NOW)).toBeNull();
    expect(findPendingCheckin([session({ status: "aborted" })], NOW)).toBeNull();
    // Ended 7 hours ago — outside the 6h window.
    expect(findPendingCheckin([session({ endedAt: "2026-06-01T11:00:00Z" })], NOW)).toBeNull();
    // Ends "in the future" (clock skew) — ignored.
    expect(findPendingCheckin([session({ endedAt: "2026-06-01T19:00:00Z" })], NOW)).toBeNull();
    expect(findPendingCheckin([session({ endedAt: undefined })], NOW)).toBeNull();
  });
});

describe("shouldReplan", () => {
  it("does not replan for small updates and low tiredness", () => {
    const d = shouldReplan({
      tiredness: 2,
      homeworkUpdates: [{ id: "h1", previousPct: 40, progressPct: 50 }],
    });
    expect(d.replan).toBe(false);
    expect(d.reasons).toHaveLength(0);
  });

  it("replans when progress moves 25+ points", () => {
    const d = shouldReplan({
      tiredness: 1,
      homeworkUpdates: [{ id: "h1", previousPct: 20, progressPct: 45 }],
    });
    expect(d.replan).toBe(true);
    expect(d.reasons[0]).toMatch(/progress/);
  });

  it("replans when an assignment reaches 100%", () => {
    const d = shouldReplan({
      tiredness: 1,
      homeworkUpdates: [{ id: "h1", previousPct: 90, progressPct: 100 }],
    });
    expect(d.replan).toBe(true);
    expect(d.reasons[0]).toMatch(/finished/);
  });

  it("replans on tiredness >= 4 even with no homework updates", () => {
    const d = shouldReplan({ tiredness: 4, homeworkUpdates: [] });
    expect(d.replan).toBe(true);
    expect(d.reasons[0]).toMatch(/drained/);
  });

  it("boundary: 24-point delta does not trigger, 25 does", () => {
    const at = (prev: number, next: number) =>
      shouldReplan({
        tiredness: 1,
        homeworkUpdates: [{ id: "h", previousPct: prev, progressPct: next }],
      }).replan;
    expect(at(0, 24)).toBe(false);
    expect(at(0, 25)).toBe(true);
  });
});
