// Agenda → device string encoder. The firmware's config parser is a
// hand-rolled flat-JSON reader (no ArduinoJson, no arrays), so today's agenda
// travels as ONE compact delimited string:
//
//   "540|630|2|Calc HW;660|750|0|Algebra"
//    startMin|endMin|kind|title;...
//
// kind: 0 = class, 1 = exam, 2 = study. Titles are capped at 23 chars (the
// firmware stores char[24]) and stripped of the delimiters. Length caps here
// MUST mirror the firmware's parseAgendaStr. Pure + unit-tested.

import { sanitizeDeviceString, truncateUtf8Bytes } from "./device-string";

export interface DeviceAgendaItem {
  /** Minutes since local midnight, 0..1439. */
  startMin: number;
  endMin: number;
  kind: "class" | "exam" | "study";
  title: string;
}

/** The firmware stores at most this many items per day. */
export const DEVICE_AGENDA_MAX_ITEMS = 12;

/** Firmware title buffer is char[24] — 23 UTF-8 BYTES + NUL. */
export const DEVICE_AGENDA_TITLE_MAX_BYTES = 23;

const KIND_CODE: Record<DeviceAgendaItem["kind"], number> = { class: 0, exam: 1, study: 2 };

function sanitizeTitle(title: string): string {
  // Shared downlink-string rules (device-string.ts strips `|;"\` + control
  // chars), then cap by UTF-8 bytes — the firmware buffer is byte-sized
  // (char[24]) so a Hebrew title can't be cut mid-character into mojibake.
  return truncateUtf8Bytes(sanitizeDeviceString(title), DEVICE_AGENDA_TITLE_MAX_BYTES).trimEnd();
}

/** The firmware grammar clamps minutes to 0..1439, so 1440 ("24:00") is out. */
function hasValidTimes(i: DeviceAgendaItem): boolean {
  return (
    Number.isInteger(i.startMin) &&
    Number.isInteger(i.endMin) &&
    i.startMin >= 0 &&
    i.startMin < 1440 &&
    i.endMin > i.startMin &&
    i.endMin <= 1439
  );
}

/**
 * Encode today's agenda for the config downlink. Invalid items (bad or
 * inverted times) are dropped; the rest are sorted by start and capped at
 * DEVICE_AGENDA_MAX_ITEMS. Empty string = nothing today.
 */
export function encodeAgendaForDevice(items: DeviceAgendaItem[]): string {
  const valid = items.filter(hasValidTimes);
  valid.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  return valid
    .slice(0, DEVICE_AGENDA_MAX_ITEMS)
    .map((i) => `${i.startMin}|${i.endMin}|${KIND_CODE[i.kind]}|${sanitizeTitle(i.title)}`)
    .join(";");
}

// --- Week-browse extension (device "Today" screen day paging) ---------------

/** An item on one of the UPCOMING days (today itself rides agendaStr). */
export interface DeviceWeekAgendaItem extends DeviceAgendaItem {
  /** Owner-local days ahead of today, 1..6. */
  dayOffset: number;
}

/** Total wire/RAM cap across all six upcoming days (firmware week[36]). */
export const DEVICE_WEEK_MAX_ITEMS = 36;

/** Per-day cap keeps one packed day from starving the rest of the week. */
export const DEVICE_WEEK_MAX_PER_DAY = 10;

/**
 * Encode days 1..6 ahead as ONE flat string for the device's week paging:
 *
 *   "1|540|630|0|Algebra;3|600|780|1|Calc exam"
 *    dayOffset|startMin|endMin|kind|title;...
 *
 * Same sanitation/caps as the daily agenda; sorted by (day, start); items
 * beyond the per-day or total cap are dropped. Empty string = free week.
 */
export function encodeWeekAgendaForDevice(items: DeviceWeekAgendaItem[]): string {
  const valid = items.filter(
    (i) =>
      Number.isInteger(i.dayOffset) && i.dayOffset >= 1 && i.dayOffset <= 6 && hasValidTimes(i),
  );
  valid.sort((a, b) => a.dayOffset - b.dayOffset || a.startMin - b.startMin || a.endMin - b.endMin);
  const perDay = new Map<number, number>();
  const out: string[] = [];
  for (const i of valid) {
    if (out.length >= DEVICE_WEEK_MAX_ITEMS) break;
    const n = perDay.get(i.dayOffset) ?? 0;
    if (n >= DEVICE_WEEK_MAX_PER_DAY) continue;
    perDay.set(i.dayOffset, n + 1);
    out.push(
      `${i.dayOffset}|${i.startMin}|${i.endMin}|${KIND_CODE[i.kind]}|${sanitizeTitle(i.title)}`,
    );
  }
  return out.join(";");
}
