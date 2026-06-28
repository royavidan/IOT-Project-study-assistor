import { formatDistanceToNow } from "date-fns";
import { Calendar, Download, Edit2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { completionPctForHomework } from "@/features/courses/courses";
import { STATUS_META, STATUS_ORDER } from "@/features/homework/status";
import type { HomeworkAssignment, HomeworkStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

function isOverdue(dueDate: string): boolean {
  const due = new Date(dueDate);
  const now = new Date();
  return due < now && due.toDateString() !== now.toDateString();
}

interface Props {
  homework: HomeworkAssignment;
  onMove: (id: string, status: HomeworkStatus) => void;
  onEdit: (homework: HomeworkAssignment) => void;
  onDelete: (id: string) => void;
  busy?: boolean;
  /** Hide the course code (e.g. on a per-course board where it's redundant). */
  hideCourse?: boolean;
}

export function HomeworkBoardCard({ homework, onMove, onEdit, onDelete, busy, hideCourse }: Props) {
  const isLate = isOverdue(homework.dueDate) && homework.status === "pending";
  const completion = completionPctForHomework(homework);
  const moveTargets = STATUS_ORDER.filter((s) => s !== homework.status);
  const weighted = homework.weight != null && homework.weight > 0;
  const contribution =
    weighted && homework.grade != null
      ? Math.round((homework.grade / 100) * (homework.weight as number) * 10) / 10
      : null;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        isLate ? "border-danger/40 bg-danger-muted/30" : "border-border bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug text-foreground">{homework.title}</h3>
        {homework.status === "graded" && homework.grade != null && (
          <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">
            {homework.grade}
            {contribution != null && (
              <span className="ml-1 font-normal opacity-80">
                · {contribution}/{homework.weight}
              </span>
            )}
          </span>
        )}
      </div>

      {!hideCourse && homework.courseCode && (
        <p className="mt-0.5 text-xs text-muted-foreground">{homework.courseCode}</p>
      )}

      <div className="mt-2 flex items-center gap-1.5 text-xs">
        <Calendar className={cn("h-3.5 w-3.5", isLate ? "text-danger" : "text-muted-foreground")} />
        <span className={isLate ? "font-medium text-danger" : "text-muted-foreground"}>
          {isLate ? "Overdue — " : "Due "}
          {formatDistanceToNow(new Date(homework.dueDate), { addSuffix: true })}
        </span>
      </div>

      {homework.status !== "graded" && (
        <div className="mt-2.5">
          <Progress value={completion} aria-label={`Progress ${completion}%`} className="h-1.5" />
          <p className="mt-1 text-[11px] text-muted-foreground">{completion}% done</p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {moveTargets.map((status) => {
          const Icon = STATUS_META[status].icon;
          return (
            <Button
              key={status}
              size="sm"
              variant="outline"
              className="h-8 min-h-8 px-2 text-xs"
              disabled={busy}
              onClick={() => onMove(homework.id, status)}
            >
              <Icon className="mr-1 h-3 w-3" />
              {STATUS_META[status].label}
            </Button>
          );
        })}

        {homework.fileUrl && (
          <Button size="sm" variant="ghost" className="h-8 min-h-8 px-2 text-xs" asChild>
            <a
              href={homework.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Download file"
            >
              <Download className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-8 min-h-8 px-2 text-xs"
          onClick={() => onEdit(homework)}
          aria-label="Edit assignment"
        >
          <Edit2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 min-h-8 px-2 text-xs text-danger hover:bg-danger/10"
          onClick={() => onDelete(homework.id)}
          aria-label="Delete assignment"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
