import { describe, expect, it } from "vitest";

import { deriveExamDownlink } from "@/features/device/exam-encode";

const TODAY = "2026-07-17";

describe("deriveExamDownlink", () => {
  it("auto-enables on an exam TODAY even when the manual toggle is off", () => {
    const r = deriveExamDownlink(false, TODAY, [
      { date: TODAY, category: "exam", title: "Algebra final" },
    ]);
    expect(r).toEqual({ examMode: true, nextExamDays: 0, nextExamTitle: "Algebra final" });
  });

  it("manual toggle enables DND without any exam", () => {
    const r = deriveExamDownlink(true, TODAY, []);
    expect(r.examMode).toBe(true);
    expect(r.nextExamDays).toBe(-1);
    expect(r.nextExamTitle).toBe("");
  });

  it("a future exam sets the countdown but not the mode", () => {
    const r = deriveExamDownlink(false, TODAY, [
      { date: "2026-07-20", category: "exam", title: "Physics" },
    ]);
    expect(r.examMode).toBe(false);
    expect(r.nextExamDays).toBe(3);
    expect(r.nextExamTitle).toBe("Physics");
  });

  it("picks the NEAREST exam and ignores other categories and past dates", () => {
    const r = deriveExamDownlink(false, TODAY, [
      { date: "2026-07-25", category: "exam", title: "Far" },
      { date: "2026-07-19", category: "class", title: "Lecture" },
      { date: "2026-07-16", category: "exam", title: "Yesterday" },
      { date: "2026-07-21", category: "exam", title: "Near" },
    ]);
    expect(r.nextExamDays).toBe(4);
    expect(r.nextExamTitle).toBe("Near");
  });

  it("sanitizes and byte-caps the exam title", () => {
    const r = deriveExamDownlink(false, TODAY, [
      { date: TODAY, category: "exam", title: 'Final "A|B"; ' + "ב".repeat(30) },
    ]);
    expect(r.nextExamTitle).not.toMatch(/["|;\\]/);
    expect(new TextEncoder().encode(r.nextExamTitle).length).toBeLessThanOrEqual(23);
  });
});
