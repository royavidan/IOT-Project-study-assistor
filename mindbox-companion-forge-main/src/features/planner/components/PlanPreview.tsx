import { AlertTriangle, CalendarClock, Lightbulb, NotebookPen, ShieldCheck } from "lucide-react";

import {
  formatDurationMinutes,
  formatTimeDisplay,
  friendlyDateLabel,
} from "@/features/schedule/schedule";
import type { PlanDraft, ProposedBlock } from "@/features/planner/planner";

export interface RejectedPreviewItem {
  taskRef: string;
  dateKey: string;
  startTime: string;
  endTime: string;
  reason: string;
}

/**
 * Read-only body of a proposed plan (chips + warnings + day-grouped blocks).
 * The Discard/Approve actions live in the sheet's pinned drawer footer, and the
 * drawer owns the scroll — so this component is body-only. AI plans also show
 * the model's summary + stated assumptions and any proposals the deterministic
 * validator dropped — the "we never trust the model blindly" story, on screen.
 */
export function PlanPreview({
  draft,
  summary = null,
  assumptions = [],
  rejected = [],
  fallbackReason = null,
}: {
  draft: PlanDraft;
  summary?: string | null;
  assumptions?: string[];
  rejected?: RejectedPreviewItem[];
  fallbackReason?: string | null;
}) {
  const byDay = groupByDay(draft.blocks);

  if (draft.blocks.length === 0) {
    return (
      <div className="py-2">
        {fallbackReason && <FallbackNote reason={fallbackReason} />}
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
          No study blocks could be placed. {draft.warnings[0] ?? "Try a wider window in Settings."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2">
      {fallbackReason && <FallbackNote reason={fallbackReason} />}

      {summary && (
        <p className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
          {summary}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary">
          <CalendarClock className="h-3.5 w-3.5" />
          {draft.blocks.length} block{draft.blocks.length === 1 ? "" : "s"} ·{" "}
          {formatDurationMinutes(draft.totalPlannedMin)}
        </span>
        {draft.weekLoad.map((w) => (
          <span
            key={w.weekKey}
            className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
          >
            Week of {friendlyDateLabel(w.weekKey)}: {formatDurationMinutes(w.plannedMin)}
          </span>
        ))}
      </div>

      {draft.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground">
          {draft.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {rejected.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-info" />
            {rejected.length} AI proposal{rejected.length === 1 ? "" : "s"} didn't fit your calendar
            and {rejected.length === 1 ? "was" : "were"} dropped
          </p>
          <ul className="space-y-0.5 pl-5">
            {rejected.slice(0, 4).map((r, i) => (
              <li key={i} className="list-disc">
                {friendlyDateLabel(r.dateKey)} {r.startTime}–{r.endTime}: {r.reason}
              </li>
            ))}
            {rejected.length > 4 && <li className="list-disc">…and {rejected.length - 4} more.</li>}
          </ul>
        </div>
      )}

      {assumptions.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border p-3 text-xs">
          <p className="flex items-center gap-1.5 font-medium">
            <Lightbulb className="h-3.5 w-3.5 text-warning" />
            The AI assumed
          </p>
          <ul className="space-y-0.5 pl-5 text-muted-foreground">
            {assumptions.map((a, i) => (
              <li key={i} className="list-disc">
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4">
        {byDay.map(({ dateKey, blocks }) => (
          <div key={dateKey} className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {friendlyDateLabel(dateKey)}
            </p>
            {blocks.map((b, i) => (
              <div
                key={`${b.ref}:${i}`}
                className="flex items-center gap-3 rounded-lg border border-border p-2.5"
              >
                <NotebookPen className="h-4 w-4 shrink-0 text-info" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{b.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatTimeDisplay(b.startTime)} – {formatTimeDisplay(b.endTime)}
                    {b.courseCode ? ` · ${b.courseCode}` : ""}
                  </p>
                </div>
                {b.taskKind !== "homework" && (
                  <span className="shrink-0 rounded-full bg-info/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-info">
                    {b.taskKind === "exam-review" ? "Review" : "Catch-up"}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function FallbackNote({ reason }: { reason: string }) {
  return (
    <p className="mb-2 flex items-start gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{reason}</span>
    </p>
  );
}

function groupByDay(blocks: ProposedBlock[]): { dateKey: string; blocks: ProposedBlock[] }[] {
  const map = new Map<string, ProposedBlock[]>();
  for (const b of blocks) {
    const list = map.get(b.dateKey) ?? [];
    list.push(b);
    map.set(b.dateKey, list);
  }
  // blocks arrive already sorted by (date, start) from the planner.
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateKey, list]) => ({ dateKey, blocks: list }));
}
