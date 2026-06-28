import type { ScheduleEvent } from "@/features/schedule/schedule";
import type { HomeworkAssignment } from "@/lib/types";

// Weighted "points out of 100" grade scheme. Each homework / exam can carry a
// `weight` (points toward the final grade); a scored item contributes
// score/100 × weight. Pure — no React/Supabase, unit-tested.

export type GradeComponentKind = "homework" | "exam";

export interface GradeComponent {
  /** Unique within a course, e.g. "hw:<uuid>" / "exam:<uuid>". */
  id: string;
  /** The raw homework/exam row id, for edit mutations. */
  sourceId: string;
  kind: GradeComponentKind;
  label: string;
  /** Points of the final 100 this item is worth. */
  weight: number;
  /** Recorded score 0–100, or null when not yet scored. */
  score: number | null;
}

export interface GradeBreakdown {
  components: GradeComponent[];
  /** Σ weight across all weighted components. */
  assignedWeight: number;
  /** Σ weight of components that already have a score. */
  scoredWeight: number;
  /** Σ contribution of scored components (the current standing, in points). */
  earnedPoints: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Points a component contributes to the final grade (0 when unscored). */
export function contribution(c: Pick<GradeComponent, "weight" | "score">): number {
  if (c.score == null) return 0;
  return (c.score / 100) * c.weight;
}

/** "4 / 5" style earned-vs-possible label for one component. */
export function componentContributionLabel(c: Pick<GradeComponent, "weight" | "score">): string {
  return `${round1(contribution(c))} / ${round1(c.weight)}`;
}

function homeworkComponents(homework: HomeworkAssignment[]): GradeComponent[] {
  return homework
    .filter((h) => h.weight != null && h.weight > 0)
    .map((h) => ({
      id: `hw:${h.id}`,
      sourceId: h.id,
      kind: "homework" as const,
      label: h.title,
      weight: h.weight as number,
      score: h.status === "graded" && h.grade != null ? h.grade : null,
    }));
}

function examComponents(exams: ScheduleEvent[]): GradeComponent[] {
  return exams
    .filter((e) => e.examWeight != null && e.examWeight > 0)
    .map((e) => ({
      id: `exam:${e.id}`,
      sourceId: e.id,
      kind: "exam" as const,
      label: e.title,
      weight: e.examWeight as number,
      score: e.examScore ?? null,
    }));
}

/** Build the weighted grade breakdown for one course (homework + exams). */
export function buildGradeBreakdown(
  homework: HomeworkAssignment[],
  exams: ScheduleEvent[],
): GradeBreakdown {
  const components = [...homeworkComponents(homework), ...examComponents(exams)];
  let assignedWeight = 0;
  let scoredWeight = 0;
  let earnedPoints = 0;
  for (const c of components) {
    assignedWeight += c.weight;
    if (c.score != null) {
      scoredWeight += c.weight;
      earnedPoints += contribution(c);
    }
  }
  return {
    components,
    assignedWeight: round1(assignedWeight),
    scoredWeight: round1(scoredWeight),
    earnedPoints: round1(earnedPoints),
  };
}

/** Whether the course has any weighted grade components at all. */
export function hasGradeScheme(breakdown: GradeBreakdown): boolean {
  return breakdown.components.length > 0;
}

/** Exam components only — the projector's picker options, in listed order. */
export function examChoices(breakdown: GradeBreakdown): GradeComponent[] {
  return breakdown.components.filter((c) => c.kind === "exam");
}

/**
 * Projected final if `componentId` earns `hypotheticalScore` (0–100). Uses the
 * real contributions of every other scored component plus the hypothetical
 * contribution of the chosen component; other unscored components stay at 0.
 */
export function projectFinalWithExam(
  breakdown: GradeBreakdown,
  componentId: string,
  hypotheticalScore: number,
): number {
  const clamped = Math.max(0, Math.min(100, hypotheticalScore));
  let total = 0;
  for (const c of breakdown.components) {
    if (c.id === componentId) {
      total += (clamped / 100) * c.weight;
    } else if (c.score != null) {
      total += contribution(c);
    }
  }
  return round1(total);
}
