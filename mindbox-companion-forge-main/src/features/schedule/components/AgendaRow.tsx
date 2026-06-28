import { Link } from "@tanstack/react-router";
import { BookOpen, Brain, GraduationCap, NotebookPen, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AgendaItem } from "@/features/schedule/schedule";
import {
  categoryLabel,
  formatDurationMinutes,
  formatTimeDisplay,
} from "@/features/schedule/schedule";
import { cn } from "@/lib/utils";

function fmtMins(total: number): string {
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return formatTimeDisplay(`${hh}:${mm}`);
}

export function AgendaRow({
  item,
  onEditCourse,
  onDeleteCourse,
  busy,
}: {
  item: AgendaItem;
  onEditCourse?: (eventId: string) => void;
  onDeleteCourse?: (eventId: string) => void;
  busy?: boolean;
}) {
  const duration = item.endMinutes - item.startMinutes;
  const eventId = item.type === "course" ? item.id.split(":")[0] : null;
  const isExam = item.category === "exam";
  const isStudy = item.category === "study";
  const isFocus = item.type === "focus";
  const accent = isFocus ? "#16a34a" : isExam ? "var(--color-danger)" : (item.color ?? "#6366f1");

  const Icon = isFocus ? Brain : isExam ? GraduationCap : isStudy ? NotebookPen : BookOpen;
  const typeLabel = isFocus ? "Focus" : categoryLabel(item.category, item.subtype);
  const iconClass = isFocus
    ? "text-success"
    : isExam
      ? "text-danger"
      : isStudy
        ? "text-info"
        : "text-muted-foreground";
  const typeClass = isFocus
    ? "bg-success/10 text-success"
    : isExam
      ? "bg-danger-muted text-danger"
      : isStudy
        ? "bg-info/10 text-info"
        : "bg-primary/10 text-primary";

  return (
    <div className="flex min-h-14 items-stretch gap-3 rounded-xl border border-border bg-card p-3">
      <div className="w-12 shrink-0 pt-0.5 text-xs font-medium tabular-nums text-muted-foreground">
        {fmtMins(item.startMinutes)}
      </div>
      <span className="w-1 shrink-0 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Icon className={cn("h-3.5 w-3.5 shrink-0", iconClass)} aria-hidden />
          {item.href ? (
            <Link to={item.href} className="truncate text-sm font-semibold hover:underline">
              {item.label}
            </Link>
          ) : (
            <p className="truncate text-sm font-semibold">{item.label}</p>
          )}
          <span
            className={cn(
              "ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              typeClass,
            )}
          >
            {typeLabel}
          </span>
        </div>
        {item.sublabel && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.sublabel}</p>
        )}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {fmtMins(item.startMinutes)} – {fmtMins(item.endMinutes)} ·{" "}
          {formatDurationMinutes(duration)}
        </p>
      </div>

      {item.type === "course" && eventId && (onEditCourse || onDeleteCourse) && (
        <div className="flex shrink-0 flex-col justify-center gap-1">
          {onEditCourse && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={busy}
              onClick={() => onEditCourse(eventId)}
              aria-label="Edit course"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {onDeleteCourse && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-danger"
              disabled={busy}
              onClick={() => onDeleteCourse(eventId)}
              aria-label="Remove course"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
