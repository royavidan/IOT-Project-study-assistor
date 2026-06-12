import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { computeFocusLoad } from "@/lib/focus-load";
import { DEFAULT_SIM_ENV } from "@/lib/simulator-env";
import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase/server";

const MODES = ["Deep Focus", "Study", "Reading", "Review"] as const;
const STATUSES = ["completed", "interrupted", "aborted"] as const;
const DEVICE_STATES = ["idle", "work", "break", "sync", "warning", "danger"] as const;

export function simulatorDeviceId(userId: string): string {
  return `mindbox-sim-${userId.replace(/-/g, "").slice(0, 12)}`;
}

const sessionInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMin: z.number().int().min(1).max(480),
  mode: z.enum(MODES),
  status: z.enum(STATUSES),
  breaks: z.number().int().min(0).max(20).default(0),
  presenceInterruptions: z.number().int().min(0).max(10).default(0),
  focusScore: z.number().int().min(0).max(100).optional(),
  noiseAvg: z.number().min(0).max(1).default(DEFAULT_SIM_ENV.noiseAvg),
  tempC: z.number().min(10).max(40).default(DEFAULT_SIM_ENV.tempC),
  lightLux: z.number().int().min(0).max(5000).default(DEFAULT_SIM_ENV.lightLux),
  lightVariance: z.number().min(0).max(1).default(DEFAULT_SIM_ENV.lightVariance),
});

const SENSOR_HEALTH_STATUSES = ["ok", "fault", "invalid"] as const;

const telemetryInput = z.object({
  state: z.enum(DEVICE_STATES),
  batteryPct: z.number().int().min(0).max(100),
  wifiRssi: z.number().int().min(-100).max(0).default(-55),
  sensorHealth: z
    .object({
      tof: z.enum(SENSOR_HEALTH_STATUSES).default("ok"),
      mic: z.enum(SENSOR_HEALTH_STATUSES).default("ok"),
      light: z.enum(SENSOR_HEALTH_STATUSES).default("ok"),
      temp: z.enum(SENSOR_HEALTH_STATUSES).default("ok"),
    })
    .default({
      tof: "ok",
      mic: "ok",
      light: "ok",
      temp: "ok",
    }),
});

async function requireUser() {
  const {
    data: { user },
    error,
  } = await getSupabaseServerClient().auth.getUser();
  if (error) throw new Error(`Unable to verify session: ${error.message}`);
  if (!user) throw new Error("You must be signed in to use the simulator.");
  return user;
}

async function ensureDevice(userId: string): Promise<string> {
  const deviceId = simulatorDeviceId(userId);
  const admin = getSupabaseAdminClient();
  const { error } = await admin.from("devices").upsert(
    {
      id: deviceId,
      owner_user_id: userId,
      name: "MindBox Simulator",
      firmware_version: "0.1.0-sim",
      paired_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(`Failed to create simulator device: ${error.message}`);
  return deviceId;
}

const SAMPLE_STEP_SEC = 60;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function buildSimulatorSamples(
  sessionId: string,
  actualFocusSec: number,
  targetSec: number,
  env: {
    noiseAvg: number;
    tempC: number;
    lightLux: number;
    lightVariance: number;
  },
  presenceInterruptions: number,
) {
  const focusRows: Array<{ session_id: string; t_sec: number; value: number }> = [];
  const envRows: Array<{
    session_id: string;
    t_sec: number;
    noise: number;
    temp_c: number;
    light_lux: number;
  }> = [];

  for (let t = SAMPLE_STEP_SEC; t <= actualFocusSec; t += SAMPLE_STEP_SEC) {
    focusRows.push({
      session_id: sessionId,
      t_sec: t,
      value: computeFocusLoad({
        elapsedSec: t,
        targetSec,
        normalizedNoise: env.noiseAvg,
        ambientLightVariance: env.lightVariance,
        presenceInterruptions: Math.round((presenceInterruptions * t) / actualFocusSec),
      }),
    });
    envRows.push({
      session_id: sessionId,
      t_sec: t,
      noise: clamp01(env.noiseAvg + (Math.random() - 0.5) * 0.1),
      temp_c: Math.round((env.tempC + (Math.random() - 0.5)) * 10) / 10,
      light_lux: Math.round(env.lightLux + (Math.random() - 0.5) * 60),
    });
  }

  return { focusRows, envRows };
}

export const getSimulatorDevice = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const deviceId = await ensureDevice(user.id);

  const admin = getSupabaseAdminClient();
  const { count } = await admin
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .eq("device_id", deviceId);

  const { data: status } = await admin
    .from("device_status")
    .select("state, battery_pct, wifi_rssi, updated_at")
    .eq("device_id", deviceId)
    .maybeSingle();

  return {
    deviceId,
    sessionCount: count ?? 0,
    status: status
      ? {
          state: String(status.state ?? "idle"),
          batteryPct: Number(status.battery_pct ?? 0),
          wifiRssi: Number(status.wifi_rssi ?? -55),
          updatedAt: String(status.updated_at ?? ""),
        }
      : null,
  };
});

export const submitSimulatorSession = createServerFn({ method: "POST" })
  .validator(sessionInput)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const deviceId = await ensureDevice(user.id);
    const admin = getSupabaseAdminClient();

    const [year, month, day] = data.date.split("-").map(Number);
    const [hour, minute] = data.startTime.split(":").map(Number);
    const started = new Date(year, month - 1, day, hour, minute, 0, 0);
    const targetSec = data.durationMin * 60;
    const actualFocusSec = Math.round(targetSec * (data.status === "completed" ? 0.9 : 0.6));
    const ended = new Date(started.getTime() + targetSec * 1000);

    const focusLoadAvg =
      data.focusScore ??
      computeFocusLoad({
        elapsedSec: actualFocusSec,
        targetSec,
        normalizedNoise: data.noiseAvg,
        ambientLightVariance: data.lightVariance,
        presenceInterruptions: data.presenceInterruptions,
      });

    const sessionId = crypto.randomUUID();
    const { focusRows, envRows } = buildSimulatorSamples(
      sessionId,
      actualFocusSec,
      targetSec,
      {
        noiseAvg: data.noiseAvg,
        tempC: data.tempC,
        lightLux: data.lightLux,
        lightVariance: data.lightVariance,
      },
      data.presenceInterruptions,
    );

    const { error: sessionError } = await admin.from("sessions").insert({
      id: sessionId,
      device_id: deviceId,
      user_id: user.id,
      slot: "A",
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
      target_duration_sec: targetSec,
      actual_focus_sec: actualFocusSec,
      mode: data.mode,
      status: data.status,
      breaks: data.breaks,
      presence_interruptions: data.presenceInterruptions,
      noise_avg: data.noiseAvg,
      temp_c: data.tempC,
      light_lux: data.lightLux,
      focus_load_avg: focusLoadAvg,
      client_seq: Date.now(),
    });

    if (sessionError) {
      throw new Error(`Failed to log session: ${sessionError.message}`);
    }

    if (focusRows.length > 0) {
      const { error: focusError } = await admin.from("focus_load_samples").insert(focusRows);
      if (focusError) {
        throw new Error(`Failed to log focus samples: ${focusError.message}`);
      }
    }

    if (envRows.length > 0) {
      const { error: envError } = await admin.from("env_samples").insert(envRows);
      if (envError) {
        throw new Error(`Failed to log environment samples: ${envError.message}`);
      }
    }

    return {
      sessionId,
      deviceId,
      focusLoadAvg,
      message: `Session logged with environment readings (noise ${data.noiseAvg}, ${data.tempC}°C, ${data.lightLux} lux). Check Dashboard or History.`,
    };
  });

export const submitSimulatorTelemetry = createServerFn({ method: "POST" })
  .validator(telemetryInput)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const deviceId = await ensureDevice(user.id);
    const admin = getSupabaseAdminClient();

    const { error } = await admin.from("device_status").upsert(
      {
        device_id: deviceId,
        state: data.state,
        battery_pct: data.batteryPct,
        wifi_rssi: data.wifiRssi,
        sensor_health: data.sensorHealth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "device_id" },
    );

    if (error) throw new Error(`Failed to update telemetry: ${error.message}`);

    return {
      deviceId,
      message: "Device status updated. Check Dashboard or Device page.",
    };
  });

export const clearSimulatorData = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireUser();
  const deviceId = simulatorDeviceId(user.id);
  const admin = getSupabaseAdminClient();

  const { error: sessionError } = await admin.from("sessions").delete().eq("device_id", deviceId);
  if (sessionError) throw new Error(`Failed to clear sessions: ${sessionError.message}`);

  const { error: statusError } = await admin
    .from("device_status")
    .delete()
    .eq("device_id", deviceId);
  if (statusError) throw new Error(`Failed to clear device status: ${statusError.message}`);

  return { deviceId, message: "Simulator data cleared." };
});
