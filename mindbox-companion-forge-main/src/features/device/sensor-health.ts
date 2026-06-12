const SENSOR_LABELS: Record<string, string> = {
  tof: "Distance (presence)",
  mic: "Microphone (noise)",
  light: "Light sensor",
  temp: "Temperature",
  noise: "Noise",
};

function labelFor(key: string): string {
  return SENSOR_LABELS[key] ?? key.replace(/_/g, " ");
}

function isFault(value: unknown): boolean {
  if (value == null) return false;
  const s = String(value).toLowerCase();
  return s === "invalid" || s === "fault" || s === "error" || s === "fail" || s === "failed";
}

export interface SensorHealthSummary {
  ok: { key: string; label: string; status: string }[];
  fault: { key: string; label: string; status: string }[];
  hasData: boolean;
}

export function summarizeSensorHealth(
  health: Record<string, unknown> | null | undefined,
): SensorHealthSummary {
  if (!health || Object.keys(health).length === 0) {
    return { ok: [], fault: [], hasData: false };
  }

  const ok: SensorHealthSummary["ok"] = [];
  const fault: SensorHealthSummary["fault"] = [];

  for (const [key, value] of Object.entries(health)) {
    const entry = { key, label: labelFor(key), status: String(value ?? "unknown") };
    if (isFault(value)) fault.push(entry);
    else ok.push(entry);
  }

  return { ok, fault, hasData: true };
}
