import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase/server";

const claimInput = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code shown on your MindBox."),
});

const renameInput = z.object({
  deviceId: z.string().min(1),
  name: z.string().trim().min(1, "Enter a name.").max(40),
});

async function requireUser() {
  const {
    data: { user },
    error,
  } = await getSupabaseServerClient().auth.getUser();
  if (error) throw new Error(`Unable to verify session: ${error.message}`);
  if (!user) throw new Error("You must be signed in to pair a device.");
  return user;
}

function sixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * Claim a device using the one-time code it displays (Story 14). On a real
 * device the firmware writes the code to device_pairing_codes; here we validate
 * it, transfer ownership to the signed-in user, and burn the code.
 */
export const claimDeviceByCode = createServerFn({ method: "POST" })
  .validator(claimInput)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const admin = getSupabaseAdminClient();

    const { data: codeRow, error: lookupError } = await admin
      .from("device_pairing_codes")
      .select("code, device_id, expires_at, used")
      .eq("code", data.code)
      .maybeSingle();

    if (lookupError) throw new Error(`Could not look up code: ${lookupError.message}`);
    if (!codeRow) throw new Error("Invalid pairing code.");

    const row = codeRow as Record<string, unknown>;
    if (row.used === true) throw new Error("This pairing code has already been used.");
    const expiresAt = row.expires_at ? new Date(String(row.expires_at)).getTime() : null;
    if (expiresAt != null && expiresAt < Date.now()) {
      throw new Error("This pairing code has expired. Generate a fresh one on the device.");
    }

    const deviceId = String(row.device_id ?? "");
    if (!deviceId) throw new Error("Pairing code is not linked to a device.");

    const { data: device, error: claimError } = await admin
      .from("devices")
      .update({ owner_user_id: user.id, paired_at: new Date().toISOString() })
      .eq("id", deviceId)
      .select("id, name, firmware_version, paired_at")
      .maybeSingle();
    if (claimError) throw new Error(`Failed to claim device: ${claimError.message}`);

    const { error: burnError } = await admin
      .from("device_pairing_codes")
      .update({ used: true })
      .eq("code", data.code);
    if (burnError) throw new Error(`Failed to consume code: ${burnError.message}`);

    const claimed = (device ?? {}) as Record<string, unknown>;
    return {
      ok: true as const,
      deviceId,
      name: String(claimed.name ?? "MindBox"),
      firmwareVersion: claimed.firmware_version ? String(claimed.firmware_version) : null,
      pairedAt: claimed.paired_at ? String(claimed.paired_at) : new Date().toISOString(),
    };
  });

/**
 * Sign the MindBox out of this account (remote unlink). Releases ownership of
 * every device the caller owns; the box sees `paired:false` on its next config
 * sync (GET /ingest/config) and signs out locally. Also clears slot assignments
 * and burns outstanding pairing codes so an old code can't silently re-claim it.
 */
export const unlinkDevice = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireUser();
  const admin = getSupabaseAdminClient();

  const { data: devices, error: findError } = await admin
    .from("devices")
    .select("id")
    .eq("owner_user_id", user.id);
  if (findError) throw new Error(`Could not load your devices: ${findError.message}`);

  const ids = (devices ?? []).map((d) => String((d as { id: string }).id));
  if (ids.length === 0) return { ok: true as const, unlinked: 0 };

  const { error: unlinkError } = await admin
    .from("devices")
    .update({ owner_user_id: null, paired_at: null })
    .in("id", ids);
  if (unlinkError) throw new Error(`Failed to unlink: ${unlinkError.message}`);

  await admin.from("device_profiles").delete().in("device_id", ids);
  await admin
    .from("device_pairing_codes")
    .update({ used: true })
    .in("device_id", ids)
    .eq("used", false);

  return { ok: true as const, unlinked: ids.length };
});

/** Rename the caller's MindBox (owner-checked). */
export const renameDevice = createServerFn({ method: "POST" })
  .validator(renameInput)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const admin = getSupabaseAdminClient();
    const { error } = await admin
      .from("devices")
      .update({ name: data.name })
      .eq("id", data.deviceId)
      .eq("owner_user_id", user.id);
    if (error) throw new Error(`Failed to rename: ${error.message}`);
    return { ok: true as const, name: data.name };
  });

/**
 * Dev/demo helper: mints an UNCLAIMED device + a fresh pairing code so the
 * claim flow can be exercised without physical hardware. A real device would
 * create this row itself. Returns the code to type into the pairing form.
 */
export const createTestPairingCode = createServerFn({ method: "POST" }).handler(async () => {
  await requireUser();
  const admin = getSupabaseAdminClient();

  const deviceId = `mindbox-pair-${Math.random().toString(36).slice(2, 8)}`;
  const code = sixDigitCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { error: devError } = await admin.from("devices").upsert(
    {
      id: deviceId,
      owner_user_id: null,
      name: "MindBox (unclaimed)",
      firmware_version: "0.1.0",
      paired_at: null,
    },
    { onConflict: "id" },
  );
  if (devError) throw new Error(`Failed to create test device: ${devError.message}`);

  // Seed an idle status row so the device shows up after claiming.
  await admin.from("device_status").upsert(
    {
      device_id: deviceId,
      state: "idle",
      battery_pct: 100,
      wifi_rssi: -55,
      sensor_health: { tof: "ok", mic: "ok", light: "ok" },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "device_id" },
  );

  const { error: codeError } = await admin
    .from("device_pairing_codes")
    .insert({ code, device_id: deviceId, expires_at: expiresAt, used: false });
  if (codeError) throw new Error(`Failed to create pairing code: ${codeError.message}`);

  return { code, deviceId, expiresAt };
});
