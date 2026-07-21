import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Gauge, Loader2, Minus, Sparkles, TrendingDown, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/InfoHint";
import { cn } from "@/lib/utils";
import {
  getFocusEstimate,
  getFocusNarrative,
  type FocusNarrative,
} from "@/features/insights/focus-model.functions";
import type { FocusStateEstimate } from "@/lib/focus/focus-state";

function tone(score: number): { fill: string; text: string } {
  if (score >= 67) return { fill: "bg-success", text: "text-success" };
  if (score >= 34) return { fill: "bg-warning", text: "text-warning" };
  return { fill: "bg-danger", text: "text-danger" };
}

const BASIS_LABEL: Record<FocusStateEstimate["reliability"]["basis"], string> = {
  personal: "your own baseline",
  blended: "your baseline + typical patterns",
  prior: "typical patterns (learning you)",
};

function TrendChip({ trend }: { trend: FocusStateEstimate["trend"] }) {
  const flat = trend.direction === "flat" || trend.confidence === "low";
  const Icon = flat ? Minus : trend.direction === "rising" ? TrendingUp : TrendingDown;
  // Trend is on STRAIN (higher = worse), so "rising" is bad, "falling" is good.
  const color = flat
    ? "text-muted-foreground"
    : trend.direction === "rising"
      ? "text-danger"
      : "text-success";
  const label = flat ? "steady" : trend.direction === "rising" ? "more strain" : "easing";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", color)}>
      <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
    </span>
  );
}

function Estimate({ est }: { est: FocusStateEstimate }) {
  const [busy, setBusy] = useState(false);
  const [narr, setNarr] = useState<FocusNarrative | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = tone(est.energyScore);
  const [lo, hi] = est.energyCI;

  const runNarrative = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await getFocusNarrative();
      setNarr(res.narrative);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the summary.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className={cn("text-3xl font-bold tabular-nums", t.text)}>{est.energyScore}</span>
            <span className="text-sm text-muted-foreground">/100 focus energy</span>
          </div>
          <p className="text-sm font-medium">{est.headline}</p>
        </div>
        <TrendChip trend={est.trend} />
      </div>

      {/* Energy score with its confidence band shaded behind the fill. */}
      <div>
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="absolute inset-y-0 rounded-full bg-foreground/15"
            style={{ left: `${lo}%`, width: `${Math.max(0, hi - lo)}%` }}
          />
          <div
            className={cn("absolute inset-y-0 left-0 rounded-full", t.fill)}
            style={{ width: `${est.energyScore}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Likely range {lo}–{hi} · shaded band = uncertainty
        </p>
      </div>

      <p className="text-sm text-muted-foreground">{est.detail}</p>

      {/* Honest reliability line. */}
      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">How reliable:</span> {est.reliability.label}
        {est.reliability.validatedMae != null && (
          <>
            {" "}
            <span className="opacity-80">
              (validated ±{est.reliability.validatedMae.toFixed(1)} pts
              {est.reliability.r2 != null && `, R²=${est.reliability.r2.toFixed(2)}`}; measured
              against {BASIS_LABEL[est.reliability.basis]}, {est.reliability.nLabels} check-ins)
            </span>
          </>
        )}
      </div>

      {est.drivers.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">What's shaping it</p>
          <ul className="space-y-1">
            {est.drivers.map((d) => (
              <li key={d.key} className="flex items-center justify-between text-sm">
                <span>{d.label}</span>
                <span
                  className={cn(
                    "text-xs font-medium",
                    d.contribution > 0 ? "text-danger" : "text-success",
                  )}
                >
                  {d.contribution > 0 ? "adds strain" : "eases strain"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t border-border pt-3">
        <Button size="sm" variant="outline" onClick={() => void runNarrative()} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" /> What your data suggests
            </>
          )}
        </Button>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        {narr && (
          <div className="mt-3 space-y-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm">
            <p className="font-semibold">{narr.headline}</p>
            {narr.paragraphs.map((p, i) => (
              <p key={i} className="text-muted-foreground">
                {p}
              </p>
            ))}
            {narr.experiments.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {narr.experiments.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            <p className="pt-1 text-[11px] text-muted-foreground/80">
              {narr.source === "ai"
                ? "AI-written from your computed estimate"
                : "Offline summary (AI unavailable)"}{" "}
              · behavioral pattern estimate, not medical advice
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Focus Model — a per-user, calibrated estimate of focus/energy state. Unlike
 * the Focus Battery (a fixed heuristic), this learns from YOUR tiredness
 * check-ins and reports its own validated accuracy. Leads with honesty: a
 * confidence band, a "how reliable" line, and the drivers behind it. A
 * behavioral pattern estimate with uncertainty — never a clinical measure.
 */
export function FocusStateCard() {
  const query = useQuery({
    queryKey: ["focus-estimate"],
    queryFn: () => getFocusEstimate(),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden />
          Focus Model
          <InfoHint label="About the Focus Model" side="bottom">
            A personalized estimate of your focus/energy pattern. It learns from{" "}
            <strong>your</strong> post-session tiredness check-ins and the minute-by-minute session
            data, measures you against your own baseline, and reports how accurate it actually is.
            It's a behavioral pattern estimate with real uncertainty — <strong>not</strong> a
            clinical or diagnostic measure of fatigue, focus, or cognitive health.
          </InfoHint>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Estimating from your sessions…
          </p>
        ) : query.isError ? (
          <p className="py-4 text-sm text-danger">Couldn't load the estimate.</p>
        ) : !query.data?.ready || !query.data.estimate ? (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
            <Activity className="mx-auto mb-1 h-4 w-4" aria-hidden />
            Log a few more sessions (with a post-session check-in) and this will start estimating
            your focus pattern.
          </p>
        ) : (
          <Estimate est={query.data.estimate} />
        )}
      </CardContent>
    </Card>
  );
}
