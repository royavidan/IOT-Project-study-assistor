import "@tanstack/react-start/server-only";

import { z } from "zod";

import { getServerConfig } from "@/lib/config.server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Validates the shared device secret (constant-ish comparison). */
function isAuthorized(request: Request): boolean {
  const { deviceIngestSecret } = getServerConfig();
  if (!deviceIngestSecret) return false;
  const provided = request.headers.get("x-device-secret");
  if (!provided || provided.length !== deviceIngestSecret.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ deviceIngestSecret.charCodeAt(i);
  }
  return mismatch === 0;
}

// --- Validation schemas (mirror the contracts in src/lib/focus-load.ts) ---

const envSchema = z.object({
  noiseAvg: z.number(),
  noisePeak: z.number(),
  tempC: z.number(),
  lightLux: z.number(),
});

const focusSampleSchema = z.object({ t: z.number(), value: z.number() });

const envSampleSchema = z.object({
  t: z.number(),
  noise: z.number(),
  tempC: z.number(),
  lightLux: z.number(),
});

const sessionSchema = z.object({
  deviceId: z.string().min(1),
  profileId: z.string().min(1),
  sessionId: z.string().uuid(),
  clientSeq: z.number().int().nonnegative(),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1),
  targetDurationSec: z.number().int().nonnegative(),
  actualFocusSec: z.number().int().nonnegative(),
  mode: z.string().min(1),
  status: z.string().min(1),
  breaks: z.number().int().nonnegative().default(0),
  presenceInterruptions: z.number().int().nonnegative().default(0),
  env: envSchema,
  focusLoadSamples: z.array(focusSampleSchema).default([]),
  focusLoadAvg: z.number().int().min(0).max(100),
  envSamples: z.array(envSampleSchema).optional(),
});

const sessionsBatchSchema = z.array(sessionSchema).min(1);

const telemetrySchema = z.object({
  deviceId: z.string().min(1),
  ts: z.string().min(1),
  state: z.string().min(1),
  batteryPct: z.number().int().min(0).max(100),
  wifiRssi: z.number().int(),
  sensorHealth: z.record(z.string(), z.unknown()).nullable().optional(),
  firmwareVersion: z.string().min(1),
});

const pairingSchema = z.object({
  deviceId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});

const unpairSchema = z.object({
  deviceId: z.string().min(1),
});

type SessionInput = z.infer<typeof sessionSchema>;

async function handleSessions(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const parsed = sessionsBatchSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid session batch.", details: parsed.error.issues }, 400);
  }
  const batch = parsed.data;
  const admin = getSupabaseAdminClient();

  // Resolve user_id per session: device_profiles(device, slot) -> device owner.
  const deviceIds = [...new Set(batch.map((s) => s.deviceId))];
  const [devRes, dpRes] = await Promise.all([
    admin.from("devices").select("id, owner_user_id").in("id", deviceIds),
    admin.from("device_profiles").select("device_id, slot, user_id").in("device_id", deviceIds),
  ]);

  const ownerByDevice = new Map<string, string | null>();
  for (const row of (devRes.data ?? []) as Array<{
    id: string;
    owner_user_id: string | null;
  }>) {
    ownerByDevice.set(row.id, row.owner_user_id ?? null);
  }
  const userBySlot = new Map<string, string | null>();
  for (const row of (dpRes.data ?? []) as Array<{
    device_id: string;
    slot: string | null;
    user_id: string | null;
  }>) {
    userBySlot.set(`${row.device_id}::${row.slot}`, row.user_id ?? null);
  }

  const resolveUser = (s: SessionInput): string | null =>
    userBySlot.get(`${s.deviceId}::${s.profileId}`) ?? ownerByDevice.get(s.deviceId) ?? null;

  const sessionRows = batch.map((s) => ({
    id: s.sessionId,
    device_id: s.deviceId,
    user_id: resolveUser(s),
    slot: s.profileId,
    started_at: s.startedAt,
    ended_at: s.endedAt,
    target_duration_sec: s.targetDurationSec,
    actual_focus_sec: s.actualFocusSec,
    mode: s.mode,
    status: s.status,
    breaks: s.breaks,
    presence_interruptions: s.presenceInterruptions,
    noise_avg: s.env.noiseAvg,
    temp_c: s.env.tempC,
    light_lux: s.env.lightLux,
    focus_load_avg: s.focusLoadAvg,
    client_seq: s.clientSeq,
  }));

  // Idempotent on (device_id, id): re-sent batches update instead of duplicate.
  const { error: upsertError } = await admin
    .from("sessions")
    .upsert(sessionRows, { onConflict: "device_id,id" });
  if (upsertError) {
    return json({ error: `Failed to upsert sessions: ${upsertError.message}` }, 500);
  }

  // Replace child samples so re-posting a batch keeps row counts stable.
  const sessionIds = batch.map((s) => s.sessionId);
  const [delFocus, delEnv] = await Promise.all([
    admin.from("focus_load_samples").delete().in("session_id", sessionIds),
    admin.from("env_samples").delete().in("session_id", sessionIds),
  ]);
  if (delFocus.error) {
    return json({ error: `Failed clearing focus samples: ${delFocus.error.message}` }, 500);
  }
  if (delEnv.error) {
    return json({ error: `Failed clearing env samples: ${delEnv.error.message}` }, 500);
  }

  const focusRows = batch.flatMap((s) =>
    s.focusLoadSamples.map((sample) => ({
      session_id: s.sessionId,
      t_sec: sample.t,
      value: sample.value,
    })),
  );
  const envRows = batch.flatMap((s) =>
    (s.envSamples ?? []).map((sample) => ({
      session_id: s.sessionId,
      t_sec: sample.t,
      noise: sample.noise,
      temp_c: sample.tempC,
      light_lux: sample.lightLux,
    })),
  );

  if (focusRows.length > 0) {
    const { error } = await admin.from("focus_load_samples").insert(focusRows);
    if (error) {
      return json({ error: `Failed inserting focus samples: ${error.message}` }, 500);
    }
  }
  if (envRows.length > 0) {
    const { error } = await admin.from("env_samples").insert(envRows);
    if (error) {
      return json({ error: `Failed inserting env samples: ${error.message}` }, 500);
    }
  }

  return json(
    {
      ok: true,
      sessions: sessionRows.length,
      focusSamples: focusRows.length,
      envSamples: envRows.length,
    },
    200,
  );
}

async function handleTelemetry(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const parsed = telemetrySchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid telemetry payload.", details: parsed.error.issues }, 400);
  }
  const t = parsed.data;
  const admin = getSupabaseAdminClient();

  // device_status.device_id references devices(id); ensure the row exists first
  // (does not overwrite an existing/claimed device).
  const ensure = await admin
    .from("devices")
    .upsert({ id: t.deviceId }, { onConflict: "id", ignoreDuplicates: true });
  if (ensure.error) {
    return json({ error: `Failed ensuring device: ${ensure.error.message}` }, 500);
  }

  const { error } = await admin.from("device_status").upsert(
    {
      device_id: t.deviceId,
      state: t.state,
      battery_pct: t.batteryPct,
      wifi_rssi: t.wifiRssi,
      sensor_health: t.sensorHealth ?? null,
      updated_at: t.ts,
    },
    { onConflict: "device_id" },
  );
  if (error) {
    return json({ error: `Failed to upsert telemetry: ${error.message}` }, 500);
  }

  return json({ ok: true }, 200);
}

/**
 * Device-driven pairing (real hardware): the box mints a 6-digit code, posts it
 * here, and shows it on its OLED. The /device page then claims it. Mirrors the
 * dev-only createTestPairingCode server function, but authed by the shared secret.
 */
async function handlePairing(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const parsed = pairingSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid pairing payload.", details: parsed.error.issues }, 400);
  }
  const { deviceId, code } = parsed.data;
  const admin = getSupabaseAdminClient();

  const ensure = await admin
    .from("devices")
    .upsert({ id: deviceId }, { onConflict: "id", ignoreDuplicates: true });
  if (ensure.error) {
    return json({ error: `Failed ensuring device: ${ensure.error.message}` }, 500);
  }

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { error } = await admin
    .from("device_pairing_codes")
    .upsert({ code, device_id: deviceId, expires_at: expiresAt, used: false }, { onConflict: "code" });
  if (error) {
    return json({ error: `Failed to store pairing code: ${error.message}` }, 500);
  }
  return json({ ok: true, expiresAt }, 200);
}

/**
 * Device-driven sign-out: the box releases its account link from the hardware
 * (Settings -> Device -> Sign out). Clears ownership so handleConfig returns
 * paired:false on the next downlink, and the /device card reflects it. Authed by
 * the shared secret (any box knows its own deviceId), so it cannot release a
 * device it isn't. Mirrors the app-side unlinkDevice server fn.
 */
async function handleUnpair(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const parsed = unpairSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid unpair payload.", details: parsed.error.issues }, 400);
  }
  const { deviceId } = parsed.data;
  const admin = getSupabaseAdminClient();

  const { error } = await admin
    .from("devices")
    .update({ owner_user_id: null, paired_at: null })
    .eq("id", deviceId);
  if (error) {
    return json({ error: `Failed to unpair: ${error.message}` }, 500);
  }

  // Best-effort cleanup so a stale slot/code can't silently re-link the box.
  await admin.from("device_profiles").delete().eq("device_id", deviceId);
  await admin
    .from("device_pairing_codes")
    .update({ used: true })
    .eq("device_id", deviceId)
    .eq("used", false);

  return json({ ok: true }, 200);
}

/** "HH:MM[:SS]" -> minutes-from-midnight; 65535 = unset (matches firmware 0xFFFF). */
function timeToMinutes(t: unknown): number {
  if (typeof t !== "string" || t.length < 4) return 65535;
  const [h, m] = t.split(":").map((n) => Number.parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 65535;
  return h * 60 + m;
}

/**
 * Config downlink: the box GETs the owning user's settings (the site -> box
 * channel). Unclaimed devices get safe defaults. Resolves the owner via the
 * service-role client, so it works without the device having a user session.
 */
async function handleConfig(url: URL): Promise<Response> {
  const deviceId = url.searchParams.get("deviceId");
  if (!deviceId) return json({ error: "deviceId is required." }, 400);
  const admin = getSupabaseAdminClient();

  const { data: device, error: devError } = await admin
    .from("devices")
    .select("owner_user_id")
    .eq("id", deviceId)
    .maybeSingle();
  if (devError) return json({ error: devError.message }, 500);

  const owner = (device as { owner_user_id: string | null } | null)?.owner_user_id ?? null;
  if (!owner) {
    return json(
      {
        paired: false, showTimer: true, hapticsEnabled: true, adaptiveCoaching: false,
        nudgesEnabled: true, quietStartMin: 65535, quietEndMin: 65535, dailyGoalMin: 180,
      },
      200,
    );
  }

  const [settingsRes, profileRes] = await Promise.all([
    admin.from("user_settings").select("*").eq("user_id", owner).maybeSingle(),
    admin.from("profiles").select("*").eq("id", owner).maybeSingle(),
  ]);
  const s = (settingsRes.data ?? {}) as Record<string, unknown>;
  const p = (profileRes.data ?? {}) as { daily_goal_min?: number; tz_offset_min?: number };

  // Today's focus = sum of actual_focus_sec for the owner's sessions since their
  // LOCAL midnight (via the stored tz offset), so the box matches the app dashboard.
  const offsetMin = Number(p.tz_offset_min ?? 0);
  const local = new Date(Date.now() + offsetMin * 60000);
  const localMidnightUtcMs =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMin * 60000;
  const fromIso = new Date(localMidnightUtcMs).toISOString();
  const { data: todayRows } = await admin
    .from("sessions")
    .select("actual_focus_sec")
    .eq("user_id", owner)
    .gte("started_at", fromIso);
  const todayFocusSec = (todayRows ?? []).reduce(
    (sum, r) => sum + Number((r as { actual_focus_sec?: number }).actual_focus_sec ?? 0),
    0,
  );

  return json(
    {
      paired: true,
      showTimer: (s.device_show_timer as boolean | undefined) ?? true,
      hapticsEnabled: (s.haptics_enabled as boolean | undefined) ?? true,
      adaptiveCoaching: (s.adaptive_coaching_enabled as boolean | undefined) ?? false,
      nudgesEnabled: (s.notifications_enabled as boolean | undefined) ?? true,
      quietStartMin: timeToMinutes(s.quiet_hours_start),
      quietEndMin: timeToMinutes(s.quiet_hours_end),
      dailyGoalMin: p.daily_goal_min ?? 180,
      todayFocusSec,
    },
    200,
  );
}

/**
 * Entry point for device ingestion. Called from src/server.ts for `/ingest/*`.
 * Always returns JSON and never throws.
 */
export async function handleIngestRequest(request: Request, url: URL): Promise<Response> {
  try {
    if (!isAuthorized(request)) {
      return json({ error: "Invalid or missing x-device-secret." }, 401);
    }

    // Config is the only GET route.
    if (url.pathname === "/ingest/config") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
      return await handleConfig(url);
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }
    if (url.pathname === "/ingest/sessions") return await handleSessions(request);
    if (url.pathname === "/ingest/telemetry") return await handleTelemetry(request);
    if (url.pathname === "/ingest/pairing") return await handlePairing(request);
    if (url.pathname === "/ingest/unpair") return await handleUnpair(request);
    return json({ error: "Not found." }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Ingestion failed." }, 500);
  }
}
