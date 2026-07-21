import { useMemo } from "react";
import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useScheduleEvents } from "@/features/schedule/queries";
import { useHomeworkAssignments } from "@/lib/queries/homework";
import { planFingerprint } from "@/features/planner/fingerprint";
import { usePlanMeta } from "@/features/planner/queries";

/**
 * "Your schedule changed since your last plan" nudge. Compares a fingerprint
 * of the CURRENT schedule + homework against what the last committed plan was
 * based on (`user_settings.last_plan_fingerprint`); renders nothing while they
 * match, or when no plan was ever committed. Detect-and-surface only — plans
 * are never silently rewritten behind the user's back.
 */
export function PlanStaleBanner({ onRegenerate }: { onRegenerate: () => void }) {
  const eventsQ = useScheduleEvents();
  const homeworkQ = useHomeworkAssignments();
  const metaQ = usePlanMeta();

  const current = useMemo(
    () => (eventsQ.data && homeworkQ.data ? planFingerprint(eventsQ.data, homeworkQ.data) : null),
    [eventsQ.data, homeworkQ.data],
  );

  const meta = metaQ.data;
  if (!meta?.fingerprint || !current) return null;
  // A plan with zero blocks isn't worth nagging about.
  const blockCount = Number((meta.meta as { blockCount?: unknown } | null)?.blockCount ?? 0);
  if (!Number.isFinite(blockCount) || blockCount <= 0) return null;
  if (current === meta.fingerprint) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <p className="text-sm">
          Your schedule or homework changed since your study plan was generated — it may be out of
          date.
        </p>
      </div>
      <Button size="sm" variant="outline" className="shrink-0" onClick={onRegenerate}>
        Regenerate plan
      </Button>
    </div>
  );
}
