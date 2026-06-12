import { describe, expect, it } from "vitest";

import { summarizeSensorHealth } from "@/features/device/sensor-health";

describe("summarizeSensorHealth", () => {
  it("returns empty when no data", () => {
    expect(summarizeSensorHealth(null).hasData).toBe(false);
  });

  it("separates ok and fault sensors", () => {
    const summary = summarizeSensorHealth({ tof: "ok", mic: "invalid", light: "ok" });
    expect(summary.fault).toHaveLength(1);
    expect(summary.fault[0].key).toBe("mic");
    expect(summary.ok).toHaveLength(2);
  });
});
