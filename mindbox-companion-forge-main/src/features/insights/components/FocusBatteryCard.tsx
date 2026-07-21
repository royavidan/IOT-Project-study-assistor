import { BatteryCharging, CalendarClock, Lightbulb, Sun } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/InfoHint";
import { cn } from "@/lib/utils";
import type { RecoveryBalance, WellbeingReport } from "@/lib/wellbeing";

// Garmin Body-Battery-style banding on the (already higher-is-healthier)
// recovery score.
function levelTone(score: number): { fill: string; text: string; word: string } {
  if (score >= 67) return { fill: "bg-success", text: "text-success", word: "Charged" };
  if (score >= 34) return { fill: "bg-warning", text: "text-warning", word: "Running low" };
  return { fill: "bg-danger", text: "text-danger", word: "Depleted" };
}

/**
 * Focus Battery — the wellbeing **recovery** signal (rest days, late-night load,
 * load spikes) presented as one 0–100 energy tank, with circadian + routine as
 * secondary contributors. Replaces the old three-bar "wellbeing" panel. These
 * are behavioral heuristics, NOT a clinical/burnout measure.
 */
export function FocusBatteryCard({
  report,
  note,
}: {
  report: WellbeingReport;
  /** Optional caption, e.g. the activity-weighted strain-hours summary. */
  note?: string;
}) {
  const recovery: RecoveryBalance = report.recovery;

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <BatteryCharging className="h-4 w-4 text-muted-foreground" aria-hidden />
          Focus Battery
          <InfoHint label="About the Focus Battery" side="bottom">
            A behavioral estimate of your load-vs-recovery balance from session timing — rest days,
            late-night study, and sudden jumps in load. It's a heuristic to help you reflect,{" "}
            <strong>not</strong> a clinical or diagnostic measure of fatigue or burnout. Confidence
            grows as you log more sessions.
          </InfoHint>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!recovery.ready ? (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
            {recovery.headline} {recovery.detail}
          </p>
        ) : (
          <BatteryBody recovery={recovery} report={report} />
        )}
        {note && recovery.ready && (
          <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">{note}</p>
        )}
      </CardContent>
    </Card>
  );
}

function BatteryBody({ recovery, report }: { recovery: RecoveryBalance; report: WellbeingReport }) {
  const tone = levelTone(recovery.score);
  const contributors = [report.circadian, report.consistency].filter((s) => s.ready);

  return (
    <div className="space-y-4">
      {/* Battery gauge */}
      <div className="flex items-center gap-1.5">
        <div className="relative h-10 flex-1 overflow-hidden rounded-lg border-2 border-border bg-muted/60">
          <div
            className={cn("absolute inset-y-0 left-0 transition-all", tone.fill)}
            style={{ width: `${recovery.score}%` }}
            aria-hidden
          />
          <div className="absolute inset-0 flex items-center justify-between px-3">
            <span className="text-sm font-semibold text-foreground/80 mix-blend-luminosity">
              {tone.word}
            </span>
            <span className="text-lg font-bold tabular-nums">{recovery.score}</span>
          </div>
        </div>
        <span className="h-4 w-1.5 rounded-r-sm bg-border" aria-hidden />
      </div>

      <div>
        <p className="text-sm font-medium">{recovery.headline}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{recovery.detail}</p>
      </div>

      {recovery.suggestion && (
        <div className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-work" aria-hidden />
          <p className="text-xs text-muted-foreground">{recovery.suggestion}</p>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-1 border-t border-border pt-2">
        {recovery.factors.map((f) => (
          <div key={f.label} className="flex items-center justify-between text-xs">
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd className="font-medium tabular-nums">{f.value}</dd>
          </div>
        ))}
      </dl>

      {contributors.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-2">
          <p className="text-xs font-medium text-muted-foreground">Also shaping your rhythm</p>
          {report.circadian.ready && (
            <ContributorRow
              icon={Sun}
              title="Circadian alignment"
              headline={report.circadian.headline}
            />
          )}
          {report.consistency.ready && (
            <ContributorRow
              icon={CalendarClock}
              title="Routine consistency"
              headline={report.consistency.headline}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ContributorRow({
  icon: Icon,
  title,
  headline,
}: {
  icon: typeof Sun;
  title: string;
  headline: string;
}) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <p>
        <span className="font-medium">{title}:</span>{" "}
        <span className="text-muted-foreground">{headline}</span>
      </p>
    </div>
  );
}
