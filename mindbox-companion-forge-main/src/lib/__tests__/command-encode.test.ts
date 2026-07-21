import { describe, expect, it } from "vitest";

import {
  COMMAND_WIRE_CODES,
  DEVICE_COMMAND_TEXT_MAX_BYTES,
  encodeCommandForDevice,
  sanitizeCommandText,
} from "@/features/device/command-encode";

describe("COMMAND_WIRE_CODES", () => {
  it("matches the firmware CmdType enum values", () => {
    // types.h: CMD_START=1, CMD_PAUSE=2, CMD_RESUME=3, CMD_END=4, CMD_RING=5, CMD_MESSAGE=6.
    expect(COMMAND_WIRE_CODES).toEqual({ start: 1, end: 4, ring: 5, message: 6 });
  });
});

describe("sanitizeCommandText", () => {
  it("strips delimiters/quotes and caps at the wire byte budget", () => {
    expect(sanitizeCommandText('Dinner; at "7" |ok\\')).toBe("Dinner at 7 ok");
    const out = sanitizeCommandText("x".repeat(100));
    expect(out).toHaveLength(DEVICE_COMMAND_TEXT_MAX_BYTES);
  });

  it("romanizes Hebrew then caps at the byte budget", () => {
    // "ש" -> "sh": 40 letters -> 80 chars/bytes -> capped to 40 -> "sh" x20.
    const out = sanitizeCommandText("ש".repeat(40));
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(DEVICE_COMMAND_TEXT_MAX_BYTES);
    expect(out).toBe("sh".repeat(20));
  });
});

describe("encodeCommandForDevice", () => {
  it("maps rows to wire fields", () => {
    expect(encodeCommandForDevice({ id: 12, type: "start", arg: 25, text: null })).toEqual({
      cmdId: 12,
      cmdType: 1,
      cmdArg: 25,
      cmdText: "",
    });
    expect(encodeCommandForDevice({ id: 13, type: "message", arg: null, text: "Hi!" })).toEqual({
      cmdId: 13,
      cmdType: 6,
      cmdArg: 0,
      cmdText: "Hi!",
    });
  });

  it("rejects unknown types and bad ids instead of emitting garbage", () => {
    expect(encodeCommandForDevice({ id: 1, type: "reboot", arg: null, text: null })).toBeNull();
    expect(encodeCommandForDevice({ id: 0, type: "ring", arg: null, text: null })).toBeNull();
    expect(encodeCommandForDevice({ id: -3, type: "end", arg: null, text: null })).toBeNull();
  });

  it("normalizes a fractional/negative arg", () => {
    expect(encodeCommandForDevice({ id: 5, type: "start", arg: 24.6, text: null })?.cmdArg).toBe(
      25,
    );
    expect(encodeCommandForDevice({ id: 6, type: "start", arg: -10, text: null })?.cmdArg).toBe(0);
  });
});
