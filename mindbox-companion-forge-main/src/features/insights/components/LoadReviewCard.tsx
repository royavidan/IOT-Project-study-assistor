import { useState } from "react";
import { HeartPulse, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  runLoadReviewNow,
  type LoadReviewOutcome,
} from "@/features/insights/load-review.functions";

const LEVEL_STYLE: Record<LoadReviewOutcome["level"], string> = {
  ok: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning-foreground",
  danger: "border-danger/30 bg-danger-muted/40 text-danger",
};

/**
 * The load review, on demand. The daily sweep runs from an external cron
 * (POST /jobs/load-review); this button runs the exact same rules for the
 * signed-in user, live — the demo surface for "our thresholds decide,
 * the AI only writes the note".
 */
export function LoadReviewCard() {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<LoadReviewOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setOutcome(await runLoadReviewNow());
    } catch (e) {
      setError(e instanceof Error ? e.message : "The review failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <HeartPulse className="h-4 w-4 text-primary" aria-hidden />
            Load review
          </CardTitle>
          <CardDescription>
            A daily job checks your load against fixed thresholds (recovery, tiredness,
            over-planning, rest days, exam crunch) and emails you when it looks unhealthy. Run it
            now to see today's verdict.
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => void run()}
          disabled={busy}
        >
          {busy ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reviewing…
            </>
          ) : (
            "Run review now"
          )}
        </Button>
      </CardHeader>
      {(outcome || error) && (
        <CardContent>
          {error && <p className="text-sm text-danger">{error}</p>}
          {outcome && (
            <div
              className={`space-y-1 rounded-lg border px-3 py-2.5 text-sm ${LEVEL_STYLE[outcome.level]}`}
            >
              <p className="font-semibold">
                {outcome.action === "skipped-no-email"
                  ? "Assessed, but your profile has no email address to contact."
                  : outcome.level === "ok"
                    ? "All clear — no overload pattern today."
                    : outcome.level === "danger"
                      ? "Danger-level overload pattern."
                      : "Warning-level load pattern."}
                {outcome.action.startsWith("emailed") &&
                  ` A note was emailed to you${outcome.action === "emailed-fallback" ? " (plain template — AI unavailable)" : ""}.`}
                {outcome.action === "error" && ` Email failed: ${outcome.detail ?? "unknown"}.`}
              </p>
              {outcome.triggeredRules.length > 0 && (
                <ul className="list-disc pl-5 text-xs opacity-90">
                  {outcome.triggeredRules.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
