// Shared Focus Load Estimate heuristic + device->cloud payload contracts.
//
// IMPORTANT: the output is always an *estimate*, never a clinical or validated
// measurement. Any UI surfacing it must label it as such.

export const FOCUS_LOAD_LABEL = "Focus Load Estimate";

/** Presence interruptions treated as the "maximum" (normalizes to 1.0). */
export const PRESENCE_INTERRUPTION_CAP = 5;

export interface FocusLoadInput {
  /** Seconds elapsed in the session so far. */
  elapsedSec: number;
  /** Target session duration in seconds. */
  targetSec: number;
  /** Ambient noise normalized to 0..1. */
  normalizedNoise: number;
  /** Ambient light variance normalized to 0..1. */
  ambientLightVariance: number;
  /** Raw count of presence interruptions so far. */
  presenceInterruptions: number;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

const clamp01 = (value: number) => clamp(value, 0, 1);

/**
 * Heuristic Focus Load Estimate (0-100):
 *
 *   FLE = 0.3 * (elapsed / target)
 *       + 0.3 * normalizedNoise
 *       + 0.2 * ambientLightVariance
 *       + 0.2 * normalizedPresenceInterruptions
 *
 * Each term is clamped to 0..1; the weighted sum (weights total 1.0) is scaled
 * to 0..100 and rounded. Returned value is a transparent estimate only.
 */
export function computeFocusLoad(input: FocusLoadInput): number {
  const elapsedRatio = clamp01(input.targetSec > 0 ? input.elapsedSec / input.targetSec : 0);
  const noise = clamp01(input.normalizedNoise);
  const light = clamp01(input.ambientLightVariance);
  const presence = clamp01(input.presenceInterruptions / PRESENCE_INTERRUPTION_CAP);

  const score = 0.3 * elapsedRatio + 0.3 * noise + 0.2 * light + 0.2 * presence;

  return Math.round(clamp(score * 100, 0, 100));
}

// --- Device -> cloud payload contracts (firmware + simulator share these) ---

export type SessionStatus = "completed" | "interrupted" | "aborted";

export interface EnvReadings {
  noiseAvg: number;
  noisePeak: number;
  tempC: number;
  lightLux: number;
}

export interface FocusLoadSample {
  /** Seconds since session start. */
  t: number;
  /** Estimate value 0..100 at time t. */
  value: number;
}

export interface EnvSample {
  /** Seconds since session start. */
  t: number;
  noise: number;
  tempC: number;
  lightLux: number;
}

export interface SessionPayload {
  deviceId: string;
  profileId: string;
  /** Stable per-session UUID; idempotency key together with deviceId. */
  sessionId: string;
  clientSeq: number;
  startedAt: string;
  endedAt: string;
  targetDurationSec: number;
  actualFocusSec: number;
  mode: string;
  status: SessionStatus;
  breaks: number;
  presenceInterruptions: number;
  env: EnvReadings;
  focusLoadSamples: FocusLoadSample[];
  focusLoadAvg: number;
  /** Optional per-minute environmental samples (Story 8). */
  envSamples?: EnvSample[];
}

export interface TelemetryPayload {
  deviceId: string;
  ts: string;
  state: string;
  batteryPct: number;
  wifiRssi: number;
  sensorHealth: Record<string, unknown> | null;
  firmwareVersion: string;
}
