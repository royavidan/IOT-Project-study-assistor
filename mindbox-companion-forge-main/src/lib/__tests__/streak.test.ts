import { describe, expect, it } from "vitest";

import { computeStreakFromDateKeys, toDateKey } from "@/lib/streak";

describe("computeStreakFromDateKeys", () => {
  it("returns 0 when there are no session days", () => {
    expect(computeStreakFromDateKeys([], new Date("2026-06-09T12:00:00"))).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    const now = new Date("2026-06-09T12:00:00");
    const keys = ["2026-06-07", "2026-06-08", "2026-06-09"];
    expect(computeStreakFromDateKeys(keys, now)).toBe(3);
  });

  it("counts consecutive days ending yesterday when today is empty", () => {
    const now = new Date("2026-06-09T12:00:00");
    const keys = ["2026-06-07", "2026-06-08"];
    expect(computeStreakFromDateKeys(keys, now)).toBe(2);
  });

  it("breaks on a gap", () => {
    const now = new Date("2026-06-09T12:00:00");
    const keys = ["2026-06-06", "2026-06-08", "2026-06-09"];
    expect(computeStreakFromDateKeys(keys, now)).toBe(2);
  });

  it("toDateKey formats local dates", () => {
    const d = new Date(2026, 5, 9, 15, 30);
    expect(toDateKey(d)).toBe("2026-06-09");
  });
});
