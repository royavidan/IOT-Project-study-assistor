/** Default environment readings used when the simulator first loads. */
export const DEFAULT_SIM_ENV = {
  noiseAvg: 0.35,
  tempC: 22,
  lightLux: 300,
  lightVariance: 0.25,
} as const;

export type SimulatorEnvInput = {
  noiseAvg: number;
  tempC: number;
  lightLux: number;
  lightVariance: number;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Realistic random sensor readings (matches the CLI `scripts/simulator.ts` ranges). */
export function randomSimulatorEnv(): SimulatorEnvInput {
  return {
    noiseAvg: round(0.2 + Math.random() * 0.5),
    tempC: round(20 + Math.random() * 6, 1),
    lightLux: Math.round(150 + Math.random() * 400),
    lightVariance: round(0.1 + Math.random() * 0.5),
  };
}
