import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ScheduleCategory, ScheduleEvent, ScheduleKind } from "@/features/schedule/schedule";
import { validateScheduleTimes } from "@/features/schedule/schedule";

export interface ScheduleEventInput {
  title: string;
  courseCode?: string | null;
  location?: string | null;
  color?: string;
  category?: ScheduleCategory;
  subtype?: string | null;
  kind: ScheduleKind;
  dayOfWeek?: number | null;
  eventDate?: string | null;
  startTime: string;
  endTime: string;
  notes?: string | null;
}

function mapRow(row: Record<string, unknown>): ScheduleEvent {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    courseCode: row.course_code ? String(row.course_code) : null,
    location: row.location ? String(row.location) : null,
    color: String(row.color ?? "#6366f1"),
    category: row.category === "exam" ? "exam" : "class",
    subtype: row.subtype ? String(row.subtype) : null,
    kind: row.kind === "once" ? "once" : "weekly",
    dayOfWeek: row.day_of_week == null ? null : Number(row.day_of_week),
    eventDate: row.event_date ? String(row.event_date) : null,
    startTime: String(row.start_time ?? "09:00"),
    endTime: String(row.end_time ?? "10:00"),
    notes: row.notes ? String(row.notes) : null,
  };
}

function validateInput(input: ScheduleEventInput): void {
  const title = input.title.trim();
  if (!title) throw new Error("Enter a course or event name.");

  const timeError = validateScheduleTimes(input.startTime, input.endTime);
  if (timeError) throw new Error(timeError);

  if (
    input.kind === "weekly" &&
    (input.dayOfWeek == null || input.dayOfWeek < 0 || input.dayOfWeek > 6)
  ) {
    throw new Error("Pick which day of the week this repeats.");
  }
  if (input.kind === "once" && !input.eventDate) {
    throw new Error("Pick a date for this one-time event.");
  }
}

function toDbRow(userId: string, input: ScheduleEventInput) {
  validateInput(input);
  return {
    user_id: userId,
    title: input.title.trim(),
    course_code: input.courseCode?.trim() || null,
    location: input.location?.trim() || null,
    color: input.color?.trim() || "#6366f1",
    category: input.category === "exam" ? "exam" : "class",
    subtype: input.category === "exam" ? null : (input.subtype ?? null),
    kind: input.kind,
    day_of_week: input.kind === "weekly" ? input.dayOfWeek : null,
    event_date: input.kind === "once" ? input.eventDate : null,
    start_time: input.startTime.trim(),
    end_time: input.endTime.trim(),
    notes: input.notes?.trim() || null,
  };
}

async function fetchScheduleEvents(): Promise<ScheduleEvent[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("schedule_events")
    .select(
      "id, title, course_code, location, color, category, subtype, kind, day_of_week, event_date, start_time, end_time, notes",
    )
    .order("start_time", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
}

async function addScheduleEvent(input: ScheduleEventInput): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const { error } = await supabase.from("schedule_events").insert(toDbRow(user.id, input));
  if (error) throw new Error(error.message);
}

async function addScheduleEvents(inputs: ScheduleEventInput[]): Promise<void> {
  if (inputs.length === 0) throw new Error("Add at least one meeting or exam.");
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const rows = inputs.map((i) => toDbRow(user.id, i));
  const { error } = await supabase.from("schedule_events").insert(rows);
  if (error) throw new Error(error.message);
}

async function updateScheduleEvent(id: string, input: ScheduleEventInput): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const { error } = await supabase
    .from("schedule_events")
    .update(toDbRow(user.id, input))
    .eq("id", id);
  if (error) throw new Error(error.message);
}

async function removeScheduleEvent(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("schedule_events").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export function useScheduleEvents() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["schedule-events", user?.id],
    queryFn: fetchScheduleEvents,
    enabled: !!user,
  });
}

export function useScheduleActions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["schedule-events", user?.id] });
  };

  return {
    add: useMutation({ mutationFn: addScheduleEvent, onSuccess: invalidate }),
    addMany: useMutation({ mutationFn: addScheduleEvents, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: ScheduleEventInput }) =>
        updateScheduleEvent(id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: removeScheduleEvent, onSuccess: invalidate }),
  };
}
