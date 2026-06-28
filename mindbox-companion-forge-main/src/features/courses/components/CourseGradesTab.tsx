import { useState } from "react";
import { BookOpen, GraduationCap, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { HomeworkAssignment } from "@/lib/types";
import {
  componentContributionLabel,
  examChoices,
  projectFinalWithExam,
  type GradeBreakdown,
  type GradeComponent,
} from "@/features/courses/grades";

const round1 = (n: number) => Math.round(n * 10) / 10;
const blurOnWheel = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

function parseNum(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
}

export function CourseGradesTab({
  breakdown,
  homeworkById,
  onEditHomework,
  onSaveExam,
  savingExamId,
}: {
  breakdown: GradeBreakdown;
  homeworkById: Map<string, HomeworkAssignment>;
  onEditHomework: (hw: HomeworkAssignment) => void;
  onSaveExam: (id: string, examWeight: number | null, examScore: number | null) => void;
  savingExamId?: string | null;
}) {
  const { components, assignedWeight, earnedPoints, scoredWeight } = breakdown;

  if (components.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <p className="text-sm font-medium text-foreground">No grade scheme yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Give each assignment a <span className="font-medium">weight</span> (its points of the
            final 100) in the Homework tab, and set an{" "}
            <span className="font-medium">exam weight</span> on the Exams tab. Then your standing
            and the exam projector show up here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Standing */}
      <Card>
        <CardContent className="space-y-1 p-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Current standing</p>
              <p className="mt-0.5 text-2xl font-semibold tracking-tight">
                {earnedPoints}
                <span className="text-base font-normal text-muted-foreground"> / 100</span>
              </p>
            </div>
            <p className="text-right text-xs text-muted-foreground">
              {scoredWeight} of {assignedWeight} weighted points graded
            </p>
          </div>
          {Math.abs(assignedWeight - 100) > 0.01 && (
            <p className="text-xs text-warning-foreground">
              Heads up: your weights add up to {assignedWeight}, not 100.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Breakdown */}
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {components.map((c) => (
              <li key={c.id} className="px-4 py-3 sm:px-5">
                {c.kind === "exam" ? (
                  <ExamGradeRow
                    key={`${c.id}:${c.weight}:${c.score ?? "x"}`}
                    component={c}
                    onSave={onSaveExam}
                    saving={savingExamId === c.sourceId}
                  />
                ) : (
                  <HomeworkGradeRow
                    component={c}
                    homework={homeworkById.get(c.sourceId)}
                    onEdit={onEditHomework}
                  />
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <ExamProjection breakdown={breakdown} />
    </div>
  );
}

function KindBadge({ kind }: { kind: GradeComponent["kind"] }) {
  const isExam = kind === "exam";
  const Icon = isExam ? GraduationCap : BookOpen;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        isExam ? "bg-danger-muted text-danger" : "bg-primary/10 text-primary",
      )}
    >
      <Icon className="h-3 w-3" />
      {isExam ? "Exam" : "Homework"}
    </span>
  );
}

function HomeworkGradeRow({
  component,
  homework,
  onEdit,
}: {
  component: GradeComponent;
  homework?: HomeworkAssignment;
  onEdit: (hw: HomeworkAssignment) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <KindBadge kind="homework" />
          <p className="truncate text-sm font-medium">{component.label}</p>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {component.score == null ? "Not graded yet" : `Scored ${component.score}`} · worth{" "}
          {round1(component.weight)} pts
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-sm font-semibold tabular-nums">
          {componentContributionLabel(component)}
        </span>
        {homework && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onEdit(homework)}
            aria-label={`Edit ${component.label}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function ExamGradeRow({
  component,
  onSave,
  saving,
}: {
  component: GradeComponent;
  onSave: (id: string, examWeight: number | null, examScore: number | null) => void;
  saving?: boolean;
}) {
  const [weight, setWeight] = useState(component.weight ? String(component.weight) : "");
  const [score, setScore] = useState(component.score == null ? "" : String(component.score));

  const dirty =
    parseNum(weight) !== component.weight ||
    parseNum(score) !== (component.score == null ? null : component.score);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <KindBadge kind="exam" />
          <p className="truncate text-sm font-medium">{component.label}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums">
          {componentContributionLabel(component)}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor={`w-${component.sourceId}`} className="text-xs text-muted-foreground">
            Weight (pts)
          </Label>
          <Input
            id={`w-${component.sourceId}`}
            type="number"
            min={0}
            max={100}
            step={0.5}
            onWheel={blurOnWheel}
            className="h-9 w-24"
            placeholder="e.g. 90"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`s-${component.sourceId}`} className="text-xs text-muted-foreground">
            Score (0–100)
          </Label>
          <Input
            id={`s-${component.sourceId}`}
            type="number"
            min={0}
            max={100}
            step={0.5}
            onWheel={blurOnWheel}
            className="h-9 w-24"
            placeholder="when graded"
            value={score}
            onChange={(e) => setScore(e.target.value)}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9"
          disabled={!dirty || saving}
          onClick={() => onSave(component.sourceId, parseNum(weight), parseNum(score))}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function ExamProjection({ breakdown }: { breakdown: GradeBreakdown }) {
  const exams = examChoices(breakdown);
  const [examId, setExamId] = useState(exams[0]?.id ?? "");
  const [score, setScore] = useState<number>(() => {
    const first = exams[0];
    return first?.score ?? 85;
  });

  if (exams.length === 0) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          Add an exam with a weight (Exams tab) to project your final grade.
        </CardContent>
      </Card>
    );
  }

  const selected = exams.find((e) => e.id === examId) ?? exams[0];
  const projected = projectFinalWithExam(breakdown, selected.id, score);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <p className="text-sm font-semibold">What-if: final grade by exam score</p>
          <p className="text-xs text-muted-foreground">
            Uses your real graded items + the score below. Other ungraded items count as 0.
          </p>
        </div>

        {exams.length > 1 && (
          <Select value={selected.id} onValueChange={setExamId}>
            <SelectTrigger className="w-full sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {exams.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.label} · {round1(e.weight)} pts
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="flex items-center gap-3">
          <Slider
            min={0}
            max={100}
            step={1}
            value={[score]}
            onValueChange={(v) => setScore(v[0])}
            className="flex-1"
            aria-label="Hypothetical exam score"
          />
          <span className="w-12 text-right text-sm font-medium tabular-nums">{score}</span>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
          <span className="text-sm text-muted-foreground">
            If you score {score} on {selected.label}
          </span>
          <span className="text-2xl font-semibold tracking-tight">{projected}</span>
        </div>
      </CardContent>
    </Card>
  );
}
