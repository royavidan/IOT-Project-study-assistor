import { describe, expect, it } from "vitest";

import { isInQuietHours } from "@/lib/quiet-hours";

describe("isInQuietHours", () => {
  it("returns false when start or end is missing", () => {
    expect(isInQuietHours(new Date("2026-06-09T23:00:00"), null, "07:00")).toBe(false);
  });

  it("detects a same-day window", () => {
    const noon = new Date("2026-06-09T12:30:00");
    expect(isInQuietHours(noon, "12:00", "13:00")).toBe(true);
    expect(isInQuietHours(noon, "13:00", "14:00")).toBe(false);
  });

  it("detects an overnight window", () => {
    const late = new Date("2026-06-09T23:30:00");
    const early = new Date("2026-06-09T06:30:00");
    expect(isInQuietHours(late, "22:00", "07:00")).toBe(true);
    expect(isInQuietHours(early, "22:00", "07:00")).toBe(true);
    expect(isInQuietHours(new Date("2026-06-09T12:00:00"), "22:00", "07:00")).toBe(false);
  });
});
