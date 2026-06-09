import { describe, expect, it } from "vitest";

import { computeFocusLoad, PRESENCE_INTERRUPTION_CAP } from "@/lib/focus-load";

describe("computeFocusLoad", () => {
  it("returns 0 when every input is at its minimum", () => {
    expect(
      computeFocusLoad({
        elapsedSec: 0,
        targetSec: 1500,
        normalizedNoise: 0,
        ambientLightVariance: 0,
        presenceInterruptions: 0,
      }),
    ).toBe(0);
  });

  it("returns 100 when every weighted term is saturated", () => {
    expect(
      computeFocusLoad({
        elapsedSec: 1500,
        targetSec: 1500,
        normalizedNoise: 1,
        ambientLightVariance: 1,
        presenceInterruptions: PRESENCE_INTERRUPTION_CAP,
      }),
    ).toBe(100);
  });

  it("clamps over-range inputs instead of exceeding 100", () => {
    expect(
      computeFocusLoad({
        elapsedSec: 9999,
        targetSec: 1500,
        normalizedNoise: 5,
        ambientLightVariance: 5,
        presenceInterruptions: 99,
      }),
    ).toBe(100);
  });

  it("applies the documented weights (0.3/0.3/0.2/0.2)", () => {
    // elapsedRatio=1 -> 0.3, others 0 => 30.
    expect(
      computeFocusLoad({
        elapsedSec: 1500,
        targetSec: 1500,
        normalizedNoise: 0,
        ambientLightVariance: 0,
        presenceInterruptions: 0,
      }),
    ).toBe(30);

    // noise=1 -> 0.3 => 30.
    expect(
      computeFocusLoad({
        elapsedSec: 0,
        targetSec: 1500,
        normalizedNoise: 1,
        ambientLightVariance: 0,
        presenceInterruptions: 0,
      }),
    ).toBe(30);

    // light=1 -> 0.2 => 20.
    expect(
      computeFocusLoad({
        elapsedSec: 0,
        targetSec: 1500,
        normalizedNoise: 0,
        ambientLightVariance: 1,
        presenceInterruptions: 0,
      }),
    ).toBe(20);
  });

  it("guards against a zero target duration", () => {
    expect(
      computeFocusLoad({
        elapsedSec: 600,
        targetSec: 0,
        normalizedNoise: 0,
        ambientLightVariance: 0,
        presenceInterruptions: 0,
      }),
    ).toBe(0);
  });
});
