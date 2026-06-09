import { toDateKey } from "@/lib/dates";

export { toDateKey };

/**
 * Consecutive-day focus streak ending today or yesterday.
 * Mirrors the SQL island logic in `get_leaderboard()` / `get_focus_streak()`.
 */
export function computeStreakFromDateKeys(dateKeys: Iterable<string>, now = new Date()): number {
  const days = new Set(dateKeys);
  if (days.size === 0) return 0;

  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  if (!days.has(toDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (days.has(toDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
