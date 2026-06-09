/**
 * MindBox device simulator.
 *
 * Pretends to be a MindBox box: seeds a device, posts ~30 days of focus
 * sessions to /ingest/sessions, and streams telemetry to /ingest/telemetry.
 * Uses the shared `x-device-secret` from .env. Session IDs are deterministic
 * (hashed from device + day + index) so re-running is idempotent — the
 * ingestion upsert recognizes them and never creates duplicates.
 *
 * Run (dev server must be running first):
 *   npm run simulate
 *   npm run simulate -- --offline-then-sync
 *   npm run simulate -- --low-battery --ticks=10
 *   npm run simulate -- --sensor-fault
 *
 * Useful options:
 *   --user=<email>   attribute the device to this app user (default: first user)
 *   --device=<id>    device id (default: mindbox-sim-01)
 *   --seed-only      seed + post sessions, then exit (no telemetry stream)
 *   --no-sessions    skip session history (telemetry only)
 *   --ticks=<n>      number of telemetry ticks (default: run until Ctrl+C)
 *   --interval=<ms>  telemetry interval (default: 3000)
 */
import fs from "node:fs";
import process from "node:process";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import {
  computeFocusLoad,
  type SessionPayload,
  type SessionStatus,
  type TelemetryPayload,
} from "../src/lib/focus-load.ts";

// --- env -------------------------------------------------------------------

function loadEnv(): Record<string, string> {
  const path = new URL("../.env", import.meta.url);
  let raw = "";
  try {
    raw = fs.readFileSync(path, "utf8");
  } catch {
    console.error("Could not read .env at the project root.");
    process.exit(1);
  }
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const env = loadEnv();
const BASE = (env.APP_BASE_URL || "http://localhost:8080").replace(/\/$/, "");
const SECRET = env.DEVICE_INGEST_SECRET;
const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SECRET) {
  console.error("DEVICE_INGEST_SECRET is missing from .env.");
  process.exit(1);
}
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing from .env.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- CLI -------------------------------------------------------------------

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function option(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const OFFLINE = flag("offline-then-sync");
const LOW_BATTERY = flag("low-battery");
const SENSOR_FAULT = flag("sensor-fault");
const SEED_ONLY = flag("seed-only");
const NO_SESSIONS = flag("no-sessions");
const DEVICE_ID = option("device", "mindbox-sim-01");
const USER_EMAIL = option("user", "");
const ticksOpt = option("ticks", "");
const TICKS = ticksOpt ? Math.max(1, Number.parseInt(ticksOpt, 10)) : Infinity;
const INTERVAL = Math.max(250, Number.parseInt(option("interval", "3000"), 10) || 3000);

// --- helpers ---------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number, d = 2) => Number(n.toFixed(d));

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** FNV-1a 32-bit hash for seeding the PRNG. */
function hash32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic PRNG so a given key always yields the same session. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic UUID (v4 shape) from a key, so re-runs reuse the same id. */
function deterministicUuid(key: string): string {
  const hex = createHash("sha1").update(key).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  const u = hex.join("");
  return `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20, 32)}`;
}

async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-device-secret": SECRET },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// --- seeding ---------------------------------------------------------------

async function seedDevice(): Promise<void> {
  let ownerId: string | null = null;
  let ownerEmail: string | null = null;

  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) {
    console.warn(`Could not list users: ${error.message}`);
  } else {
    const users = data.users ?? [];
    const target = USER_EMAIL
      ? users.find((u) => (u.email ?? "").toLowerCase() === USER_EMAIL.toLowerCase())
      : users[0];
    if (target) {
      ownerId = target.id;
      ownerEmail = target.email ?? null;
    }
  }

  if (ownerId) {
    console.log(`Attributing device "${DEVICE_ID}" to ${ownerEmail ?? ownerId}`);
  } else {
    console.warn(
      "No app user found to own the device — sessions will be stored unattributed " +
        "(they won't show in the app until the device is claimed). Create an account " +
        "in the app or pass --user=<email>.",
    );
  }

  const { error: devError } = await supabase.from("devices").upsert(
    {
      id: DEVICE_ID,
      owner_user_id: ownerId,
      name: "MindBox Simulator",
      firmware_version: "0.1.0",
      paired_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (devError) {
    console.error(`Failed to seed device: ${devError.message}`);
    process.exit(1);
  }
}

// --- session generation ----------------------------------------------------

const MODES = ["Deep Focus", "Study", "Reading", "Review"];
const STATUSES: SessionStatus[] = ["completed", "completed", "completed", "interrupted", "aborted"];
const SAMPLE_STEP_SEC = 60; // one focus/env sample every minute (Story 8)

function buildSessions(): SessionPayload[] {
  const out: SessionPayload[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
    const day = new Date(today);
    day.setDate(today.getDate() - daysAgo);
    const dayKey = `${DEVICE_ID}:${fmtDate(day)}`;
    const rndDay = mulberry32(hash32(dayKey));

    // Skip some days as "rest days", but always keep the most recent two.
    if (daysAgo > 1 && rndDay() < 0.2) continue;

    const sessionsToday = 1 + Math.floor(rndDay() * 3);
    let hour = 8 + Math.floor(rndDay() * 4);

    for (let i = 0; i < sessionsToday; i++) {
      const key = `${dayKey}:${i}`;
      const rnd = mulberry32(hash32(key));

      const durationMin = 25 + Math.floor(rnd() * 75);
      const targetSec = durationMin * 60;
      const presence = Math.floor(rnd() * 4);
      const actualFocusSec = Math.round(targetSec * (0.7 + rnd() * 0.3));
      const noiseAvg = round(0.2 + rnd() * 0.5);
      const noisePeak = round(Math.min(1, noiseAvg + 0.2 + rnd() * 0.2));
      const lightVar = round(0.1 + rnd() * 0.5);
      const tempC = round(20 + rnd() * 6, 1);
      const lightLux = Math.round(150 + rnd() * 400);

      const start = new Date(day);
      start.setHours(hour, Math.floor(rnd() * 60), 0, 0);
      const end = new Date(start.getTime() + targetSec * 1000);

      const focusLoadAvg = computeFocusLoad({
        elapsedSec: actualFocusSec,
        targetSec,
        normalizedNoise: noiseAvg,
        ambientLightVariance: lightVar,
        presenceInterruptions: presence,
      });

      const focusLoadSamples = [];
      const envSamples = [];
      for (let t = SAMPLE_STEP_SEC; t <= actualFocusSec; t += SAMPLE_STEP_SEC) {
        focusLoadSamples.push({
          t,
          value: computeFocusLoad({
            elapsedSec: t,
            targetSec,
            normalizedNoise: noiseAvg,
            ambientLightVariance: lightVar,
            presenceInterruptions: Math.round((presence * t) / actualFocusSec),
          }),
        });
        envSamples.push({
          t,
          noise: round(clamp01(noiseAvg + (rnd() - 0.5) * 0.1)),
          tempC: round(tempC + (rnd() - 0.5), 1),
          lightLux: Math.round(lightLux + (rnd() - 0.5) * 60),
        });
      }

      out.push({
        deviceId: DEVICE_ID,
        profileId: "A",
        sessionId: deterministicUuid(key),
        clientSeq: out.length + 1,
        startedAt: start.toISOString(),
        endedAt: end.toISOString(),
        targetDurationSec: targetSec,
        actualFocusSec,
        mode: MODES[Math.floor(rnd() * MODES.length)],
        status: STATUSES[Math.floor(rnd() * STATUSES.length)],
        breaks: Math.floor(durationMin / 50),
        presenceInterruptions: presence,
        env: { noiseAvg, noisePeak, tempC, lightLux },
        focusLoadSamples,
        focusLoadAvg,
        envSamples,
      });

      hour += 1 + Math.floor(rnd() * 3);
      if (hour > 21) break;
    }
  }

  return out;
}

async function postBatch(batch: SessionPayload[]): Promise<void> {
  const res = await post("/ingest/sessions", batch);
  if (res.status !== 200) {
    console.error(`  session batch failed (${res.status}):`, JSON.stringify(res.json));
    process.exitCode = 1;
    return;
  }
  console.log(`  synced ${batch.length} sessions -> ${JSON.stringify(res.json)}`);
}

async function postSessions(sessions: SessionPayload[], asOneBatch: boolean): Promise<void> {
  if (sessions.length === 0) return;
  if (asOneBatch) {
    await postBatch(sessions);
    return;
  }
  const chunk = 15;
  for (let i = 0; i < sessions.length; i += chunk) {
    await postBatch(sessions.slice(i, i + chunk));
  }
}

// --- telemetry -------------------------------------------------------------

async function telemetryLoop(): Promise<void> {
  const states = ["idle", "work", "break"];
  let battery = LOW_BATTERY ? 18 : 85;
  let tick = 0;

  console.log(
    `Streaming telemetry every ${INTERVAL}ms` +
      (Number.isFinite(TICKS) ? ` for ${TICKS} ticks...` : " (press Ctrl+C to stop)..."),
  );

  while (tick < TICKS) {
    tick++;
    battery = LOW_BATTERY
      ? Math.max(0, battery - 5)
      : Math.max(20, battery - (Math.random() < 0.3 ? 1 : 0));

    const sensorHealth = SENSOR_FAULT
      ? { tof: "ok", mic: "ok", light: "invalid" }
      : { tof: "ok", mic: "ok", light: "ok" };

    let state: string;
    if (SENSOR_FAULT) state = "danger";
    else if (battery < 5) state = "danger";
    else if (battery < 15) state = "warning";
    else state = states[tick % states.length];

    const telemetry: TelemetryPayload = {
      deviceId: DEVICE_ID,
      ts: new Date().toISOString(),
      state,
      batteryPct: battery,
      wifiRssi: -50 - Math.floor(Math.random() * 25),
      sensorHealth,
      firmwareVersion: "0.1.0",
    };

    const res = await post("/ingest/telemetry", telemetry);
    console.log(
      `  tick ${tick}: state=${state} battery=${battery}% -> ${
        res.status === 200 ? "ok" : `FAIL ${res.status}`
      }`,
    );

    if (tick < TICKS) await sleep(INTERVAL);
  }
}

// --- main ------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`MindBox simulator -> ${BASE} (device "${DEVICE_ID}")`);
  await seedDevice();

  if (!NO_SESSIONS) {
    const sessions = buildSessions();
    if (OFFLINE) {
      console.log(`Offline mode: buffering ${sessions.length} sessions locally...`);
      await sleep(2000);
      console.log("WiFi restored — syncing all buffered sessions in ONE batch...");
      await postSessions(sessions, true);
    } else {
      console.log(`Syncing ${sessions.length} sessions in periodic batches...`);
      await postSessions(sessions, false);
    }
    const { count } = await supabase
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("device_id", DEVICE_ID);
    console.log(`Total sessions in DB for "${DEVICE_ID}": ${count ?? "?"} (stable across re-runs)`);
  }

  if (SEED_ONLY) {
    console.log("Seed-only: skipping telemetry stream.");
    return;
  }

  await telemetryLoop();
}

process.on("SIGINT", () => {
  console.log("\nSimulator stopped.");
  process.exit(0);
});

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
