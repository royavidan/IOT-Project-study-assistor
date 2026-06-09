import type { Session } from "@/lib/types";

/** Filters session rows to a single user (own data or a reviewed student). */
export function filterSessionsByUser(
  sessions: Session[],
  userId: string | undefined,
  ownUserId?: string,
): Session[] {
  if (!userId) return sessions;
  if (ownUserId && userId === ownUserId) {
    return sessions.filter((s) => !s.userId || s.userId === userId);
  }
  return sessions.filter((s) => s.userId === userId);
}
