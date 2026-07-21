// Server assembly for the calibrated focus/energy estimate.
//
// Fetches the signed-in user's recent sessions + their per-minute focus/env
// samples + tiredness check-ins (RLS-scoped), turns each session into a feature
// record (Layer 2 dynamics + aggregates + recent cumulative strain), builds
// per-user baselines (Layer 3), fits the calibrated model on the tiredness
// labels (Layer 5), and composes the honest estimate (Layer 6). Pure numeric
// work lives in `@/lib/focus/*`; this file only does I/O + wiring.

import "@tanstack/react-start/server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { parseDateKey, toDateKey } from "@/lib/dates";
import { ewma } from "@/lib/stats/robust";
import { computeBaselines } from "@/lib/focus/baselines";
import { computeSessionDynamics, type SessionSeriesPoint } from "@/lib/focus/session-dynamics";
import {
  FEATURE_PRIORS,
  fitFocusModel,
  predictTiredness,
  type LabeledSample,
} from "@/lib/focus/model";
import { composeFocusState, type FocusStateEstimate } from "@/lib/focus/focus-state";
import { computeTrend, type DailyPoint } from "@/lib/focus/trends";
import { strainMinutes } from "@/lib/study-strain";
import type { Companions, SessionMode } from "@/lib/types";

/** Recent-history window fed to the estimator. */
const WINDOW_DAYS = 60;
/** Need at least this many sessions to say anything at all. */
const MIN_SESSIONS = 4;
/** Half-life (days) for the "recent cumulative load" context feature. */
const STRAIN_HALF_LIFE = 3;
/** Recency half-life (sessions) for the "current typical session" feature row. */
const CURRENT_HALF_LIFE_SESSIONS = 4;

export interface FocusEstimateResult {
  ready: boolean;
  reason: string | null;
  estimate: FocusStateEstimate | null;
}

interface SessionRow {
  id: string;
  started_at: string | null;
  actual_focus_sec: number | null;
  mode: string | null;
  status: string | null;
  focus_load_avg: number | null;
  noise_avg: number | null;
  presence_interruptions: number | null;
  companions: string | null;
  tiredness: number | null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Merge a session's focus + env sample rows onto a shared per-minute axis. */
function mergeSeries(
  focusRows: { t_sec: number; value: number }[],
  envRows: {
    t_sec: number;
    noise: number | null;
    temp_c: number | null;
    light_lux: number | null;
  }[],
): SessionSeriesPoint[] {
  const byMin = new Map<number, SessionSeriesPoint>();
  const at = (tSec: number): SessionSeriesPoint => {
    const tMin = Math.round(tSec / 60);
    let p = byMin.get(tMin);
    if (!p) {
      p = { tMin, focus: null, noise: null, tempC: null, lightLux: null };
      byMin.set(tMin, p);
    }
    return p;
  };
  for (const r of focusRows) at(Number(r.t_sec ?? 0)).focus = num(r.value);
  for (const r of envRows) {
    const p = at(Number(r.t_sec ?? 0));
    p.noise = num(r.noise);
    p.tempC = num(r.temp_c);
    p.lightLux = num(r.light_lux);
  }
  return [...byMin.values()].sort((a, b) => a.tMin - b.tMin);
}

/**
 * Compute the honest focus/energy estimate for a user. `supabase` is the
 * request-scoped RLS client, so it only ever sees the user's own rows.
 */
export async function computeFocusEstimate(
  supabase: SupabaseClient,
  userId: string,
): Promise<FocusEstimateResult> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const { data: sessionData, error: sErr } = await supabase
    .from("sessions")
    .select(
      "id, started_at, actual_focus_sec, mode, status, focus_load_avg, noise_avg, presence_interruptions, companions, tiredness",
    )
    .eq("user_id", userId)
    .gte("started_at", since)
    .order("started_at", { ascending: true });
  if (sErr) throw new Error(sErr.message);

  const sessions = (sessionData ?? []) as SessionRow[];
  if (sessions.length < MIN_SESSIONS) {
    return { ready: false, reason: "not-enough-sessions", estimate: null };
  }

  // Per-minute samples for all these sessions in two batched queries.
  const ids = sessions.map((s) => s.id);
  const [focusRes, envRes] = await Promise.all([
    supabase.from("focus_load_samples").select("session_id, t_sec, value").in("session_id", ids),
    supabase
      .from("env_samples")
      .select("session_id, t_sec, noise, temp_c, light_lux")
      .in("session_id", ids),
  ]);
  if (focusRes.error) throw new Error(focusRes.error.message);
  if (envRes.error) throw new Error(envRes.error.message);

  const focusBySession = new Map<string, { t_sec: number; value: number }[]>();
  for (const r of (focusRes.data ?? []) as Record<string, unknown>[]) {
    const sid = String(r.session_id);
    (focusBySession.get(sid) ?? focusBySession.set(sid, []).get(sid)!).push({
      t_sec: Number(r.t_sec ?? 0),
      value: Number(r.value ?? 0),
    });
  }
  const envBySession = new Map<string, Record<string, unknown>[]>();
  for (const r of (envRes.data ?? []) as Record<string, unknown>[]) {
    const sid = String(r.session_id);
    (envBySession.get(sid) ?? envBySession.set(sid, []).get(sid)!).push(r);
  }

  // Daily strain totals (local-ish day = session's UTC date), for the recent-
  // cumulative-load feature and the trend series.
  const dailyStrain = new Map<string, number>();
  const dayOf = (iso: string | null): string => toDateKey(iso ? new Date(iso) : new Date());
  const dayNum = (key: string): number => Math.round(parseDateKey(key).getTime() / 86_400_000);
  for (const s of sessions) {
    const key = dayOf(s.started_at);
    const strain = strainMinutes({
      mode: (s.mode ?? "Study") as SessionMode,
      companions: (s.companions ?? undefined) as Companions | undefined,
      durationMin: Math.round((s.actual_focus_sec ?? 0) / 60),
    });
    dailyStrain.set(key, (dailyStrain.get(key) ?? 0) + strain);
  }
  const strainPoints: DailyPoint[] = [...dailyStrain.entries()]
    .map(([k, v]) => ({ t: dayNum(k), v }))
    .sort((a, b) => a.t - b.t);

  const recentStrainAt = (dayKey: string): number => {
    const d = dayNum(dayKey);
    const upto = strainPoints.filter((p) => p.t <= d);
    return upto.length ? ewma(upto, STRAIN_HALF_LIFE, d) : 0;
  };

  // Build a feature record per session.
  const featureRows: Record<string, number>[] = [];
  const labeled: LabeledSample[] = [];
  sessions.forEach((s, idx) => {
    const series = mergeSeries(
      focusBySession.get(s.id) ?? [],
      (envBySession.get(s.id) ?? []).map((r) => ({
        t_sec: Number(r.t_sec ?? 0),
        noise: num(r.noise),
        temp_c: num(r.temp_c),
        light_lux: num(r.light_lux),
      })),
    );
    const dyn = computeSessionDynamics(series);
    const minutes = Math.round((s.actual_focus_sec ?? 0) / 60);
    const features: Record<string, number> = {
      // Prefer the richer per-minute dynamics; fall back to the session aggregate.
      loadMean: dyn.nSamples > 0 ? dyn.loadMean : (s.focus_load_avg ?? 0),
      loadSlope: dyn.loadSlope,
      sustainedHighShare: dyn.sustainedHighShare,
      sessionMinutes: minutes,
      noiseMean: dyn.noiseMean || (s.noise_avg ?? 0),
      presenceInterruptions: s.presence_interruptions ?? 0,
      recentStrainEwma: recentStrainAt(dayOf(s.started_at)),
    };
    featureRows.push(features);
    if (typeof s.tiredness === "number") labeled.push({ features, tiredness: s.tiredness });
    void idx;
  });

  // Baselines over the user's own history, then the calibrated model.
  const baselines = computeBaselines(featureRows, FEATURE_PRIORS);
  const model = fitFocusModel(labeled, baselines);

  // "Current typical session": recency-weighted average of recent feature rows.
  const lambda = Math.LN2 / CURRENT_HALF_LIFE_SESSIONS;
  const n = featureRows.length;
  const current: Record<string, number> = {};
  for (const key of Object.keys(FEATURE_PRIORS)) {
    let wsum = 0;
    let vsum = 0;
    featureRows.forEach((row, i) => {
      const w = Math.exp(-lambda * (n - 1 - i)); // most recent = highest weight
      const v = row[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        vsum += w * v;
        wsum += w;
      }
    });
    current[key] = wsum > 0 ? vsum / wsum : (baselines.metrics[key]?.center ?? 0);
  }

  const prediction = predictTiredness(model, current, baselines);
  const trend = computeTrend(strainPoints);
  const estimate = composeFocusState({ prediction, model, baselines, trend });

  return { ready: true, reason: null, estimate };
}
