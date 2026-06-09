import { BatteryCharging, CalendarClock, Info, Lightbulb, Sun } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { WellbeingReport } from "@/lib/wellbeing";

interface SignalView {
  ready: boolean;
  score: number;
  status: string;
  confidence: "low" | "medium" | "high";
  headline: string;
  detail: string;
  suggestion: string;
  factors: { label: string; value: string }[];
}

const TONES = {
  good: { chip: "bg-success/10 text-success", bar: "bg-success" },
  warn: { chip: "bg-warning-muted text-warning-foreground", bar: "bg-warning" },
  bad: { chip: "bg-danger-muted text-danger", bar: "bg-danger" },
} as const;

function toneFor(status: string): keyof typeof TONES {
  if (["balanced", "aligned", "steady"].includes(status)) return "good";
  if (["moderate", "mixed", "variable"].includes(status)) return "warn";
  return "bad";
}

function SignalCard({
  icon: Icon,
  title,
  signal,
}: {
  icon: typeof Sun;
  title: string;
  signal: SignalView;
}) {
  if (!signal.ready) {
    return (
      <Card className="border-dashed">
        <CardHeader className="flex-row items-center gap-2 pb-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          <CardTitle className="text-sm">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{signal.headline}</p>
          <p className="text-xs text-muted-foreground">{signal.detail}</p>
        </CardContent>
      </Card>
    );
  }

  const tone = TONES[toneFor(signal.status)];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
          <CardTitle className="text-sm">{title}</CardTitle>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize", tone.chip)}>
          {signal.status}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full transition-all", tone.bar)}
              style={{ width: `${signal.score}%` }}
            />
          </div>
          <span className="w-8 text-right text-sm font-semibold tabular-nums">{signal.score}</span>
        </div>

        <div>
          <p className="text-sm font-medium">{signal.headline}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{signal.detail}</p>
        </div>

        {signal.suggestion && (
          <div className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-work" aria-hidden />
            <p className="text-xs text-muted-foreground">{signal.suggestion}</p>
          </div>
        )}

        <dl className="grid grid-cols-1 gap-1 border-t border-border pt-2">
          {signal.factors.map((f) => (
            <div key={f.label} className="flex items-center justify-between text-xs">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd className="font-medium tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>

        <p className="text-[11px] capitalize text-muted-foreground">
          {signal.confidence} confidence
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Behavioral wellbeing patterns. The disclosure is deliberate and required:
 * these are not clinical or diagnostic measures (same rule as the Focus Load
 * Estimate). Render only when `report.ready`.
 */
export function WellbeingPanel({ report }: { report: WellbeingReport }) {
  return (
    <section className="mb-6" aria-label="Wellbeing patterns">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold">Wellbeing patterns</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <button aria-label="About wellbeing patterns" className="text-muted-foreground">
              <Info className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-sm text-left">
            Behavioral pattern estimates from your session timing and load — grounded in published
            research on recovery, circadian rhythms, and routine regularity. These are heuristics to
            help you reflect, <strong>not</strong> a clinical or diagnostic measure of fatigue,
            burnout, or mental health. Confidence grows as you log more sessions.
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SignalCard icon={BatteryCharging} title="Recovery balance" signal={report.recovery} />
        <SignalCard icon={Sun} title="Circadian alignment" signal={report.circadian} />
        <SignalCard icon={CalendarClock} title="Routine consistency" signal={report.consistency} />
      </div>
    </section>
  );
}
