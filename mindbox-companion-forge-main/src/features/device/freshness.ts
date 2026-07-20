// Online/last-seen derivation from device_status.updated_at.
//
// The firmware pushes telemetry every 30 s (TELEMETRY_PERIOD_MS in the S3
// tree's config.h) — the threshold is three missed heartbeats. Pure so the
// boundary is unit-testable; the /device page recomputes it on every render
// (the status query already refetches every 10 s).

export const DEVICE_TELEMETRY_PERIOD_MS = 30_000;

/** 3× the telemetry heartbeat: two missed pushes could just be Wi-Fi jitter. */
export const DEVICE_ONLINE_THRESHOLD_MS = 3 * DEVICE_TELEMETRY_PERIOD_MS;

export interface DeviceFreshness {
  online: boolean;
  /** "Online" / "Last seen 5 min ago" / "Never seen". */
  label: string;
}

export function deriveDeviceFreshness(
  updatedAtIso: string | null | undefined,
  now: number = Date.now(),
): DeviceFreshness {
  if (!updatedAtIso) return { online: false, label: "Never seen" };
  const t = Date.parse(updatedAtIso);
  if (Number.isNaN(t)) return { online: false, label: "Never seen" };
  const age = now - t;
  if (age <= DEVICE_ONLINE_THRESHOLD_MS) return { online: true, label: "Online" };
  const min = Math.floor(age / 60_000);
  if (min < 60) return { online: false, label: `Last seen ${Math.max(1, min)} min ago` };
  const hours = Math.floor(min / 60);
  if (hours < 24) return { online: false, label: `Last seen ${hours} h ago` };
  return { online: false, label: `Last seen ${Math.floor(hours / 24)} d ago` };
}
