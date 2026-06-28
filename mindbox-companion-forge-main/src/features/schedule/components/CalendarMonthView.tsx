import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { parseDateKey, toDateKey, todayDateKey } from "@/lib/dates";
import {
  courseMarkersByDate,
  expandScheduleEvents,
  monthDateRange,
  type ScheduleEvent,
} from "@/features/schedule/schedule";

export function CalendarMonthView({
  events,
  weeklyBounds,
  selectedDate,
  visibleMonth,
  onVisibleMonthChange,
  onSelectDate,
}: {
  events: ScheduleEvent[];
  weeklyBounds: { start?: string | null; end?: string | null };
  selectedDate: string;
  visibleMonth: Date;
  onVisibleMonthChange: (month: Date) => void;
  onSelectDate: (dateKey: string) => void;
}) {
  const monthRange = useMemo(() => monthDateRange(visibleMonth), [visibleMonth]);
  const occurrences = useMemo(
    () => expandScheduleEvents(events, monthRange.from, monthRange.to, weeklyBounds),
    [events, monthRange, weeklyBounds],
  );
  const markersByDate = useMemo(() => courseMarkersByDate(occurrences), [occurrences]);

  return (
    <Card className="mx-auto max-w-md">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-base font-semibold">
            {visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </p>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() =>
                onVisibleMonthChange(
                  new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1),
                )
              }
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() =>
                onVisibleMonthChange(
                  new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1),
                )
              }
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex justify-center">
          <Calendar
            mode="single"
            className="[--cell-size:2.6rem] sm:[--cell-size:2.75rem]"
            month={visibleMonth}
            onMonthChange={onVisibleMonthChange}
            selected={parseDateKey(selectedDate)}
            onSelect={(date) => date && onSelectDate(toDateKey(date))}
            modifiers={{
              hasItems: (date) => markersByDate.has(toDateKey(date)),
            }}
            modifiersClassNames={{
              hasItems: "font-semibold",
            }}
            components={{
              DayButton: ({ day, modifiers, ...props }) => {
                const markers = markersByDate.get(toDateKey(day.date)) ?? [];
                return (
                  <div className="relative flex flex-col items-center">
                    <CalendarDayButton day={day} modifiers={modifiers} {...props} />
                    {markers.length > 0 && (
                      <span className="pointer-events-none absolute bottom-1 flex gap-0.5">
                        {markers.map((m, i) =>
                          m.category === "exam" ? (
                            <span
                              key={i}
                              className="h-2 w-2 rounded-full border-2 bg-transparent"
                              style={{ borderColor: m.color }}
                              aria-hidden
                            />
                          ) : (
                            <span
                              key={i}
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: m.color }}
                              aria-hidden
                            />
                          ),
                        )}
                      </span>
                    )}
                  </div>
                );
              },
            }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-primary" /> Class
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full border-2 border-primary bg-transparent" /> Exam
          </span>
          <span>Dots are colored by course</span>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="mt-3 w-full"
          onClick={() => onSelectDate(todayDateKey())}
        >
          Jump to today
        </Button>
      </CardContent>
    </Card>
  );
}
