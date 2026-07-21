import { describe, expect, it } from "vitest";

import {
  DEVICE_AGENDA_MAX_ITEMS,
  DEVICE_AGENDA_TITLE_MAX_BYTES,
  DEVICE_WEEK_MAX_ITEMS,
  DEVICE_WEEK_MAX_PER_DAY,
  encodeAgendaForDevice,
  encodeWeekAgendaForDevice,
  type DeviceAgendaItem,
  type DeviceWeekAgendaItem,
} from "@/features/device/agenda-encode";

const item = (over: Partial<DeviceAgendaItem> = {}): DeviceAgendaItem => ({
  startMin: 540,
  endMin: 630,
  kind: "study",
  title: "Calc HW",
  ...over,
});

describe("encodeAgendaForDevice", () => {
  it("encodes items as startMin|endMin|kind|title joined by ;", () => {
    const out = encodeAgendaForDevice([
      item(),
      item({ startMin: 660, endMin: 750, kind: "class", title: "Algebra" }),
    ]);
    expect(out).toBe("540|630|2|Calc HW;660|750|0|Algebra");
  });

  it("maps kinds to 0/1/2", () => {
    expect(encodeAgendaForDevice([item({ kind: "class" })])).toContain("|0|");
    expect(encodeAgendaForDevice([item({ kind: "exam" })])).toContain("|1|");
    expect(encodeAgendaForDevice([item({ kind: "study" })])).toContain("|2|");
  });

  it("sorts by start time and returns empty string for no items", () => {
    const out = encodeAgendaForDevice([
      item({ startMin: 700, endMin: 760, title: "B" }),
      item({ startMin: 540, endMin: 600, title: "A" }),
    ]);
    expect(out.startsWith("540|600")).toBe(true);
    expect(encodeAgendaForDevice([])).toBe("");
  });

  it("drops invalid, inverted, or out-of-grammar times (endMin must be <= 1439)", () => {
    expect(
      encodeAgendaForDevice([
        item({ startMin: 700, endMin: 640 }),
        item({ startMin: -5, endMin: 60 }),
        item({ startMin: 1500, endMin: 1550 }),
        item({ startMin: 1400, endMin: 1440 }),
      ]),
    ).toBe("");
    expect(encodeAgendaForDevice([item({ startMin: 1400, endMin: 1439 })])).not.toBe("");
  });

  it("caps at the firmware's max item count", () => {
    const many = Array.from({ length: DEVICE_AGENDA_MAX_ITEMS + 5 }, (_, i) =>
      item({ startMin: 480 + i * 30, endMin: 480 + i * 30 + 25, title: `T${i}` }),
    );
    const out = encodeAgendaForDevice(many);
    expect(out.split(";")).toHaveLength(DEVICE_AGENDA_MAX_ITEMS);
  });

  it("strips delimiters from titles and truncates to the firmware buffer", () => {
    const out = encodeAgendaForDevice([
      item({ title: "Bad|Title;With Delims" }),
      item({ startMin: 700, endMin: 750, title: "X".repeat(60) }),
    ]);
    const [first, second] = out.split(";");
    expect(first.split("|")[3]).toBe("Bad Title With Delims");
    expect(second.split("|")[3]).toHaveLength(DEVICE_AGENDA_TITLE_MAX_BYTES);
    // The wire format survives: exactly 4 fields per item.
    expect(first.split("|")).toHaveLength(4);
  });

  it("strips quotes and backslashes (the firmware's naive JSON reader can't unescape)", () => {
    const out = encodeAgendaForDevice([item({ title: 'Say "hi" C:\\notes' })]);
    expect(out.split("|")[3]).toBe("Say hi C: notes");
    expect(out).not.toMatch(/["\\]/);
  });

  it("caps titles by UTF-8 bytes without splitting a multi-byte character", () => {
    // CJK stays multi-byte (only Hebrew is transliterated): 3 bytes each ->
    // 7 fit in 23 without splitting a character.
    const cjk = "字".repeat(20);
    const title = encodeAgendaForDevice([item({ title: cjk })]).split("|")[3];
    expect(new TextEncoder().encode(title).length).toBeLessThanOrEqual(
      DEVICE_AGENDA_TITLE_MAX_BYTES,
    );
    expect(title).toBe("字".repeat(7));
  });

  it("transliterates Hebrew titles to Latin (ASCII-only device fonts)", () => {
    expect(encodeAgendaForDevice([item({ title: "אלגברה" })]).split("|")[3]).toBe("algbrh");
  });
});

const weekItem = (over: Partial<DeviceWeekAgendaItem> = {}): DeviceWeekAgendaItem => ({
  dayOffset: 1,
  startMin: 540,
  endMin: 630,
  kind: "class",
  title: "Algebra",
  ...over,
});

describe("encodeWeekAgendaForDevice", () => {
  it("prefixes each item with its dayOffset and sorts by (day, start)", () => {
    const out = encodeWeekAgendaForDevice([
      weekItem({ dayOffset: 3, startMin: 600, endMin: 780, kind: "exam", title: "Calc exam" }),
      weekItem({ dayOffset: 1, startMin: 540, endMin: 630 }),
      weekItem({ dayOffset: 1, startMin: 480, endMin: 520, kind: "study", title: "Review" }),
    ]);
    expect(out).toBe("1|480|520|2|Review;1|540|630|0|Algebra;3|600|780|1|Calc exam");
  });

  it("drops out-of-range day offsets (today and beyond the week are excluded)", () => {
    const out = encodeWeekAgendaForDevice([
      weekItem({ dayOffset: 0 }),
      weekItem({ dayOffset: 7 }),
      weekItem({ dayOffset: 6, title: "Kept" }),
    ]);
    expect(out).toBe("6|540|630|0|Kept");
  });

  it("caps items per day without starving later days", () => {
    const packed = Array.from({ length: DEVICE_WEEK_MAX_PER_DAY + 3 }, (_, i) =>
      weekItem({ dayOffset: 1, startMin: 400 + i * 30, endMin: 420 + i * 30, title: `A${i}` }),
    );
    const out = encodeWeekAgendaForDevice([...packed, weekItem({ dayOffset: 2, title: "Later" })]);
    const parts = out.split(";");
    expect(parts.filter((p) => p.startsWith("1|"))).toHaveLength(DEVICE_WEEK_MAX_PER_DAY);
    expect(parts.at(-1)).toContain("Later");
  });

  it("caps the total item count", () => {
    const many: DeviceWeekAgendaItem[] = [];
    for (let day = 1; day <= 6; day++) {
      for (let i = 0; i < DEVICE_WEEK_MAX_PER_DAY; i++) {
        many.push(
          weekItem({
            dayOffset: day,
            startMin: 400 + i * 40,
            endMin: 430 + i * 40,
            title: `T${i}`,
          }),
        );
      }
    }
    expect(encodeWeekAgendaForDevice(many).split(";")).toHaveLength(DEVICE_WEEK_MAX_ITEMS);
  });

  it("sanitizes titles and keeps 5 fields per item", () => {
    const out = encodeWeekAgendaForDevice([weekItem({ title: 'Lab: "prep" | notes;' })]);
    expect(out.split("|")).toHaveLength(5);
    expect(out).not.toMatch(/["\\]/);
  });

  it("returns empty string for a free week", () => {
    expect(encodeWeekAgendaForDevice([])).toBe("");
  });
});
