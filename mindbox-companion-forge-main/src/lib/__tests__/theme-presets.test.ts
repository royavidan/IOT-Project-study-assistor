import { describe, expect, it } from "vitest";

import {
  clampThemeId,
  DEVICE_THEME_MAX_ID,
  DEVICE_THEME_PRESETS,
} from "@/features/device/theme-presets";

const HEX = /^#[0-9A-F]{6}$/i;

describe("DEVICE_THEME_PRESETS", () => {
  it("has 5 presets with contiguous ids (the firmware table is ACCENTS[5])", () => {
    expect(DEVICE_THEME_PRESETS).toHaveLength(5);
    DEVICE_THEME_PRESETS.forEach((p, i) => expect(p.id).toBe(i));
    expect(DEVICE_THEME_MAX_ID).toBe(4);
  });

  it("preset 0 is the firmware's original compile-time colors", () => {
    const def = DEVICE_THEME_PRESETS[0];
    expect(def.accent).toBe("#E5352B");
    expect(def.focus).toBe("#E5484D");
    expect(def.break).toBe("#2EC4B6");
    expect(def.longBreak).toBe("#4C82E8");
  });

  it("every color is a valid hex triplet", () => {
    for (const p of DEVICE_THEME_PRESETS) {
      for (const c of [p.accent, p.focus, p.break, p.longBreak]) {
        expect(c).toMatch(HEX);
      }
    }
  });
});

describe("clampThemeId", () => {
  it("clamps out-of-range and non-numeric values to a valid id", () => {
    expect(clampThemeId(2)).toBe(2);
    expect(clampThemeId(99)).toBe(DEVICE_THEME_MAX_ID);
    expect(clampThemeId(-1)).toBe(0);
    expect(clampThemeId(null)).toBe(0);
    expect(clampThemeId("ocean")).toBe(0);
    expect(clampThemeId(2.6)).toBe(3);
  });
});
