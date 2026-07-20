// device_commands row -> flat downlink fields (one command per config poll).
//
// Wire codes ARE the firmware's CmdType enum values (types.h): CMD_START=1,
// CMD_PAUSE=2, CMD_RESUME=3, CMD_END=4, CMD_RING=5, CMD_MESSAGE=6. The site
// only enqueues start/end/ring/message; 2/3 are reserved for the box itself.

import { sanitizeDeviceString, truncateUtf8Bytes } from "./device-string";

export type DeviceCommandType = "start" | "end" | "ring" | "message";

export const COMMAND_WIRE_CODES: Record<DeviceCommandType, number> = {
  start: 1,
  end: 4,
  ring: 5,
  message: 6,
};

/**
 * Firmware message buffer is char[48] inside a RemoteCmd that rides an 8-slot
 * FreeRTOS queue BY VALUE — keep the payload well under the buffer (40 bytes
 * + NUL headroom) so the struct stays small.
 */
export const DEVICE_COMMAND_TEXT_MAX_BYTES = 40;

/** Sanitize + byte-cap a message for the downlink (multi-byte safe). */
export function sanitizeCommandText(text: string): string {
  return truncateUtf8Bytes(sanitizeDeviceString(text), DEVICE_COMMAND_TEXT_MAX_BYTES).trimEnd();
}

export interface DeviceCommandRow {
  id: number;
  type: string;
  arg: number | null;
  text: string | null;
}

export interface CommandDownlink {
  cmdId: number;
  cmdType: number;
  cmdArg: number;
  cmdText: string;
}

/**
 * Map a queued command row onto the wire fields. Returns null for rows the
 * device could not understand (unknown type, bad id) so the caller can mark
 * them delivered instead of wedging the queue.
 */
export function encodeCommandForDevice(row: DeviceCommandRow): CommandDownlink | null {
  const code = COMMAND_WIRE_CODES[row.type as DeviceCommandType];
  if (!code || !Number.isInteger(row.id) || row.id <= 0) return null;
  const arg = row.arg != null && Number.isFinite(row.arg) ? Math.max(0, Math.round(row.arg)) : 0;
  return {
    cmdId: row.id,
    cmdType: code,
    cmdArg: arg,
    cmdText: sanitizeCommandText(row.text ?? ""),
  };
}
