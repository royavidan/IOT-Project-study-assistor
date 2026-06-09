import { describe, expect, it } from "vitest";

import { dateKeyDaysAgo, localDayRangeIso, toDateKey } from "@/lib/dates";

describe("local date keys", () => {
  it("dateKeyDaysAgo uses the local calendar day", () => {
    const evening = new Date(2026, 5, 9, 23, 30, 0, 0);
    expect(toDateKey(evening)).toBe("2026-06-09");
    expect(dateKeyDaysAgo(0, evening)).toBe("2026-06-09");
    expect(dateKeyDaysAgo(1, evening)).toBe("2026-06-08");
  });

  it("avoids UTC date slicing that shifts the day near midnight", () => {
    const localMidnight = new Date(2026, 5, 9, 0, 0, 0, 0);
    const utcSlice = localMidnight.toISOString().slice(0, 10);
    expect(toDateKey(localMidnight)).toBe("2026-06-09");
    // In many timezones UTC slice differs from the user's local day.
    if (utcSlice !== "2026-06-09") {
      expect(dateKeyDaysAgo(0, localMidnight)).toBe("2026-06-09");
      expect(dateKeyDaysAgo(0, localMidnight)).not.toBe(utcSlice);
    }
  });

  it("localDayRangeIso spans local midnight to end of day", () => {
    const { fromIso, toIso } = localDayRangeIso("2026-06-01", "2026-06-01");
    expect(new Date(fromIso).getTime()).toBeLessThan(new Date(toIso).getTime());
  });
});
