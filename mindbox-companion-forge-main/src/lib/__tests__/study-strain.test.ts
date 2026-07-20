import { describe, expect, it } from "vitest";

import {
  GROUP_HARD_FACTOR,
  GROUP_LIGHT_FACTOR,
  INTENSITY_BY_MODE,
  INTENSITY_MAX,
  INTENSITY_MIN,
  companionFactor,
  intensityNote,
  sessionIntensity,
  strainMinutes,
  sumStrainMinutes,
} from "@/lib/study-strain";
import type { Companions, Session, SessionMode } from "@/lib/types";

function session(over: Partial<Session> = {}): Session {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    date: "2026-06-01",
    start: "10:00",
    durationMin: over.durationMin ?? 60,
    mode: "Study",
    status: "completed",
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

describe("sessionIntensity — base per mode (solo)", () => {
  const cases: [SessionMode, number][] = [
    ["Homework", 1.25],
    ["Deep Focus", 1.2],
    ["Study", 1.0],
    ["Review", 1.0],
    ["Reading", 0.85],
  ];
  it.each(cases)("%s solo → %f", (mode, expected) => {
    expect(sessionIntensity(session({ mode, companions: "solo" }))).toBeCloseTo(expected, 5);
    expect(INTENSITY_BY_MODE[mode]).toBeCloseTo(expected, 5);
  });

  it("unset companions behaves like solo", () => {
    expect(sessionIntensity({ mode: "Homework", companions: undefined })).toBeCloseTo(1.25, 5);
  });
});

describe("companionFactor — difficulty-aware group study", () => {
  it("solo is always neutral", () => {
    (["Homework", "Reading", "Study"] as SessionMode[]).forEach((m) => {
      expect(companionFactor(m, "solo")).toBe(1);
      expect(companionFactor(m, undefined)).toBe(1);
    });
  });

  it("hard tasks with others are LESS draining (shared thinking)", () => {
    expect(companionFactor("Homework", "with_others")).toBe(GROUP_HARD_FACTOR);
    expect(companionFactor("Deep Focus", "with_others")).toBe(GROUP_HARD_FACTOR);
  });

  it("light tasks with others are MORE draining (coordination overhead)", () => {
    expect(companionFactor("Reading", "with_others")).toBe(GROUP_LIGHT_FACTOR);
    expect(companionFactor("Study", "with_others")).toBe(GROUP_LIGHT_FACTOR);
    expect(companionFactor("Review", "with_others")).toBe(GROUP_LIGHT_FACTOR);
  });

  it("homework with friends drains less than homework alone; reading is the reverse", () => {
    const g: Companions = "with_others";
    expect(sessionIntensity(session({ mode: "Homework", companions: g }))).toBeLessThan(
      sessionIntensity(session({ mode: "Homework", companions: "solo" })),
    );
    expect(sessionIntensity(session({ mode: "Reading", companions: g }))).toBeGreaterThan(
      sessionIntensity(session({ mode: "Reading", companions: "solo" })),
    );
  });
});

describe("intensity stays within clamp bounds", () => {
  it("every mode × company combination is inside [MIN, MAX]", () => {
    const modes: SessionMode[] = ["Deep Focus", "Study", "Reading", "Review", "Homework"];
    const companies: Companions[] = ["solo", "with_others"];
    for (const mode of modes) {
      for (const companions of companies) {
        const v = sessionIntensity(session({ mode, companions }));
        expect(v).toBeGreaterThanOrEqual(INTENSITY_MIN);
        expect(v).toBeLessThanOrEqual(INTENSITY_MAX);
      }
    }
  });
});

describe("strainMinutes & sumStrainMinutes", () => {
  it("scales clock minutes by intensity", () => {
    expect(
      strainMinutes(session({ mode: "Homework", durationMin: 60, companions: "solo" })),
    ).toBeCloseTo(75, 5); // 60 × 1.25
    expect(
      strainMinutes(session({ mode: "Reading", durationMin: 60, companions: "solo" })),
    ).toBeCloseTo(51, 5); // 60 × 0.85
  });

  it("treats negative/zero duration as zero", () => {
    expect(strainMinutes(session({ durationMin: -30 }))).toBe(0);
    expect(strainMinutes(session({ durationMin: 0 }))).toBe(0);
  });

  it("sums across sessions", () => {
    const total = sumStrainMinutes([
      session({ mode: "Homework", durationMin: 60, companions: "solo" }), // 75
      session({ mode: "Study", durationMin: 60, companions: "solo" }), // 60
    ]);
    expect(total).toBeCloseTo(135, 5);
  });
});

describe("intensityNote", () => {
  it("is null for a neutral (~1.0×) session", () => {
    expect(intensityNote(session({ mode: "Study", companions: "solo" }))).toBeNull();
  });

  it("describes a heavier session", () => {
    const note = intensityNote(session({ mode: "Homework", companions: "solo" }));
    expect(note).toContain("1.25");
    expect(note).toContain("homework");
  });
});
