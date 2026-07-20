import { describe, expect, it } from "vitest";

import {
  computeStudyConditions,
  conditionsFromSessions,
  factorTip,
  rateFactor,
} from "@/lib/env-quality";
import type { Session } from "@/lib/types";

function session(over: Partial<Session> = {}): Session {
  return {
    id: over.id ?? "s",
    date: "2026-06-01",
    start: "10:00",
    durationMin: 60,
    mode: "Study",
    status: "completed",
    focusScore: 50,
    breaks: 0,
    subject: "x",
    noiseAvg: over.noiseAvg ?? null,
    tempC: over.tempC ?? null,
    lightLux: over.lightLux ?? null,
    presenceInterruptions: 0,
    ...over,
  };
}

describe("rateFactor", () => {
  it("temperature bands around the ~21.6°C peak", () => {
    expect(rateFactor("temp", 21.6).band).toBe("ideal");
    expect(rateFactor("temp", 20.5).band).toBe("ideal");
    expect(rateFactor("temp", 18).band).toBe("okay");
    expect(rateFactor("temp", 26).band).toBe("okay");
    expect(rateFactor("temp", 27).band).toBe("poor");
    expect(rateFactor("temp", 30).band).toBe("poor");
  });

  it("labels temp direction", () => {
    expect(rateFactor("temp", 27).label).toBe("Too warm");
    expect(rateFactor("temp", 16).label).toBe("Too cold");
    expect(rateFactor("temp", 21.6).label).toBe("Comfortable");
  });

  it("noise bands (0–1 loudness, lower better)", () => {
    expect(rateFactor("noise", 0.2).band).toBe("ideal");
    expect(rateFactor("noise", 0.35).band).toBe("ideal");
    expect(rateFactor("noise", 0.45).band).toBe("okay");
    expect(rateFactor("noise", 0.7).band).toBe("poor");
  });

  it("light bands (lux)", () => {
    expect(rateFactor("light", 400).band).toBe("ideal");
    expect(rateFactor("light", 300).band).toBe("ideal");
    expect(rateFactor("light", 250).band).toBe("okay");
    expect(rateFactor("light", 150).band).toBe("poor");
    expect(rateFactor("light", 1200).band).toBe("poor");
  });

  it("light labels distinguish dim vs bright", () => {
    expect(rateFactor("light", 150).label).toBe("Too dim");
    expect(rateFactor("light", 1200).label).toBe("Very bright");
    expect(rateFactor("light", 400).label).toBe("Bright enough");
  });

  it("scores are clamped 0–100", () => {
    for (const v of [-10, 0, 21.6, 100]) {
      const r = rateFactor("temp", v);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });
});

describe("factorTip", () => {
  it("gives a warm/cold tip and none when ideal", () => {
    expect(factorTip("temp", "okay", 25)).toMatch(/warm/i);
    expect(factorTip("temp", "okay", 19)).toMatch(/cold/i);
    expect(factorTip("temp", "ideal", 21.6)).toBeNull();
  });
  it("gives dim vs glare light tips", () => {
    expect(factorTip("light", "poor", 150)).toMatch(/lamp/i);
    expect(factorTip("light", "okay", 900)).toMatch(/glare/i);
  });
});

describe("computeStudyConditions", () => {
  it("averages available factor scores", () => {
    const c = computeStudyConditions({ tempC: 21.6, noiseAvg: 0.2, lightLux: 400 });
    expect(c).not.toBeNull();
    expect(c!.band).toBe("ideal");
    expect(c!.factors).toHaveLength(3);
    expect(c!.score).toBeGreaterThanOrEqual(90);
  });

  it("skips null factors", () => {
    const c = computeStudyConditions({ tempC: 21.6, noiseAvg: null, lightLux: null });
    expect(c!.factors).toHaveLength(1);
    expect(c!.factors[0].key).toBe("temp");
  });

  it("returns null with no readings", () => {
    expect(computeStudyConditions({ tempC: null, noiseAvg: null, lightLux: null })).toBeNull();
  });

  it("poor environment gets a poor band + honest sentence", () => {
    const c = computeStudyConditions({ tempC: 30, noiseAvg: 0.8, lightLux: 120 });
    expect(c!.band).toBe("poor");
    expect(c!.sentence).toMatch(/against/i);
  });
});

describe("conditionsFromSessions", () => {
  it("averages env across sessions with readings", () => {
    const c = conditionsFromSessions([
      session({ tempC: 20, noiseAvg: 0.3, lightLux: 350 }),
      session({ tempC: 23, noiseAvg: 0.4, lightLux: 450 }),
      session({ tempC: null, noiseAvg: null, lightLux: null }),
    ]);
    expect(c).not.toBeNull();
    expect(c!.factors.map((f) => f.key)).toEqual(["temp", "noise", "light"]);
  });

  it("returns null when no session has env data", () => {
    expect(conditionsFromSessions([session(), session()])).toBeNull();
  });
});
