import { describe, expect, it } from "vitest";

import { sanitizeDeviceString, truncateUtf8Bytes } from "@/features/device/device-string";

describe("sanitizeDeviceString", () => {
  it("strips wire delimiters and parser-breaking chars", () => {
    expect(sanitizeDeviceString("Bad|Title;With Delims")).toBe("Bad Title With Delims");
    expect(sanitizeDeviceString('Say "hi" C:\\notes')).toBe("Say hi C: notes");
  });

  it("replaces control characters and collapses whitespace", () => {
    expect(sanitizeDeviceString("a\tb\nc")).toBe("a b c");
    expect(sanitizeDeviceString("  lots   of\t\tspace  ")).toBe("lots of space");
    expect(sanitizeDeviceString(String.fromCharCode(0, 7, 27) + "x")).toBe("x");
  });

  it("keeps ordinary unicode intact", () => {
    expect(sanitizeDeviceString("אלגברה ב' — הרצאה")).toBe("אלגברה ב' — הרצאה");
  });
});

describe("truncateUtf8Bytes", () => {
  it("returns short strings unchanged", () => {
    expect(truncateUtf8Bytes("hello", 23)).toBe("hello");
  });

  it("caps by BYTES, not chars, without splitting a multi-byte char", () => {
    // Hebrew letters are 2 UTF-8 bytes: 20 letters = 40 bytes -> 11 fit in 23.
    const hebrew = "א".repeat(20);
    const out = truncateUtf8Bytes(hebrew, 23);
    expect(out).toBe("א".repeat(11));
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(23);
  });

  it("handles a zero budget", () => {
    expect(truncateUtf8Bytes("abc", 0)).toBe("");
  });
});
