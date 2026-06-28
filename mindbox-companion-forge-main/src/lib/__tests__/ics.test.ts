import { describe, expect, it } from "vitest";

import { normalizeIcsUrl, parseIcs } from "@/features/schedule/ics";

// A trimmed CheeseFork (Technion) feed: a VTIMEZONE block (must be skipped), a
// weekly lecture (with a folded SUMMARY line), a weekly tutorial for the same
// course, and an all-day exam (VALUE=DATE + "מועד א'").
const SAMPLE = [
  "BEGIN:VCALENDAR",
  "PRODID:CheeseFork",
  "VERSION:2.0",
  "NAME:אביב 2026",
  "BEGIN:VTIMEZONE",
  "TZID:Asia/Jerusalem",
  "BEGIN:STANDARD",
  "TZNAME:IST",
  "DTSTART:19701025T020000",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "UID:0@cheesefork",
  "RRULE:FREQ=WEEKLY;UNTIL=20260723T000000Z",
  "EXDATE;TZID=Asia/Jerusalem:20260427T143000",
  "DTSTART;TZID=Asia/Jerusalem:20260413T143000",
  "DTEND;TZID=Asia/Jerusalem:20260413T163000",
  "LOCATION:אולמן 302",
  "SUMMARY;LANGUAGE=en-us:הרצאה 10 - מערכות הפ",
  " עלה",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:1@cheesefork",
  "RRULE:FREQ=WEEKLY;UNTIL=20260723T000000Z",
  "DTSTART;TZID=Asia/Jerusalem:20260414T163000",
  "DTEND;TZID=Asia/Jerusalem:20260414T183000",
  "SUMMARY;LANGUAGE=en-us:תרגיל 21 - מערכות הפעלה",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:8@cheesefork",
  "DTSTART;VALUE=DATE:20260804",
  "SUMMARY;LANGUAGE=en-us:מועד א' - מערכות הפעלה",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcs (CheeseFork)", () => {
  const parsed = parseIcs(SAMPLE);

  it("reads the calendar name and skips VTIMEZONE", () => {
    expect(parsed.name).toBe("אביב 2026");
    // Three VEVENTs only — nothing from VTIMEZONE/STANDARD.
    expect(parsed.events).toHaveLength(3);
  });

  it("dedupes the course across lecture/tutorial/exam", () => {
    expect(parsed.courses).toHaveLength(1);
    expect(parsed.courses[0]).toMatchObject({ code: "מערכות הפעלה", name: "מערכות הפעלה" });
  });

  it("parses a weekly lecture with unfolded summary, weekday, and times", () => {
    const lecture = parsed.events.find((e) => e.kind === "weekly" && e.subtype === "lecture");
    expect(lecture).toBeTruthy();
    expect(lecture).toMatchObject({
      category: "class",
      subtype: "lecture",
      kind: "weekly",
      dayOfWeek: 1, // 2026-04-13 is a Monday
      startTime: "14:30",
      endTime: "16:30",
      courseCode: "מערכות הפעלה",
      location: "אולמן 302",
    });
    // The folded "מערכות הפ" + " עלה" must rejoin to the full course name.
    expect(lecture?.title).toBe("מערכות הפעלה");
  });

  it("maps תרגיל to the tutorial subtype", () => {
    const tutorial = parsed.events.find((e) => e.subtype === "tutorial");
    expect(tutorial).toMatchObject({ category: "class", subtype: "tutorial", kind: "weekly" });
  });

  it("treats an all-day מועד as a one-off exam with default times", () => {
    const exam = parsed.events.find((e) => e.category === "exam");
    expect(exam).toMatchObject({
      category: "exam",
      kind: "once",
      eventDate: "2026-08-04",
      startTime: "09:00",
      endTime: "12:00",
      dayOfWeek: null,
    });
    expect(exam?.title).toContain("מועד");
  });
});

describe("normalizeIcsUrl", () => {
  it("converts webcal:// to https:// and passes http(s)", () => {
    expect(normalizeIcsUrl("webcal://files.cheesefork.cf/x/spring.ics")).toBe(
      "https://files.cheesefork.cf/x/spring.ics",
    );
    expect(normalizeIcsUrl("  https://a.b/c.ics ")).toBe("https://a.b/c.ics");
  });

  it("rejects non-http links", () => {
    expect(() => normalizeIcsUrl("ftp://nope")).toThrow();
  });
});
