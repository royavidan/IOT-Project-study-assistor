import { useMemo } from "react";
import { CalendarClock, CalendarDays } from "lucide-react";

import { EmptyState } from "@/components/EmptyState";
import { parseDateKey, toDateKey, todayDateKey } from "@/lib/dates";
import type { Session } from "@/lib/types";
import {
  buildDayAgenda,
  countdownLabel,
  expandScheduleEvents,
  friendlyDateLabel,
  upcomingExams,
  type ScheduleEvent,
} from "@/features/schedule/schedule";
import { AgendaRow } from "@/features/schedule/components/AgendaRow";

const HORIZON_DAYS = 30;

function addDays(key: string, n: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

export function CalendarAgendaView({
  events,
  sessions,
  weeklyBounds,
  onEditCourse,
  onDeleteCourse,
  busy,
}: {
  events: ScheduleEvent[];
  sessions: Session[];
  weeklyBounds: { start?: string | null; end?: string | null };
  onEditCourse: (eventId: string) => void;
  onDeleteCourse: (eventId: string) => void;
  busy?: boolean;
}) {
  const today = todayDateKey();
  const to = addDays(today, HORIZON_DAYS);

  const days = useMemo(() => {
    const occurrences = expandScheduleEvents(events, today, to, weeklyBounds);
    const out: { dateKey: string; items: ReturnType<typeof buildDayAgenda> }[] = [];
    for (let i = 0; i <= HORIZON_DAYS; i++) {
      const dateKey = addDays(today, i);
      const items = buildDayAgenda(occurrences, sessions, dateKey);
      if (items.length > 0) out.push({ dateKey, items });
    }
    return out;
  }, [events, sessions, weeklyBounds, today, to]);

  const nextExam = useMemo(() => upcomingExams(events)[0] ?? null, [events]);

  if (days.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays className="h-8 w-8" />}
        title="Nothing in the next month"
        description="Add a class, exam, or one-off event and it will show up here alongside your MindBox focus sessions."
      />
    );
  }

  return (
    <div className="space-y-6">
      {nextExam && (
        <div className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger-muted/30 px-4 py-3">
          <CalendarClock className="h-5 w-5 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{nextExam.event.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {friendlyDateLabel(nextExam.dateKey)}
              {nextExam.event.courseCode ? ` · ${nextExam.event.courseCode}` : ""}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">
            {countdownLabel(nextExam.dateKey)}
          </span>
        </div>
      )}

      {days.map(({ dateKey, items }) => (
        <section key={dateKey}>
          <h2 className="sticky top-14 z-10 -mx-1 mb-2 bg-background/95 px-1 py-1.5 text-sm font-semibold backdrop-blur lg:top-0">
            {friendlyDateLabel(dateKey)}
          </h2>
          <div className="space-y-2">
            {items.map((item) => (
              <AgendaRow
                key={item.id}
                item={item}
                onEditCourse={onEditCourse}
                onDeleteCourse={onDeleteCourse}
                busy={busy}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
