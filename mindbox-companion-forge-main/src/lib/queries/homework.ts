import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { HomeworkAssignment, HomeworkStatus } from "@/lib/types";

export interface HomeworkInput {
  courseCode?: string | null;
  title: string;
  description?: string | null;
  dueDate: string;
  status?: HomeworkStatus;
  progressPct?: number | null;
  /** Points this assignment is worth toward the final grade. Null = not counted. */
  weight?: number | null;
  notes?: string | null;
}

export interface HomeworkUpdateInput extends HomeworkInput {
  grade?: number | null;
}

function mapRow(row: Record<string, unknown>): HomeworkAssignment {
  return {
    id: String(row.id),
    courseCode: row.course_code ? String(row.course_code) : null,
    title: String(row.title ?? ""),
    description: row.description ? String(row.description) : null,
    dueDate: String(row.due_date ?? ""),
    status: (row.status as HomeworkStatus) ?? "pending",
    fileUrl: row.file_url ? String(row.file_url) : null,
    fileName: row.file_name ? String(row.file_name) : null,
    fileSizeBytes: row.file_size_bytes ? Number(row.file_size_bytes) : null,
    grade: row.grade == null ? null : Number(row.grade),
    progressPct: row.progress_pct == null ? null : Number(row.progress_pct),
    weight: row.weight == null ? null : Number(row.weight),
    notes: row.notes ? String(row.notes) : null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function validateInput(input: HomeworkInput): void {
  const title = input.title.trim();
  if (!title) throw new Error("Enter a homework title.");

  if (!input.dueDate) throw new Error("Pick a due date.");

  const dueDate = new Date(input.dueDate);
  if (Number.isNaN(dueDate.getTime())) {
    throw new Error("Invalid due date.");
  }
}

function clampProgress(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function toDbRow(
  userId: string,
  input: HomeworkInput,
  fileData?: { fileName: string; fileSizeBytes: number; fileUrl: string },
) {
  validateInput(input);
  return {
    user_id: userId,
    course_code: input.courseCode?.trim() || null,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    due_date: input.dueDate,
    status: input.status ?? "pending",
    progress_pct: clampProgress(input.progressPct),
    weight: input.weight == null ? null : Math.max(0, input.weight),
    file_name: fileData?.fileName || null,
    file_size_bytes: fileData?.fileSizeBytes || null,
    file_url: fileData?.fileUrl || null,
    notes: input.notes?.trim() || null,
  };
}

async function fetchHomeworkAssignments(): Promise<HomeworkAssignment[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("homework_assignments")
    .select(
      "id, course_code, title, description, due_date, status, file_url, file_name, file_size_bytes, grade, progress_pct, weight, notes, created_at, updated_at",
    )
    .order("due_date", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
}

async function addHomeworkAssignment(input: HomeworkInput, file?: File): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  let fileData: { fileName: string; fileSizeBytes: number; fileUrl: string } | undefined;

  if (file) {
    // Validate file size (25 MB limit)
    const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `File size must be less than 25 MB (current: ${(file.size / 1024 / 1024).toFixed(2)} MB)`,
      );
    }

    // Upload file to Supabase Storage
    const fileName = `${user.id}/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("homework-files")
      .upload(fileName, file);

    if (uploadError) throw new Error(`Failed to upload file: ${uploadError.message}`);

    // Get public URL
    const { data: urlData } = supabase.storage.from("homework-files").getPublicUrl(fileName);

    fileData = {
      fileName: file.name,
      fileSizeBytes: file.size,
      fileUrl: urlData.publicUrl,
    };
  }

  const { error } = await supabase
    .from("homework_assignments")
    .insert(toDbRow(user.id, input, fileData));
  if (error) throw new Error(error.message);
}

async function updateHomeworkAssignment(
  id: string,
  input: HomeworkUpdateInput,
  file?: File,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  let fileData: { fileName: string; fileSizeBytes: number; fileUrl: string } | undefined;

  if (file) {
    // Validate file size (25 MB limit)
    const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(
        `File size must be less than 25 MB (current: ${(file.size / 1024 / 1024).toFixed(2)} MB)`,
      );
    }

    // Upload file to Supabase Storage
    const fileName = `${user.id}/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("homework-files")
      .upload(fileName, file);

    if (uploadError) throw new Error(`Failed to upload file: ${uploadError.message}`);

    // Get public URL
    const { data: urlData } = supabase.storage.from("homework-files").getPublicUrl(fileName);

    fileData = {
      fileName: file.name,
      fileSizeBytes: file.size,
      fileUrl: urlData.publicUrl,
    };
  }

  const updateData = toDbRow(user.id, input, fileData);
  if (input.grade !== undefined) {
    (updateData as Record<string, unknown>).grade = input.grade ?? null;
  }

  const { error } = await supabase.from("homework_assignments").update(updateData).eq("id", id);
  if (error) throw new Error(error.message);
}

async function removeHomeworkAssignment(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("homework_assignments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

async function setHomeworkStatus(id: string, status: HomeworkStatus): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("homework_assignments").update({ status }).eq("id", id);
  if (error) throw new Error(error.message);
}

export function useHomeworkAssignments() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["homework-assignments", user?.id],
    queryFn: fetchHomeworkAssignments,
    enabled: !!user,
  });
}

export function useHomeworkActions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["homework-assignments", user?.id];
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey });
  };

  return {
    add: useMutation({
      mutationFn: ({ input, file }: { input: HomeworkInput; file?: File }) =>
        addHomeworkAssignment(input, file),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, input, file }: { id: string; input: HomeworkUpdateInput; file?: File }) =>
        updateHomeworkAssignment(id, input, file),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: removeHomeworkAssignment, onSuccess: invalidate }),
    // Quick board move — optimistic so it feels instant on mobile, rolls back on error.
    setStatus: useMutation({
      mutationFn: ({ id, status }: { id: string; status: HomeworkStatus }) =>
        setHomeworkStatus(id, status),
      onMutate: async ({ id, status }) => {
        await queryClient.cancelQueries({ queryKey });
        const prev = queryClient.getQueryData<HomeworkAssignment[]>(queryKey);
        queryClient.setQueryData<HomeworkAssignment[]>(queryKey, (old) =>
          (old ?? []).map((h) => (h.id === id ? { ...h, status } : h)),
        );
        return { prev };
      },
      onError: (_e, _vars, ctx) => {
        if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
      },
      onSettled: invalidate,
    }),
  };
}
