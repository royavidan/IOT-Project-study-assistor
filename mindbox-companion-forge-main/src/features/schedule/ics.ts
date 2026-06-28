import { parseDateKey } from "@/lib/dates";
import { COURSE_COLORS } from "@/features/schedule/schedule";

// Parsed output mirrors ScheduleEventInput so the server fn can map it directly.
export interface ParsedEvent {
  title: string;
  courseCode: string | null;
  location: string | null;
  color: string;
  category: "class" | "exam";
  subtype: string | null;
  kind: "weekly" | "once";
  dayOfWeek: number | null;
  eventDate: string | null;
  startTime: string;
  endTime: string;
  notes: string | null;
}

export interface ParsedCourse {
  code: string;
  name: string;
  color: string;
}

export interface ParsedIcs {
  name: string | null;
  courses: ParsedCourse[];
  events: ParsedEvent[];
}

const EXAM_COLOR = "#f43f5e";
const EXAM_RE = /מועד|מבחן|בחינה|exam|test|final|midterm/i;

/** Convert webcal:// links to https:// and validate the scheme. */
export function normalizeIcsUrl(input: string): string {
  const url = input.trim().replace(/^webcal:\/\//i, "https://");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Enter a valid http(s) or webcal calendar link.");
  }
  return url;
}

/** RFC-5545 line unfolding: continuation lines begin with a space or tab. */
function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

interface IcsProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

function splitProp(line: string): IcsProp | null {
  const idx = line.indexOf(":");
  if (idx === -1) return null;
  const left = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const [name, ...paramParts] = left.split(";");
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq !== -1) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value };
}

/** Unescape iCalendar TEXT values (\n \, \; \\). */
function decodeText(value: string): string {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseDt(
  prop: IcsProp,
): { dateKey: string; time: string | null; dateOnly: boolean } | null {
  const value = prop.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}Z?)?/.exec(value);
  if (!m) return null;
  const dateKey = `${m[1]}-${m[2]}-${m[3]}`;
  const time = m[4] ? `${m[4]}:${m[5]}` : null;
  const dateOnly = prop.params.VALUE === "DATE" || !m[4];
  return { dateKey, time, dateOnly };
}

/** Split "הרצאה 10 - מערכות הפעלה" into the leading label and the course name. */
function splitSummary(summary: string): { label: string; courseName: string } {
  const idx = summary.indexOf(" - ");
  if (idx === -1) return { label: "", courseName: summary.trim() };
  return { label: summary.slice(0, idx).trim(), courseName: summary.slice(idx + 3).trim() };
}

function detectSubtype(label: string): string | null {
  if (/הרצאה|lecture/i.test(label)) return "lecture";
  if (/תרגול|תרגיל|tutorial|recitation/i.test(label)) return "tutorial";
  if (/מעבד|\blab\b/i.test(label)) return "lab";
  return null;
}

function addHour(time: string): string {
  const [h, m] = time.split(":").map((n) => Number.parseInt(n, 10));
  const end = (h + 1) % 24;
  return `${String(end).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Parse an iCalendar (.ics) document into courses + schedule events. Tuned to
 * CheeseFork (Technion) feeds: weekly classes via RRULE, all-day exams via
 * VALUE=DATE, Hebrew "{type} {group} - {course}" summaries. Pure + testable.
 */
export function parseIcs(text: string): ParsedIcs {
  const lines = unfold(text);
  const stack: string[] = [];
  let calName: string | null = null;
  let current: Map<string, IcsProp> | null = null;

  const events: ParsedEvent[] = [];
  const courseColor = new Map<string, string>();
  const courses: ParsedCourse[] = [];

  const colorFor = (courseName: string): string => {
    const existing = courseColor.get(courseName);
    if (existing) return existing;
    const color = COURSE_COLORS[courseColor.size % COURSE_COLORS.length].value;
    courseColor.set(courseName, color);
    courses.push({ code: courseName, name: courseName, color });
    return color;
  };

  for (const line of lines) {
    const prop = splitProp(line);
    if (!prop) continue;

    if (prop.name === "BEGIN") {
      stack.push(prop.value.toUpperCase());
      if (prop.value.toUpperCase() === "VEVENT") current = new Map();
      continue;
    }
    if (prop.name === "END") {
      const ended = stack.pop();
      if (ended === "VEVENT" && current) {
        const event = buildEvent(current, colorFor);
        if (event) events.push(event);
        current = null;
      }
      continue;
    }

    if (stack.length === 1 && (prop.name === "NAME" || prop.name === "X-WR-CALNAME")) {
      calName = decodeText(prop.value) || calName;
    }

    // Collect only when directly inside a VEVENT (skips VTIMEZONE & its children).
    if (current && stack[stack.length - 1] === "VEVENT" && !current.has(prop.name)) {
      current.set(prop.name, prop);
    }
  }

  return { name: calName, courses, events };
}

function buildEvent(
  props: Map<string, IcsProp>,
  colorFor: (name: string) => string,
): ParsedEvent | null {
  const summaryProp = props.get("SUMMARY");
  const dtstartProp = props.get("DTSTART");
  if (!summaryProp || !dtstartProp) return null;

  const start = parseDt(dtstartProp);
  if (!start) return null;
  const endProp = props.get("DTEND");
  const end = endProp ? parseDt(endProp) : null;

  const summary = decodeText(summaryProp.value);
  const location = props.get("LOCATION") ? decodeText(props.get("LOCATION")!.value) || null : null;
  const notes = props.get("DESCRIPTION")
    ? decodeText(props.get("DESCRIPTION")!.value) || null
    : null;
  const rrule = props.get("RRULE")?.value ?? "";
  const isWeekly = /FREQ=WEEKLY/i.test(rrule);

  const { label, courseName } = splitSummary(summary);
  if (!courseName) return null;

  const isExam = !isWeekly && EXAM_RE.test(summary);
  const courseColor = colorFor(courseName);

  if (isWeekly) {
    return {
      title: courseName,
      courseCode: courseName,
      location,
      color: courseColor,
      category: "class",
      subtype: detectSubtype(label),
      kind: "weekly",
      dayOfWeek: parseDateKey(start.dateKey).getDay(),
      eventDate: null,
      startTime: start.time ?? "09:00",
      endTime: end?.time ?? (start.time ? addHour(start.time) : "10:00"),
      notes,
    };
  }

  // One-off: exam if it matches keywords, otherwise a one-time class.
  const startTime = start.dateOnly ? "09:00" : (start.time ?? "09:00");
  const endTime = start.dateOnly ? "12:00" : (end?.time ?? addHour(startTime));
  return {
    title: isExam ? (label ? `${courseName} — ${label}` : summary) : courseName,
    courseCode: courseName,
    location,
    color: isExam ? EXAM_COLOR : courseColor,
    category: isExam ? "exam" : "class",
    subtype: isExam ? null : detectSubtype(label),
    kind: "once",
    dayOfWeek: null,
    eventDate: start.dateKey,
    startTime,
    endTime,
    notes,
  };
}
