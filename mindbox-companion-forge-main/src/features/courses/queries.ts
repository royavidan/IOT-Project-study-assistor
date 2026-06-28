import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Course } from "@/features/courses/courses";

export interface CourseInput {
  code: string;
  name: string;
  color?: string;
  instructor?: string | null;
  credits?: number | null;
  targetGrade?: number | null;
  notes?: string | null;
}

export interface WatchedCounts {
  lectures: number;
  tutorials: number;
  labs: number;
}

function toCount(value: unknown): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function mapRow(row: Record<string, unknown>): Course {
  return {
    id: String(row.id),
    code: String(row.code ?? ""),
    name: String(row.name ?? ""),
    color: String(row.color ?? "#6366f1"),
    instructor: row.instructor ? String(row.instructor) : null,
    credits: row.credits == null ? null : Number(row.credits),
    targetGrade: row.target_grade == null ? null : Number(row.target_grade),
    notes: row.notes ? String(row.notes) : null,
    watchedLectures: toCount(row.watched_lectures),
    watchedTutorials: toCount(row.watched_tutorials),
    watchedLabs: toCount(row.watched_labs),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function validateInput(input: CourseInput): void {
  if (!input.code.trim()) throw new Error("Enter a course code.");
  if (!input.name.trim()) throw new Error("Enter a course name.");
  if (input.credits != null && input.credits < 0) {
    throw new Error("Credits can't be negative.");
  }
  if (input.targetGrade != null && (input.targetGrade < 0 || input.targetGrade > 100)) {
    throw new Error("Target grade must be between 0 and 100.");
  }
}

function toDbRow(userId: string, input: CourseInput) {
  validateInput(input);
  return {
    user_id: userId,
    code: input.code.trim(),
    name: input.name.trim(),
    color: input.color?.trim() || "#6366f1",
    instructor: input.instructor?.trim() || null,
    credits: input.credits ?? null,
    target_grade: input.targetGrade ?? null,
    notes: input.notes?.trim() || null,
  };
}

async function fetchCourses(): Promise<Course[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("courses")
    .select(
      "id, code, name, color, instructor, credits, target_grade, notes, watched_lectures, watched_tutorials, watched_labs, created_at, updated_at",
    )
    .order("code", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
}

async function addCourse(input: CourseInput): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const { error } = await supabase.from("courses").insert(toDbRow(user.id, input));
  if (error) {
    if (error.code === "23505")
      throw new Error(`A course with code "${input.code.trim()}" already exists.`);
    throw new Error(error.message);
  }
}

async function updateCourse(id: string, input: CourseInput): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const { error } = await supabase.from("courses").update(toDbRow(user.id, input)).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Delete a course plus the calendar classes/exams that link to it by code.
 * Homework (linked by free-text code, no FK) is intentionally kept. */
async function removeCourse({ id, code }: { id: string; code: string }): Promise<void> {
  const supabase = getSupabaseBrowserClient();

  const trimmed = code.trim();
  if (trimmed) {
    // ilike (no wildcards) = case-insensitive equality; course codes have no SQL metachars.
    const { error: eventError } = await supabase
      .from("schedule_events")
      .delete()
      .ilike("course_code", trimmed);
    if (eventError) throw new Error(eventError.message);
  }

  const { error } = await supabase.from("courses").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Update only the per-meeting-type watched counters (won't touch other fields). */
async function setCourseWatched(id: string, watched: WatchedCounts): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const clamp = (n: number) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  const { error } = await supabase
    .from("courses")
    .update({
      watched_lectures: clamp(watched.lectures),
      watched_tutorials: clamp(watched.tutorials),
      watched_labs: clamp(watched.labs),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Insert or update by (user_id, code) — used when a course is created from the
 * calendar's course builder so it also lands in the courses table. */
async function upsertCourse(input: CourseInput): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const { error } = await supabase
    .from("courses")
    .upsert(toDbRow(user.id, input), { onConflict: "user_id,code" });
  if (error) throw new Error(error.message);
}

export function useCourses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["courses", user?.id],
    queryFn: fetchCourses,
    enabled: !!user,
  });
}

export function useCourseActions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["courses", user?.id] });
    void queryClient.invalidateQueries({ queryKey: ["schedule-events", user?.id] });
  };

  return {
    add: useMutation({ mutationFn: addCourse, onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: CourseInput }) => updateCourse(id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: removeCourse, onSuccess: invalidate }),
    upsert: useMutation({ mutationFn: upsertCourse, onSuccess: invalidate }),
    setWatched: useMutation({
      mutationFn: ({ id, watched }: { id: string; watched: WatchedCounts }) =>
        setCourseWatched(id, watched),
      onSuccess: invalidate,
    }),
  };
}
