import { Thermometer, Volume2, Sun } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/InfoHint";
import { cn } from "@/lib/utils";
import type { Session } from "@/lib/types";
import {
  conditionsFromSessions,
  type Band,
  type FactorKey,
  type FactorRating,
} from "@/lib/env-quality";
import { BandBar } from "./BandBar";

const DISPLAY: Record<
  FactorKey,
  {
    min: number;
    max: number;
    idealLo: number;
    idealHi: number;
    label: string;
    fmt: (v: number) => string;
  }
> = {
  temp: {
    min: 14,
    max: 30,
    idealLo: 20.5,
    idealHi: 23.5,
    label: "Temperature",
    fmt: (v) => `${v.toFixed(1)} °C`,
  },
  noise: { min: 0, max: 1, idealLo: 0, idealHi: 0.35, label: "Noise", fmt: (v) => v.toFixed(2) },
  light: {
    min: 0,
    max: 1000,
    idealLo: 300,
    idealHi: 500,
    label: "Light",
    fmt: (v) => `${Math.round(v)} lux`,
  },
};

const ICON: Record<FactorKey, typeof Thermometer> = {
  temp: Thermometer,
  noise: Volume2,
  light: Sun,
};

const SCORE_TONE: Record<Band, string> = {
  ideal: "text-success",
  okay: "text-warning",
  poor: "text-danger",
};

const SCORE_PILL: Record<Band, string> = {
  ideal: "bg-success/10 text-success",
  okay: "bg-warning/10 text-warning",
  poor: "bg-danger/10 text-danger",
};

const BAND_WORD: Record<Band, string> = { ideal: "Great", okay: "Okay", poor: "Poor" };

/**
 * Study-conditions readout: one 0–100 score from FIXED research thresholds
 * (temp/noise/light) plus a per-factor gauge with the ideal range + a tip.
 * Non-circular (unlike the old load-derived "ideal conditions").
 */
export function StudyConditionsCard({ sessions }: { sessions: Session[] }) {
  const conditions = conditionsFromSessions(sessions);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-base">
          Study conditions
          <InfoHint label="How study conditions are scored">
            Each factor is scored against research-backed ideal ranges (≈21 °C, quiet, 300–500 lux)
            — not against your own history. Noise is a relative 0–1 loudness from the mic, not
            calibrated decibels.
          </InfoHint>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {conditions == null ? (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
            No environment readings yet. Sync your MindBox or use the simulator's sensors to see how
            your temperature, noise, and light compare to the ideal ranges.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className={cn("text-4xl font-bold tabular-nums", SCORE_TONE[conditions.band])}>
                {conditions.score}
              </span>
              <div className="min-w-0">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
                    SCORE_PILL[conditions.band],
                  )}
                >
                  {BAND_WORD[conditions.band]}
                </span>
                <p className="mt-1 text-sm text-muted-foreground">{conditions.sentence}</p>
              </div>
            </div>

            <div className="space-y-3.5">
              {conditions.factors.map((f) => (
                <FactorRow key={f.key} rating={f} />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FactorRow({ rating }: { rating: FactorRating }) {
  const d = DISPLAY[rating.key];
  const Icon = ICON[rating.key];
  const frac = (v: number) => (v - d.min) / (d.max - d.min);
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <BandBar
          label={d.label}
          valueText={d.fmt(rating.value)}
          bandLabel={rating.label}
          band={rating.band}
          position={frac(rating.value)}
          idealStart={frac(d.idealLo)}
          idealEnd={frac(d.idealHi)}
          targetLabel={rating.targetLabel}
          tip={rating.tip}
        />
      </div>
    </div>
  );
}
