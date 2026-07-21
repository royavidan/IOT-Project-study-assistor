import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseDateKey, toDateKey, todayDateKey } from "@/lib/dates";
import type { Session } from "@/lib/types";
import {
  buildDayAgenda,
  expandScheduleEvents,
  friendlyDateLabel,
  weekDateKeys,
  type ScheduleEvent,
} from "@/features/schedule/schedule";
import { ScheduleTimeline } from "@/features/schedule/components/ScheduleTimeline";

function addDays(key: string, n: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

export function CalendarDayView({
  events,
  sessions,
  weeklyBounds,
  selectedDate,
  onSelectDate,
  onEditCourse,
  onDeleteCourse,
  busy,
}: {
  events: ScheduleEvent[];
  sessions: Session[];
  weeklyBounds: { start?: string | null; end?: string | null };
  selectedDate: string;
  onSelectDate: (dateKey: string) => void;
  onEditCourse: (eventId: string) => void;
  onDeleteCourse: (eventId: string) => void;
  busy?: boolean;
}) {
  const today = todayDateKey();
  const weekKeys = useMemo(() => weekDateKeys(selectedDate), [selectedDate]);

  const weekOccurrences = useMemo(
    () => expandScheduleEvents(events, weekKeys[0], weekKeys[6], weeklyBounds),
    [events, weekKeys, weeklyBounds],
  );

  const dayAgenda = useMemo(
    () => buildDayAgenda(weekOccurrences, sessions, selectedDate),
    [weekOccurrences, sessions, selectedDate],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => onSelectDate(addDays(selectedDate, -7))}
          aria-label="Previous week"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 text-center">
          <p className="truncate text-sm font-semibold">{friendlyDateLabel(selectedDate)}</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => onSelectDate(addDays(selectedDate, 7))}
          aria-label="Next week"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {weekKeys.map((key) => {
          const d = parseDateKey(key);
          const count = buildDayAgenda(weekOccurrences, sessions, key).length;
          const active = key === selectedDate;
          const isToday = key === today;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectDate(key)}
              className={cn(
                "flex min-h-16 min-w-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-2 transition-colors",
                active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60",
              )}
            >
              <span className="text-[10px] uppercase text-muted-foreground">
                {d.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <span
                className={cn(
                  "text-base font-semibold tabular-nums",
                  isToday && !active && "text-primary",
                )}
              >
                {d.getDate()}
              </span>
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  count > 0 ? "bg-primary" : "bg-transparent",
                )}
                aria-hidden
              />
            </button>
          );
        })}
      </div>

      {selectedDate !== today && (
        <button
          type="button"
          onClick={() => onSelectDate(today)}
          className="text-xs font-medium text-primary hover:underline"
        >
          Jump to today
        </button>
      )}

      <ScheduleTimeline
        items={dayAgenda}
        onEditCourse={onEditCourse}
        onDeleteCourse={onDeleteCourse}
        busy={busy}
      />
    </div>
  );
}
