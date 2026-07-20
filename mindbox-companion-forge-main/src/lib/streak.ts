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

const DAY_MS = 86_400_000;

/**
 * Server-side variant for the device downlink: walks date KEYS backwards from
 * `todayKey` ("YYYY-MM-DD" in the OWNER's timezone) using pure UTC day math,
 * so the result is independent of the server's own timezone/locale.
 */
export function computeStreakFromDateKeySet(days: ReadonlySet<string>, todayKey: string): number {
  let cursorMs = Date.parse(`${todayKey}T00:00:00Z`);
  if (Number.isNaN(cursorMs)) return 0;
  const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  // Streak may end today OR yesterday (today's session might not exist yet).
  if (!days.has(keyOf(cursorMs))) cursorMs -= DAY_MS;
  let streak = 0;
  while (days.has(keyOf(cursorMs))) {
    streak++;
    cursorMs -= DAY_MS;
  }
  return streak;
}
