/**
 * Remove simulator seed data from Supabase.
 *
 * Deletes sessions, telemetry, and the simulator device record so the app
 * starts clean. Real device data is untouched unless you pass --device=<id>.
 *
 *   npm run cleanup
 *   npm run cleanup -- --device=mindbox-sim-01
 */
import fs from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

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

function option(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const env = loadEnv();
const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;
const DEVICE_ID = option("device", "mindbox-sim-01");

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing from .env.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main(): Promise<void> {
  console.log(`Cleaning simulator data for device "${DEVICE_ID}"…`);

  const { count: sessionCount, error: countError } = await supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("device_id", DEVICE_ID);

  if (countError) {
    console.error(`Failed to count sessions: ${countError.message}`);
    process.exit(1);
  }

  const { error: sessionError } = await supabase
    .from("sessions")
    .delete()
    .eq("device_id", DEVICE_ID);

  if (sessionError) {
    console.error(`Failed to delete sessions: ${sessionError.message}`);
    process.exit(1);
  }

  const { error: deviceError } = await supabase.from("devices").delete().eq("id", DEVICE_ID);

  if (deviceError) {
    console.error(`Failed to delete device: ${deviceError.message}`);
    process.exit(1);
  }

  console.log(`Removed ${sessionCount ?? 0} session(s) and device "${DEVICE_ID}".`);
  console.log("Dashboard and history will show empty states until real sessions are logged.");
}

void main();
