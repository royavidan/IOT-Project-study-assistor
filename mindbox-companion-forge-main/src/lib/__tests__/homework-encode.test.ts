import { describe, expect, it } from "vitest";

import {
  DEVICE_HOMEWORK_MAX_ITEMS,
  DEVICE_HOMEWORK_TITLE_MAX_BYTES,
  encodeHomeworkForDevice,
} from "@/features/device/homework-encode";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("encodeHomeworkForDevice", () => {
  it("encodes id|title|pct joined by ;", () => {
    const out = encodeHomeworkForDevice([
      { id: uuid(1), title: "Calc set 3", progressPct: 50 },
      { id: uuid(2), title: "Lab report", progressPct: null },
    ]);
    expect(out).toBe(`${uuid(1)}|Calc set 3|50;${uuid(2)}|Lab report|0`);
  });

  it("drops non-uuid ids (the firmware parses a FIXED 36-char field)", () => {
    const out = encodeHomeworkForDevice([
      { id: "not-a-uuid", title: "X", progressPct: 10 },
      { id: uuid(3), title: "Y", progressPct: 20 },
    ]);
    expect(out).toBe(`${uuid(3)}|Y|20`);
  });

  it("caps at the firmware item limit", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: uuid(i + 1),
      title: `T${i}`,
      progressPct: 0,
    }));
    expect(encodeHomeworkForDevice(items).split(";")).toHaveLength(DEVICE_HOMEWORK_MAX_ITEMS);
  });

  it("clamps pct and sanitizes/caps titles", () => {
    const out = encodeHomeworkForDevice([
      { id: uuid(1), title: 'Read "ch|3"; notes', progressPct: 150 },
      { id: uuid(2), title: "א".repeat(30), progressPct: -5 },
    ]);
    const [first, second] = out.split(";");
    expect(first.split("|")[1]).toBe("Read ch 3 notes");
    expect(first.split("|")[2]).toBe("100");
    expect(new TextEncoder().encode(second.split("|")[1]).length).toBeLessThanOrEqual(
      DEVICE_HOMEWORK_TITLE_MAX_BYTES,
    );
    expect(second.split("|")[2]).toBe("0");
  });

  it("falls back to a placeholder title when sanitization empties it", () => {
    const out = encodeHomeworkForDevice([{ id: uuid(1), title: '"|;"', progressPct: 5 }]);
    expect(out.split("|")[1]).toBe("Homework");
  });

  it("returns empty string for no items", () => {
    expect(encodeHomeworkForDevice([])).toBe("");
  });
});
