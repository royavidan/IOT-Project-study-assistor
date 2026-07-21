import { describe, expect, it } from "vitest";

import { deriveDeviceFreshness, DEVICE_ONLINE_THRESHOLD_MS } from "@/features/device/freshness";

const NOW = Date.parse("2026-07-17T12:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("deriveDeviceFreshness", () => {
  it("is online within the threshold (3× the 30s heartbeat)", () => {
    expect(DEVICE_ONLINE_THRESHOLD_MS).toBe(90_000);
    expect(deriveDeviceFreshness(iso(0), NOW)).toEqual({ online: true, label: "Online" });
    expect(deriveDeviceFreshness(iso(89_000), NOW).online).toBe(true);
  });

  it("goes offline just past the threshold", () => {
    const r = deriveDeviceFreshness(iso(91_000), NOW);
    expect(r.online).toBe(false);
    expect(r.label).toBe("Last seen 1 min ago");
  });

  it("formats minutes, hours and days", () => {
    expect(deriveDeviceFreshness(iso(5 * 60_000), NOW).label).toBe("Last seen 5 min ago");
    expect(deriveDeviceFreshness(iso(3 * 3_600_000), NOW).label).toBe("Last seen 3 h ago");
    expect(deriveDeviceFreshness(iso(49 * 3_600_000), NOW).label).toBe("Last seen 2 d ago");
  });

  it("treats missing/invalid timestamps as never seen", () => {
    expect(deriveDeviceFreshness(null, NOW)).toEqual({ online: false, label: "Never seen" });
    expect(deriveDeviceFreshness("garbage", NOW).label).toBe("Never seen");
  });

  it("tolerates slight clock skew (future timestamp = online)", () => {
    expect(deriveDeviceFreshness(iso(-10_000), NOW).online).toBe(true);
  });
});
