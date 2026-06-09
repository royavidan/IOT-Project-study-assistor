import { useMemo } from "react";

import { useAuth } from "@/lib/auth/auth-context";
import { useReviewerStudents } from "@/lib/queries/reviewer";
import { useSessions } from "@/lib/queries/sessions";
import { filterSessionsByUser } from "@/lib/session-scope";

export function useSessionScope(scopeUserId: string | undefined) {
  const { user } = useAuth();
  const sessionsQuery = useSessions();
  const reviewerStudentsQuery = useReviewerStudents();

  const targetId = scopeUserId ?? user?.id;
  const students = reviewerStudentsQuery.data ?? [];
  const viewingStudent = students.find((s) => s.ownerUserId === scopeUserId);
  const isReviewerView = !!scopeUserId && scopeUserId !== user?.id;

  const scopedSessions = useMemo(
    () => filterSessionsByUser(sessionsQuery.data ?? [], targetId, user?.id),
    [sessionsQuery.data, targetId, user?.id],
  );

  return {
    user,
    targetId,
    students,
    viewingStudent,
    isReviewerView,
    scopedSessions,
    sessionsQuery,
    reviewerStudentsQuery,
  };
}
