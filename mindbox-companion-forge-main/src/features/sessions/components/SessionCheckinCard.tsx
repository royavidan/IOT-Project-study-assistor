import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, X } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth/auth-context";
import { filterSessionsByUser } from "@/lib/session-scope";
import { useSessions } from "@/lib/queries/sessions";
import { useHomeworkAssignments } from "@/lib/queries/homework";
import { completionPctForHomework } from "@/features/courses/courses";
import { useCommitPlan, useSavePlanMeta } from "@/features/planner/queries";
import { findPendingCheckin } from "@/features/sessions/checkin";
import { submitSessionCheckin } from "@/features/sessions/checkin.functions";

const TIREDNESS_LABELS = ["Fresh", "Fine", "Okay", "Tired", "Drained"];

/** Show at most this many homework sliders (unfinished, due-soonest first). */
const MAX_HOMEWORK_SHOWN = 3;

/**
 * Post-session check-in on the dashboard: tiredness 1-5 + homework % sliders.
 * Submitting writes the report; when the thresholds fire, the returned AI plan
 * draft is committed AUTOMATICALLY through the normal plan path and the card
 * shows what changed — the "model output updates the data" POC moment.
 */
export function SessionCheckinCard() {
  const { user } = useAuth();
  const sessionsQ = useSessions();
  const homeworkQ = useHomeworkAssignments();
  const commit = useCommitPlan();
  const savePlanMeta = useSavePlanMeta();
  const queryClient = useQueryClient();

  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [tiredness, setTiredness] = useState<number | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ blocksChanged: number | null; reasons: string[] } | null>(
    null,
  );

  const pending = useMemo(() => {
    const own = filterSessionsByUser(sessionsQ.data ?? [], user?.id, user?.id);
    return findPendingCheckin(own, new Date());
  }, [sessionsQ.data, user?.id]);

  // If a NEWER session becomes the pending one mid-fill, reset the form so
  // answers can't silently attach to a different session.
  useEffect(() => {
    setTiredness(null);
    setProgress({});
    setNote("");
    setError(null);
  }, [pending?.id]);

  const openHomework = useMemo(
    () =>
      (homeworkQ.data ?? [])
        .filter((h) => completionPctForHomework(h) < 100)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, MAX_HOMEWORK_SHOWN),
    [homeworkQ.data],
  );

  if (done) {
    return (
      <Card className="mb-6 border-success/30 bg-success/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
            <div>
              <p className="text-sm font-semibold">
                {done.blocksChanged != null
                  ? `Plan updated automatically — ${done.blocksChanged} study block${done.blocksChanged === 1 ? "" : "s"} for the coming week.`
                  : "Check-in saved."}
              </p>
              {done.reasons.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Replanned because {done.reasons.join(" and ")}.
                </p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {done.blocksChanged != null && (
              <Button size="sm" variant="outline" asChild>
                <Link to="/calendar">See calendar</Link>
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setDone(null)}>
              Close
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!pending || pending.id === dismissedId) return null;

  const submit = async () => {
    if (tiredness == null) {
      setError("Pick how you feel first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await submitSessionCheckin({
        data: {
          sessionId: pending.id,
          tiredness,
          note: note.trim() || undefined,
          homeworkUpdates: openHomework.map((h) => ({
            id: h.id,
            progressPct: progress[h.id] ?? completionPctForHomework(h),
          })),
        },
      });

      void queryClient.invalidateQueries({ queryKey: ["sessions", user?.id] });
      void queryClient.invalidateQueries({ queryKey: ["homework-assignments", user?.id] });

      if (result.replan) {
        // Auto-commit: the validated draft replaces this week's generated
        // blocks via the exact same write path a manual plan uses.
        await commit.commit({
          draft: result.replan.draft,
          now: new Date(),
          horizonDays: result.replan.horizonDays,
        });
        savePlanMeta.mutate({
          fingerprint: result.replan.fingerprint,
          meta: {
            engine: result.replan.engine,
            trigger: "checkin",
            horizonDays: result.replan.horizonDays,
            mode: result.replan.draft.mode,
            blockCount: result.replan.draft.blocks.length,
            summary: result.replan.summary,
            assumptions: result.replan.assumptions,
            rejectedCount: result.replan.rejected.length,
          },
        });
        setDone({
          blocksChanged: result.replan.draft.blocks.length,
          reasons: result.replan.reasons,
        });
      } else {
        setDone({ blocksChanged: null, reasons: [] });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the check-in. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardCheck className="h-4 w-4 text-primary" aria-hidden />
          How did that session go?
        </CardTitle>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="Dismiss check-in"
          onClick={() => setDismissedId(pending.id)}
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {pending.durationMin} min {pending.mode} session · your answers keep the AI plan honest.
        </p>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">How drained do you feel?</p>
          <div className="grid grid-cols-5 gap-1.5">
            {TIREDNESS_LABELS.map((label, i) => {
              const value = i + 1;
              const selected = tiredness === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTiredness(value)}
                  className={`min-h-11 rounded-lg border px-1 text-xs font-medium transition-colors ${
                    selected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                  aria-pressed={selected}
                >
                  {value}
                  <span className="block text-[10px] font-normal">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {openHomework.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Homework progress</p>
            {openHomework.map((h) => {
              const pct = progress[h.id] ?? completionPctForHomework(h);
              return (
                <div key={h.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate">
                      {h.title}
                      {h.courseCode ? ` · ${h.courseCode}` : ""}
                    </span>
                    <span className="shrink-0 font-medium">{pct}%</span>
                  </div>
                  <Slider
                    value={[pct]}
                    min={0}
                    max={100}
                    step={5}
                    onValueChange={([v]) => setProgress((p) => ({ ...p, [h.id]: v }))}
                    aria-label={`Progress on ${h.title}`}
                  />
                </div>
              );
            })}
          </div>
        )}

        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything worth noting? (optional)"
          rows={2}
          maxLength={500}
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button className="min-h-11 w-full" onClick={() => void submit()} disabled={busy}>
          {busy ? "Saving…" : "Save check-in"}
        </Button>
      </CardContent>
    </Card>
  );
}
