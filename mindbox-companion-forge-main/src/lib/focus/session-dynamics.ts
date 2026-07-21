// Within-session dynamics mined from the per-minute focus-load + environment
// samples (the app's densest, previously under-used signal — ~17-99 points per
// session). These are interpretable metrics in their own right AND the feature
// inputs to the calibrated model. Pure + unit-tested.
//
// NOTE on direction: `focus` here is the device Focus LOAD Estimate (0..100,
// higher = more strain), same as `Session.focusScore`. So a POSITIVE loadSlope
// means strain rose across the session, and a high loadMean means a heavy
// session — never "better". We never relabel load as goodness.

import { correlation, mean, stdev, theilSen } from "@/lib/stats/robust";

/** One merged per-minute sample. Mirrors `SessionTimePoint` in features/sessions. */
export interface SessionSeriesPoint {
  /** Minutes since session start. */
  tMin: number;
  /** Focus Load Estimate 0..100 (null if no focus sample that minute). */
  focus: number | null;
  /** Normalized noise 0..1 (null if no env sample). */
  noise: number | null;
  tempC: number | null;
  lightLux: number | null;
}

export interface SessionDynamics {
  /** How many usable focus samples the session had (drives confidence). */
  nSamples: number;
  /** Mean Focus Load across the session (0..100). */
  loadMean: number;
  /** Peak Focus Load. */
  loadPeak: number;
  /** SD of Focus Load — how variable/unsettled the session was. */
  loadVolatility: number;
  /** Robust load change per 10 minutes (Theil-Sen). Positive = strain climbed. */
  loadSlope: number;
  /** Fraction of minutes at high load (>= HIGH_LOAD). 0..1. */
  sustainedHighShare: number;
  /** Mean / SD / peak normalized noise. */
  noiseMean: number;
  noiseVolatility: number;
  noisePeak: number;
  /** SD of ambient light — a movement / interruption proxy. */
  lightVolatility: number;
  /**
   * Within-session coupling of noise → load (Pearson, noise leading load by one
   * minute). Positive = noisier minutes precede heavier load. -1..1.
   */
  envNoiseCoupling: number;
}

/** Load at/above this counts as "high" for the sustained-load share. */
export const HIGH_LOAD = 60;

const EMPTY: SessionDynamics = {
  nSamples: 0,
  loadMean: 0,
  loadPeak: 0,
  loadVolatility: 0,
  loadSlope: 0,
  sustainedHighShare: 0,
  noiseMean: 0,
  noiseVolatility: 0,
  noisePeak: 0,
  lightVolatility: 0,
  envNoiseCoupling: 0,
};

function peak(xs: number[]): number {
  return xs.length ? Math.max(...xs) : 0;
}

/**
 * Compute the within-session dynamics for one session's merged per-minute
 * series. Degrades gracefully: with < 3 focus samples the point-in-time
 * aggregates are still returned but slope/coupling stay 0 (not enough to fit).
 */
export function computeSessionDynamics(series: SessionSeriesPoint[]): SessionDynamics {
  const pts = [...series].sort((a, b) => a.tMin - b.tMin);
  const focus = pts
    .filter((p) => p.focus != null)
    .map((p) => ({ t: p.tMin, v: p.focus as number }));
  if (focus.length === 0) return EMPTY;

  const loadVals = focus.map((p) => p.v);
  const loadMean = mean(loadVals);
  const loadPeak = peak(loadVals);
  const loadVolatility = stdev(loadVals);
  const sustainedHighShare = loadVals.filter((v) => v >= HIGH_LOAD).length / loadVals.length;

  const loadSlope =
    focus.length >= 3 ? theilSen(focus.map((p) => ({ x: p.t, y: p.v }))).slope * 10 : 0;

  const noise = pts.filter((p) => p.noise != null).map((p) => p.noise as number);
  const noiseMean = noise.length ? mean(noise) : 0;
  const noiseVolatility = noise.length ? stdev(noise) : 0;
  const noisePeak = peak(noise);

  const light = pts.filter((p) => p.lightLux != null).map((p) => p.lightLux as number);
  const lightVolatility = light.length ? stdev(light) : 0;

  // Couple noise → load on the shared minute axis: build aligned arrays over the
  // minutes where BOTH exist, then correlate with noise leading load by 1 minute.
  let envNoiseCoupling = 0;
  const both = pts.filter((p) => p.noise != null && p.focus != null);
  if (both.length >= 4) {
    const noiseSeq = both.map((p) => p.noise as number);
    const loadSeq = both.map((p) => p.focus as number);
    envNoiseCoupling = correlation(noiseSeq, loadSeq, 1);
  }

  return {
    nSamples: focus.length,
    loadMean,
    loadPeak,
    loadVolatility,
    loadSlope,
    sustainedHighShare,
    noiseMean,
    noiseVolatility,
    noisePeak,
    lightVolatility,
    envNoiseCoupling,
  };
}
