import { describe, expect, it } from "vitest";

import { hasHebrew, transliterateHebrew } from "@/features/device/transliterate";

describe("transliterateHebrew", () => {
  it("romanizes common words", () => {
    expect(transliterateHebrew("מבחן")).toBe("mbchn");
    expect(transliterateHebrew("אלגברה")).toBe("algbrh");
    expect(transliterateHebrew("שיעורי בית")).toBe("shiaori bit");
  });

  it("maps final forms to their base sound", () => {
    // ך→k ם→m ן→n ף→f ץ→tz
    expect(transliterateHebrew("ךםןףץ")).toBe("kmnftz");
  });

  it("uses multi-char digraphs (ch/sh/tz)", () => {
    expect(transliterateHebrew("חץש")).toBe("chtzsh");
  });

  it("drops niqqud, geresh and cantillation marks", () => {
    expect(transliterateHebrew("שָׁלוֹם")).toBe("shlom"); // vowels/dots dropped
    expect(transliterateHebrew("ג׳")).toBe("g"); // geresh dropped
  });

  it("passes non-Hebrew through unchanged", () => {
    expect(transliterateHebrew("Calc HW 3")).toBe("Calc HW 3");
    expect(transliterateHebrew("字 emoji 😀")).toBe("字 emoji 😀");
    expect(transliterateHebrew("Physics — מבוא")).toBe("Physics — mboa");
  });

  it("handles empty input", () => {
    expect(transliterateHebrew("")).toBe("");
  });
});

describe("hasHebrew", () => {
  it("detects Hebrew-block characters", () => {
    expect(hasHebrew("מבחן")).toBe(true);
    expect(hasHebrew("Calc")).toBe(false);
    expect(hasHebrew("Calc מבחן")).toBe(true);
    expect(hasHebrew("")).toBe(false);
  });
});
