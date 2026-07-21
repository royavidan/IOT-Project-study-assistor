// Top pending homework -> device string for the post-session quick-update
// screen. Same flat-wire constraints as the agenda:
//
//   "8b0f...-uuid|Calc problem set|50;..."
//    id(uuid36)|title(<=23B)|progressPct
//
// The box shows up to 3 items after a completed work session; tapping +25% /
// done POSTs /ingest/homework with the uuid. Caps mirror the firmware's
// parseHwStr (HwItem { char id[37]; char title[24]; uint8_t pct; }).

import { sanitizeDeviceString, truncateUtf8Bytes } from "./device-string";

export const DEVICE_HOMEWORK_MAX_ITEMS = 3;
export const DEVICE_HOMEWORK_TITLE_MAX_BYTES = 23;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DeviceHomeworkItem {
  id: string;
  title: string;
  progressPct: number | null;
}

/**
 * Encode the top pending assignments (already sorted by due date by the
 * caller). Items without a well-formed uuid are dropped — the firmware parses
 * the id as a FIXED 36-char field, so anything else would corrupt the wire.
 */
export function encodeHomeworkForDevice(items: DeviceHomeworkItem[]): string {
  return items
    .filter((i) => UUID_RE.test(i.id))
    .slice(0, DEVICE_HOMEWORK_MAX_ITEMS)
    .map((i) => {
      const raw = Number(i.progressPct ?? 0);
      const pct = Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 0;
      const title =
        truncateUtf8Bytes(
          sanitizeDeviceString(i.title),
          DEVICE_HOMEWORK_TITLE_MAX_BYTES,
        ).trimEnd() || "Homework";
      return `${i.id.toLowerCase()}|${title}|${pct}`;
    })
    .join(";");
}
