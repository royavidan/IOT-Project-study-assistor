import { describe, expect, it } from "vitest";

import { filterSessionsByUser } from "@/lib/session-scope";
import type { Session } from "@/lib/types";

function session(userId?: string): Session {
  return {
    id: "1",
    date: "2026-06-01",
    start: "09:00",
    durationMin: 30,
    mode: "Study",
    status: "completed",
    focusScore: 70,
    breaks: 0,
    subject: "Study",
    noiseAvg: null,
    tempC: null,
    lightLux: null,
    presenceInterruptions: 0,
    userId,
  };
}

describe("filterSessionsByUser", () => {
  it("returns own sessions including legacy rows without userId", () => {
    const rows = [session("u1"), session(), session("u2")];
    const filtered = filterSessionsByUser(rows, "u1", "u1");
    expect(filtered).toHaveLength(2);
  });

  it("returns only the selected student for reviewer scope", () => {
    const rows = [session("u1"), session("u2")];
    expect(filterSessionsByUser(rows, "u2", "u1")).toHaveLength(1);
  });
});
