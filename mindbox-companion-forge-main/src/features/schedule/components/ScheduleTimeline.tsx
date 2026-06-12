import { Link } from "@tanstack/react-router";
import { BookOpen, Brain, GraduationCap, MapPin, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AgendaItem } from "@/features/schedule/schedule";
import { formatDurationMinutes, formatTimeDisplay, meetingTypeLabel } from "@/features/schedule/schedule";

export function ScheduleTimeline({
  items,
  onEditCourse,
  onDeleteCourse,
  busy,
}: {
  items: AgendaItem[];
  onEditCourse?: (eventId: string) => void;
  onDeleteCourse?: (eventId: string) => void;
  busy?: boolean;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
        <p className="text-sm font-medium text-foreground">Nothing scheduled yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a lecture, lab, or exam to plan your week alongside MindBox focus sessions.
        </p>
      </div>
    );
  }

  return (
    <ol className="relative space-y-0">
      {items.map((item, index) => {
        const duration = item.endMinutes - item.startMinutes;
        const eventId = item.type === "course" ? item.id.split(":")[0] : null;

        return (
          <li key={item.id} className="relative flex gap-4 pb-6 last:pb-0">
            {index < items.length - 1 && (
              <span
                className="absolute left-[4.35rem] top-8 h-[calc(100%-0.5rem)] w-px bg-border"
                aria-hidden
              />
            )}

            <div className="w-16 shrink-0 pt-1 text-right text-xs font-medium text-muted-foreground">
              {formatTimeDisplay(
                `${String(Math.floor(item.startMinutes / 60)).padStart(2, "0")}:${String(item.startMinutes % 60).padStart(2, "0")}`,
              )}
            </div>

            <div className="relative mt-1 flex h-3 w-3 shrink-0 items-center justify-center">
              <span
                className="h-3 w-3 rounded-full ring-4 ring-background"
                style={{
                  backgroundColor: item.type === "course" ? (item.color ?? "#6366f1") : "#16a34a",
                }}
              />
            </div>

            <div className="min-w-0 flex-1 rounded-xl border border-border bg-card p-4 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {item.type === "focus" ? (
                      <Brain className="h-4 w-4 shrink-0 text-success" aria-hidden />
                    ) : item.category === "exam" ? (
                      <GraduationCap className="h-4 w-4 shrink-0 text-danger" aria-hidden />
                    ) : (
                      <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    {item.href ? (
                      <Link
                        to={item.href}
                        className="truncate text-sm font-semibold hover:underline"
                      >
                        {item.label}
                      </Link>
                    ) : (
                      <p className="truncate text-sm font-semibold">{item.label}</p>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        item.type === "focus"
                          ? "bg-success/10 text-success"
                          : item.category === "exam"
                            ? "bg-danger-muted text-danger"
                            : "bg-primary/10 text-primary"
                      }`}
                    >
                      {item.type === "focus"
                        ? "Focus"
                        : item.category === "exam"
                          ? "Exam"
                          : meetingTypeLabel(item.subtype)}
                    </span>
                  </div>

                  {item.sublabel && (
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      {item.type === "course" && item.sublabel.includes("·") ? (
                        <>
                          <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                          {item.sublabel}
                        </>
                      ) : (
                        item.sublabel
                      )}
                    </p>
                  )}

                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatTimeDisplay(
                      `${String(Math.floor(item.startMinutes / 60)).padStart(2, "0")}:${String(item.startMinutes % 60).padStart(2, "0")}`,
                    )}{" "}
                    –{" "}
                    {formatTimeDisplay(
                      `${String(Math.floor(item.endMinutes / 60)).padStart(2, "0")}:${String(item.endMinutes % 60).padStart(2, "0")}`,
                    )}{" "}
                    · {formatDurationMinutes(duration)}
                  </p>
                </div>

                {item.type === "course" && eventId && (onEditCourse || onDeleteCourse) && (
                  <div className="flex shrink-0 gap-1">
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
            </div>
          </li>
        );
      })}
    </ol>
  );
}
