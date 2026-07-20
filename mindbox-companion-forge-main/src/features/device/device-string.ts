// Shared helpers for every STRING field on the device config downlink.
//
// The firmware's flat-JSON reader (`jStr` in Cloud.cpp) is naive: it stops at
// the first `"` and cannot unescape `\`, so either character inside a value
// truncates the WHOLE response. The delimited wire lists (agendaStr, hwStr)
// additionally use `|` and `;` as separators, and control characters confuse
// the TFT renderer. Every downlink string MUST therefore pass through
// sanitizeDeviceString + a UTF-8 byte cap before being emitted.
//
// Pure + unit-tested (device-string.test.ts); the caps that use these helpers
// mirror fixed char[] buffers on the firmware side.

const utf8 = new TextEncoder();

/** Truncate to a UTF-8 byte budget without splitting a multi-byte char. */
export function truncateUtf8Bytes(text: string, maxBytes: number): string {
  if (utf8.encode(text).length <= maxBytes) return text;
  let out = "";
  for (const ch of text) {
    if (utf8.encode(out + ch).length > maxBytes) break;
    out += ch;
  }
  return out;
}

/**
 * Replace the characters that can break the firmware parser or the delimited
 * wire lists (`|` `;` `"` `\` + control chars) with spaces, then collapse
 * whitespace. Byte-capping is the caller's job (buffers differ per field).
 */
export function sanitizeDeviceString(text: string): string {
  let replaced = "";
  for (const ch of text) {
    const bad = ch === "|" || ch === ";" || ch === '"' || ch === "\\" || ch.charCodeAt(0) < 32;
    replaced += bad ? " " : ch;
  }
  return replaced.replace(/\s+/g, " ").trim();
}
