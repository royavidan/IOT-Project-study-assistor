import { Hourglass } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/InfoHint";
import type { Session } from "@/lib/types";
import { summarizeStudyTime } from "@/lib/study-time";

function fmtMin(total: number): string {
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  if (h <= 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Study time & its effect: raw clock minutes vs "effective" minutes after the
 * within-session diminishing-returns curve (full focus to ~45 min, tapering by
 * ~90). Makes long unbroken grinds visibly worth less, and surfaces the session
 * length the user actually finishes best.
 */
export function StudyTimeEffectCard({ sessions }: { sessions: Session[] }) {
  const s = summarizeStudyTime(sessions);
  const pct = s.rawMin > 0 ? Math.round(s.ratio * 100) : 100;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-base">
          <Hourglass className="h-4 w-4 text-muted-foreground" aria-hidden />
          Study time & focus
          <InfoHint label="About effective minutes">
            Attention stays near peak for about 45 minutes, then tapers toward a ~90-minute cycle
            (vigilance-decrement + ultradian research). "Effective minutes" applies that curve to
            your session lengths, so very long unbroken sessions count for less than their clock
            time — a nudge to take breaks.
          </InfoHint>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {s.sessionCount === 0 ? (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
            Log a few sessions to see how your study time actually pays off.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-2xl font-bold tabular-nums">{fmtMin(s.effectiveMin)}</p>
                <p className="text-xs text-muted-foreground">
                  effective focus · {fmtMin(s.rawMin)} logged
                </p>
              </div>
              <span className="rounded-full bg-muted px-2.5 py-1 text-sm font-semibold tabular-nums">
                {pct}%
              </span>
            </div>

            {/* raw (full) vs effective (filled) */}
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-work"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
            </div>

            <p className="text-sm text-muted-foreground">
              Your sessions average{" "}
              <span className="font-medium text-foreground">{fmtMin(s.avgSessionMin)}</span>. You
              finish most reliably at{" "}
              <span className="font-medium text-foreground">{s.sweetSpotLabel}</span> — take a short
              break before focus tapers.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
