import { useEffect, useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { LLM_PLANNER_ENABLED } from "@/lib/feature-flags";
import {
  MODE_CONFIGS,
  PLAN_MODES,
  planStudyBlocks,
  type PlanDraft,
  type PlanMode,
} from "@/features/planner/planner";
import { planFingerprint } from "@/features/planner/fingerprint";
import { useCommitPlan, usePlanInputs, useSavePlanMeta } from "@/features/planner/queries";
import { generateLlmPlan, type LlmPlanResult } from "@/features/planner/llm-plan.functions";
import { ModeCard } from "./ModeCard";
import { PlanPreview } from "./PlanPreview";

type Horizon = "7" | "14";
type Engine = "ai" | "standard";

interface AiExtras {
  summary: string | null;
  assumptions: string[];
  rejected: LlmPlanResult["rejected"];
  fallbackReason: string | null;
  fingerprint: string;
}

/**
 * Generate a study plan: pick an engine (Smart AI / Standard) + rhythm mode +
 * horizon, preview the proposed blocks, then approve to write them to the
 * calendar. Nothing is saved until the user approves. The AI engine runs fully
 * server-side (prompt building → Gemini → deterministic validation) and falls
 * back to the standard engine when the model misbehaves.
 */
export function GenerateScheduleSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inputs = usePlanInputs();
  const commit = useCommitPlan();
  const savePlanMeta = useSavePlanMeta();

  const [engine, setEngine] = useState<Engine>(LLM_PLANNER_ENABLED ? "ai" : "standard");
  const [mode, setMode] = useState<PlanMode>("balanced");
  const [horizon, setHorizon] = useState<Horizon>("7");
  const [includeLectureReview, setIncludeLectureReview] = useState(true);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [aiExtras, setAiExtras] = useState<AiExtras | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Default to the user's saved strategy each time the sheet opens.
  useEffect(() => {
    if (open) {
      setMode(inputs.settings.studyPlanMode);
      setDraft(null);
      setAiExtras(null);
      setError(null);
    }
    // Only re-sync when the sheet transitions open; settings changes mid-open
    // shouldn't yank the user's current selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const horizonDays = horizon === "14" ? 14 : 7;

  const generate = async () => {
    setError(null);
    const now = new Date();
    setGeneratedAt(now);

    if (engine === "ai") {
      setGenerating(true);
      try {
        const result = await generateLlmPlan({
          data: { mode, horizonDays, includeLectureReview },
        });
        setDraft(result.draft);
        setAiExtras({
          summary: result.summary,
          assumptions: result.assumptions,
          rejected: result.rejected,
          fallbackReason: result.fallbackReason,
          fingerprint: result.fingerprint,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "The AI planner failed. Try again.");
      } finally {
        setGenerating(false);
      }
      return;
    }

    const input = inputs.build(mode, horizonDays, includeLectureReview);
    setDraft(planStudyBlocks(input));
    setAiExtras(null);
  };

  const approve = async () => {
    if (!draft || !generatedAt) return;
    setError(null);
    try {
      await commit.commit({ draft, now: generatedAt, horizonDays });
      // Stamp what this plan was based on — powers the "schedule changed since
      // your plan" banner. AI plans carry the server-computed fingerprint;
      // standard plans hash the freshly loaded inputs.
      const fingerprint =
        aiExtras?.fingerprint ??
        (() => {
          const input = inputs.build(mode, horizonDays, includeLectureReview);
          return planFingerprint(input.events, input.homework);
        })();
      savePlanMeta.mutate({
        fingerprint,
        meta: {
          engine: aiExtras && !aiExtras.fallbackReason ? "gemini" : "heuristic",
          trigger: "manual",
          horizonDays,
          mode,
          blockCount: draft.blocks.length,
          summary: aiExtras?.summary ?? null,
          assumptions: aiExtras?.assumptions ?? [],
          rejectedCount: aiExtras?.rejected.length ?? 0,
        },
      });
      onOpenChange(false);
      setDraft(null);
      setAiExtras(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the plan. Try again.");
    }
  };

  // Actions live in the drawer's pinned footer so they stay reachable on mobile
  // without scrolling past a long preview.
  const footer = draft ? (
    draft.blocks.length === 0 ? (
      <Button
        variant="outline"
        className="min-h-11 w-full"
        onClick={() => {
          setDraft(null);
          setAiExtras(null);
        }}
      >
        Back
      </Button>
    ) : (
      <div className="flex w-full gap-2">
        <Button
          variant="outline"
          className="min-h-11 flex-1"
          onClick={() => {
            setDraft(null);
            setAiExtras(null);
          }}
          disabled={commit.isPending}
        >
          Discard
        </Button>
        <Button
          className="min-h-11 flex-1"
          onClick={() => void approve()}
          disabled={commit.isPending}
        >
          {commit.isPending ? "Adding…" : "Add to calendar"}
        </Button>
      </div>
    )
  ) : (
    <Button
      className="min-h-11 w-full"
      onClick={() => void generate()}
      disabled={inputs.isLoading || !inputs.hasData || generating}
    >
      <Sparkles className="h-4 w-4" />
      {generating ? "Thinking…" : inputs.isLoading ? "Loading your schedule…" : "Generate plan"}
    </Button>
  );

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Auto-plan study time"
      description="Fill your free time with study blocks that ramp up before deadlines — and stay under a healthy daily cap."
      className="sm:max-w-lg"
      footer={footer}
    >
      {draft ? (
        <>
          {error && <p className="pt-2 text-sm text-danger">{error}</p>}
          <PlanPreview
            draft={draft}
            summary={aiExtras?.summary ?? null}
            assumptions={aiExtras?.assumptions ?? []}
            rejected={aiExtras?.rejected ?? []}
            fallbackReason={aiExtras?.fallbackReason ?? null}
          />
        </>
      ) : (
        <div className="space-y-5 py-2">
          {LLM_PLANNER_ENABLED && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Engine</p>
              <ToggleGroup
                type="single"
                value={engine}
                onValueChange={(v) => v && setEngine(v as Engine)}
                variant="outline"
                className="grid w-full grid-cols-2"
              >
                <ToggleGroupItem value="ai" className="min-h-10 gap-1.5">
                  <Wand2 className="h-3.5 w-3.5" />
                  Smart (AI)
                </ToggleGroupItem>
                <ToggleGroupItem value="standard" className="min-h-10">
                  Standard
                </ToggleGroupItem>
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">
                {engine === "ai"
                  ? "Gemini prioritizes your tasks; every block is validated against your real free time before you see it."
                  : "Deterministic rules — no AI involved."}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-semibold">Strategy</p>
            {PLAN_MODES.map((m) => (
              <ModeCard
                key={m}
                config={MODE_CONFIGS[m]}
                selected={mode === m}
                onSelect={() => setMode(m)}
              />
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-semibold">Plan ahead</p>
            <ToggleGroup
              type="single"
              value={horizon}
              onValueChange={(v) => v && setHorizon(v as Horizon)}
              variant="outline"
              className="grid w-full grid-cols-2"
            >
              <ToggleGroupItem value="7" className="min-h-10">
                This week
              </ToggleGroupItem>
              <ToggleGroupItem value="14" className="min-h-10">
                Two weeks
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <div className="min-w-0">
              <Label htmlFor="plan-lectures" className="text-sm font-medium">
                Include lecture review
              </Label>
              <p className="text-xs text-muted-foreground">
                Catch up on lectures you haven't marked watched, before each exam.
              </p>
            </div>
            <Switch
              id="plan-lectures"
              className="shrink-0"
              checked={includeLectureReview}
              onCheckedChange={setIncludeLectureReview}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Blocks land in your working hours (set in Settings), skip classes, exams, and quiet
            hours, and start earlier rather than cramming. You'll review everything before it's
            added.
          </p>

          {error && <p className="text-sm text-danger">{error}</p>}

          {!inputs.isLoading && !inputs.hasData && (
            <p className="text-center text-xs text-muted-foreground">
              Add a class, exam, or homework first so there's something to plan around.
            </p>
          )}
        </div>
      )}
    </ResponsiveModal>
  );
}
