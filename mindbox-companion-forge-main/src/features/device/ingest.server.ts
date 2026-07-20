import "@tanstack/react-start/server-only";

import { z } from "zod";

import { getServerConfig } from "@/lib/config.server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { computeStreakFromDateKeySet } from "@/lib/streak";
import {
  expandScheduleEvents,
  parseTimeToMinutes,
  type ScheduleEvent,
} from "@/features/schedule/schedule";
import { encodeAgendaForDevice, encodeWeekAgendaForDevice } from "./agenda-encode";
import { sanitizeDeviceString } from "./device-string";
import { encodeCommandForDevice, type CommandDownlink } from "./command-encode";
import { deriveExamDownlink, diffDayKeys, EXAM_LOOKAHEAD_DAYS } from "./exam-encode";
import { DEVICE_HOMEWORK_MAX_ITEMS, encodeHomeworkForDevice } from "./homework-encode";
import { clampThemeId } from "./theme-presets";

const DAY_MS = 86_400_000;

/** Sessions window for streak/week stats — streaks longer than this cap report the cap. */
const STREAK_WINDOW_DAYS = 45;

/** An un-acked command is re-served after this (> one 60s poll — retries are deduped on-box). */
const COMMAND_RESERVE_MS = 75_000;

/** Undelivered commands older than this are never served ("Expired" on /device). */
const COMMAND_EXPIRY_MS = 10 * 60_000;

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
  // Optional so existing firmware stays valid; app-side tagging can fill it in later.
  companions: z.enum(["solo", "with_others"]).optional(),
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
  // Live room conditions (migration 0025). OPTIONAL — firmware that predates
  // them (or lacks the sensor) must not start failing validation.
  tempC: z.number().min(-40).max(85).optional(),
  humidityPct: z.number().min(0).max(100).optional(),
  lightLux: z.number().min(0).optional(),
  noiseDb: z.number().min(0).max(130).optional(),
});

const homeworkUpdateSchema = z.object({
  deviceId: z.string().min(1),
  homeworkId: z.string().uuid(),
  progressPct: z.number().int().min(0).max(100),
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
    companions: s.companions ?? null,
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

  // The device timestamp doubles as "last seen" for the online indicator, so
  // an implausible clock (pre-NTP boot sends epoch-ish values) must not make a
  // live box read as offline — fall back to server time.
  const tsMs = Date.parse(t.ts);
  const tsPlausible = Number.isFinite(tsMs) && Math.abs(Date.now() - tsMs) < 10 * 60_000;
  const legacyRow = {
    device_id: t.deviceId,
    state: t.state,
    battery_pct: t.batteryPct,
    wifi_rssi: t.wifiRssi,
    sensor_health: t.sensorHealth ?? null,
    updated_at: tsPlausible ? t.ts : new Date().toISOString(),
  };
  // Room conditions + running firmware (0025). Null = sensor absent / old
  // firmware; devices.firmware_version stays the at-claim snapshot.
  let { error } = await admin.from("device_status").upsert(
    {
      ...legacyRow,
      temp_c: t.tempC ?? null,
      humidity_pct: t.humidityPct ?? null,
      light_lux: t.lightLux ?? null,
      noise_db: t.noiseDb ?? null,
      firmware_version: t.firmwareVersion,
    },
    { onConflict: "device_id" },
  );
  if (error && /column|schema cache/i.test(error.message)) {
    // Migration 0025 not applied yet — keep the heartbeat flowing with the
    // legacy column set (room fields are dropped until the migration lands).
    ({ error } = await admin.from("device_status").upsert(legacyRow, { onConflict: "device_id" }));
  }
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
    .upsert(
      { code, device_id: deviceId, expires_at: expiresAt, used: false },
      { onConflict: "code" },
    );
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
  // Pending remote commands must not survive into a new owner's pairing.
  await admin.from("device_commands").delete().eq("device_id", deviceId).is("delivered_at", null);

  return json({ ok: true }, 200);
}

/**
 * Homework quick-update from the box (post-session screen: +25% / done).
 * The device only knows uuids it received on the config downlink (hwStr);
 * ownership is re-verified here so a compromised secret still can't touch
 * another user's assignments through a paired device it doesn't own.
 */
async function handleHomework(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const parsed = homeworkUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid homework payload.", details: parsed.error.issues }, 400);
  }
  const { deviceId, homeworkId, progressPct } = parsed.data;
  const admin = getSupabaseAdminClient();

  const { data: device, error: devError } = await admin
    .from("devices")
    .select("owner_user_id")
    .eq("id", deviceId)
    .maybeSingle();
  if (devError) return json({ error: devError.message }, 500);
  const owner = (device as { owner_user_id: string | null } | null)?.owner_user_id ?? null;
  if (!owner) return json({ error: "Device is not paired." }, 404);

  const { data: hw, error: hwError } = await admin
    .from("homework_assignments")
    .select("id, user_id, status")
    .eq("id", homeworkId)
    .maybeSingle();
  if (hwError) return json({ error: hwError.message }, 500);
  const hwRow = hw as { user_id: string; status: string } | null;
  if (!hwRow || hwRow.user_id !== owner) return json({ error: "Assignment not found." }, 404);

  const update: Record<string, unknown> = {
    progress_pct: progressPct,
    updated_at: new Date().toISOString(),
  };
  // "Done on the box" -> 'submitted' (the closest completion state in the
  // pending|submitted|graded model). Never touch an already graded/submitted row's status.
  if (progressPct === 100 && hwRow.status === "pending") update.status = "submitted";

  const { error: updError } = await admin
    .from("homework_assignments")
    .update(update)
    .eq("id", homeworkId);
  if (updError) return json({ error: `Failed to update homework: ${updError.message}` }, 500);

  return json({ ok: true, homeworkId, progressPct, status: update.status ?? hwRow.status }, 200);
}

/** Owner label for the box OLED (display name, else email local-part). */
function ownerDisplayLabel(profile: {
  display_name?: string | null;
  email?: string | null;
}): string {
  // Sanitized like every other downlink string — a quote/backslash in a
  // display name would garble the firmware's naive jStr read of this field.
  const name =
    typeof profile.display_name === "string" ? sanitizeDeviceString(profile.display_name) : "";
  if (name) return name.slice(0, 19);
  const email = typeof profile.email === "string" ? sanitizeDeviceString(profile.email) : "";
  if (email.includes("@")) return email.split("@")[0]!.slice(0, 19);
  return "User";
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
        paired: false,
        showTimer: true,
        hapticsEnabled: true,
        adaptiveCoaching: false,
        nudgesEnabled: true,
        quietStartMin: 65535,
        quietEndMin: 65535,
        dailyGoalMin: 180,
      },
      200,
    );
  }

  const [settingsRes, profileRes, eventsRes] = await Promise.all([
    admin.from("user_settings").select("*").eq("user_id", owner).maybeSingle(),
    admin.from("profiles").select("*").eq("id", owner).maybeSingle(),
    admin
      .from("schedule_events")
      .select(
        "id, title, course_code, color, category, subtype, kind, day_of_week, event_date, start_time, end_time, plan_generated",
      )
      .eq("user_id", owner),
  ]);
  // A failed read must NOT downlink defaults — the box applies whatever a 200
  // carries (e.g. exam DND would un-mute mid-exam). On 500 it simply keeps its
  // last-known settings and retries next poll.
  if (settingsRes.error || profileRes.error || eventsRes.error) {
    const msg = settingsRes.error?.message ?? profileRes.error?.message ?? eventsRes.error?.message;
    return json({ error: `Config read failed: ${msg}` }, 500);
  }
  const s = (settingsRes.data ?? {}) as Record<string, unknown>;
  const p = (profileRes.data ?? {}) as {
    daily_goal_min?: number;
    tz_offset_min?: number;
    display_name?: string | null;
    email?: string | null;
  };

  // Owner-local time helpers via the stored tz offset: shift so UTC getters
  // show the owner's wall clock, regardless of the server's own timezone.
  const offsetMin = Number(p.tz_offset_min ?? 0);
  const ownerLocalKey = (utcMs: number): string => {
    const d = new Date(utcMs + offsetMin * 60000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  };
  const local = new Date(Date.now() + offsetMin * 60000);
  const localMidnightUtcMs =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMin * 60000;
  const localDateKey = ownerLocalKey(Date.now());

  // ONE sessions query powers todayFocusSec (since owner-local midnight, so
  // the box matches the app dashboard), weekFocusMin (rolling 7 local days)
  // and streakDays (walked over owner-local date keys; capped by the window).
  const windowFromIso = new Date(
    localMidnightUtcMs - (STREAK_WINDOW_DAYS - 1) * DAY_MS,
  ).toISOString();
  // Newest-first + explicit limit: if a heavy user ever exceeds the PostgREST
  // row cap, truncation drops the OLDEST rows, so today/week stay exact and
  // only the streak tail shortens.
  const { data: sessionRows } = await admin
    .from("sessions")
    .select("started_at, actual_focus_sec")
    .eq("user_id", owner)
    .gte("started_at", windowFromIso)
    .order("started_at", { ascending: false })
    .limit(1000);
  let todayFocusSec = 0;
  let weekFocusSec = 0;
  const focusDayKeys = new Set<string>();
  const weekStartMs = localMidnightUtcMs - 6 * DAY_MS;
  for (const r of (sessionRows ?? []) as Array<{
    started_at?: string;
    actual_focus_sec?: number;
  }>) {
    const ms = r.started_at ? Date.parse(r.started_at) : Number.NaN;
    if (Number.isNaN(ms)) continue;
    const focusSec = Number(r.actual_focus_sec ?? 0);
    if (ms >= localMidnightUtcMs) todayFocusSec += focusSec;
    if (ms >= weekStartMs) weekFocusSec += focusSec;
    // Any logged session counts toward the streak — matches the app-side
    // computeStreak (which keys on every session's date), so box == site.
    focusDayKeys.add(ownerLocalKey(ms));
  }
  const streakDays = computeStreakFromDateKeySet(focusDayKeys, localDateKey);
  const weekFocusMin = Math.round(weekFocusSec / 60);

  // Schedule expanded ONCE for today..today+14 (owner-local): today's slice
  // becomes the agenda string (Today screen + auto-start), the whole window
  // feeds the exam/DND derivation (exam-encode.ts states the rule).
  const events = ((eventsRes.data ?? []) as Record<string, unknown>[]).map(mapAgendaEventRow);
  const lookaheadKey = ownerLocalKey(Date.now() + EXAM_LOOKAHEAD_DAYS * DAY_MS);
  const occurrences = expandScheduleEvents(events, localDateKey, lookaheadKey, {
    start: typeof s.semester_start === "string" ? s.semester_start.slice(0, 10) : null,
    end: typeof s.semester_end === "string" ? s.semester_end.slice(0, 10) : null,
  });
  const agendaStr = encodeAgendaForDevice(
    occurrences
      .filter((o) => o.date === localDateKey)
      .flatMap((o) => {
        const startMin = parseTimeToMinutes(o.startTime);
        const endMin = parseTimeToMinutes(o.endTime);
        if (startMin == null || endMin == null) return [];
        return [{ startMin, endMin, kind: o.category, title: o.title }];
      }),
  );
  const exam = deriveExamDownlink(Boolean(s.exam_mode ?? false), localDateKey, occurrences);

  // Week paging on the box's Today screen: days 1..6 ahead ride ONE flat
  // string (today itself stays in agendaStr — auto-start logic reads that).
  const weekStr = encodeWeekAgendaForDevice(
    occurrences.flatMap((o) => {
      const dayOffset = diffDayKeys(localDateKey, o.date);
      if (dayOffset < 1 || dayOffset > 6) return [];
      const startMin = parseTimeToMinutes(o.startTime);
      const endMin = parseTimeToMinutes(o.endTime);
      if (startMin == null || endMin == null) return [];
      return [{ dayOffset, startMin, endMin, kind: o.category, title: o.title }];
    }),
  );

  // Pomodoro timing revision: epoch-seconds of the last SITE save. The box
  // adopts focus/break exactly once per new rev (0 = never set on the site),
  // so on-box spinner edits aren't stomped every poll.
  const timingRevMs = s.device_timing_updated_at
    ? Date.parse(String(s.device_timing_updated_at))
    : Number.NaN;
  const timingRev = Number.isNaN(timingRevMs) ? 0 : Math.floor(timingRevMs / 1000);

  // Top pending homework for the box's post-session quick-update screen.
  const { data: hwRows } = await admin
    .from("homework_assignments")
    .select("id, title, progress_pct")
    .eq("user_id", owner)
    .eq("status", "pending")
    .order("due_date", { ascending: true })
    .limit(DEVICE_HOMEWORK_MAX_ITEMS);
  const hwStr = encodeHomeworkForDevice(
    ((hwRows ?? []) as Array<{ id: unknown; title?: unknown; progress_pct?: unknown }>).map(
      (r) => ({
        id: String(r.id),
        title: String(r.title ?? ""),
        progressPct: r.progress_pct == null ? null : Number(r.progress_pct),
      }),
    ),
  );

  // Remote-command channel: first honour the ack from the box's previous poll,
  // then serve the oldest live command (ONE per response; lifecycle + expiry
  // are documented in migration 0024).
  const ackId = Number.parseInt(url.searchParams.get("ack") ?? "", 10);
  if (Number.isInteger(ackId) && ackId > 0) {
    await admin
      .from("device_commands")
      .update({ delivered_at: new Date().toISOString() })
      .eq("id", ackId)
      .eq("device_id", deviceId)
      .is("delivered_at", null);
  }
  // Strict FIFO: always look at the OLDEST live command. If it was served
  // recently (<75s) and not yet acked, serve NOTHING this poll rather than
  // letting a newer command overtake it — ordering beats latency here.
  // The user_id filter drops commands queued by a previous owner (they also
  // get deleted on unpair, but re-pairing can race that cleanup).
  let cmd: CommandDownlink | null = null;
  const { data: cmdRows } = await admin
    .from("device_commands")
    .select("id, type, arg, text, served_at")
    .eq("device_id", deviceId)
    .eq("user_id", owner)
    .is("delivered_at", null)
    .gt("created_at", new Date(Date.now() - COMMAND_EXPIRY_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(1);
  const oldest = (cmdRows ?? [])[0] as
    | {
        id: number;
        type: string;
        arg: number | null;
        text: string | null;
        served_at: string | null;
      }
    | undefined;
  const cmdRow =
    oldest &&
    (oldest.served_at == null || Date.parse(oldest.served_at) < Date.now() - COMMAND_RESERVE_MS)
      ? oldest
      : undefined;
  if (cmdRow) {
    const encoded = encodeCommandForDevice({
      id: Number(cmdRow.id),
      type: String(cmdRow.type),
      arg: cmdRow.arg == null ? null : Number(cmdRow.arg),
      text: cmdRow.text == null ? null : String(cmdRow.text),
    });
    if (encoded) {
      await admin
        .from("device_commands")
        .update({ served_at: new Date().toISOString() })
        .eq("id", cmdRow.id);
      cmd = encoded;
    } else {
      // Un-encodable row (unknown type) — retire it so it can't wedge the queue.
      await admin
        .from("device_commands")
        .update({
          served_at: new Date().toISOString(),
          delivered_at: new Date().toISOString(),
        })
        .eq("id", cmdRow.id);
    }
  }

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
      ownerDisplayName: ownerDisplayLabel(p),
      ownerEmail: (typeof p.email === "string" ? sanitizeDeviceString(p.email) : "").slice(0, 31),
      // Device slice (migration 0022): agenda + website-owned sound config.
      agendaStr,
      weekStr,
      tzOffsetMin: offsetMin,
      soundEnabled: (s.device_sound_enabled as boolean | undefined) ?? true,
      soundLevel: typeof s.device_sound_level === "number" ? s.device_sound_level : 1,
      chimeMask: typeof s.device_chime_mask === "number" ? s.device_chime_mask : 15,
      autoStartEnabled: (s.auto_start_scheduled as boolean | undefined) ?? true,
      // Remote interface control (0025): theme preset + site-set pomodoro timing.
      themeId: clampThemeId(s.device_theme_id),
      focusMin: typeof s.device_focus_min === "number" ? s.device_focus_min : 25,
      breakMin: typeof s.device_break_min === "number" ? s.device_break_min : 5,
      timingRev,
      // Exam/DND + on-device stats + homework quick-update (0025).
      examMode: exam.examMode,
      nextExamDays: exam.nextExamDays,
      nextExamTitle: exam.nextExamTitle,
      streakDays,
      weekFocusMin,
      hwStr,
      // Remote commands (0024): one pending command per poll, acked next poll.
      cmdId: cmd?.cmdId ?? 0,
      cmdType: cmd?.cmdType ?? 0,
      cmdArg: cmd?.cmdArg ?? 0,
      cmdText: cmd?.cmdText ?? "",
    },
    200,
  );
}

/** Minimal row→ScheduleEvent mapping for agenda expansion (server-side). */
function mapAgendaEventRow(row: Record<string, unknown>): ScheduleEvent {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    courseCode: row.course_code ? String(row.course_code) : null,
    location: null,
    color: String(row.color ?? "#6366f1"),
    category: row.category === "exam" ? "exam" : row.category === "study" ? "study" : "class",
    subtype: row.subtype ? String(row.subtype) : null,
    kind: row.kind === "once" ? "once" : "weekly",
    dayOfWeek: row.day_of_week == null ? null : Number(row.day_of_week),
    eventDate: row.event_date ? String(row.event_date) : null,
    startTime: String(row.start_time ?? "09:00"),
    endTime: String(row.end_time ?? "10:00"),
    notes: null,
    examWeight: null,
    examScore: null,
    planGenerated: Boolean(row.plan_generated),
  };
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
    if (url.pathname === "/ingest/homework") return await handleHomework(request);
    return json({ error: "Not found." }, 404);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Ingestion failed." }, 500);
  }
}
