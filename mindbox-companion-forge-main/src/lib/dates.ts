/** ISO-like date key (YYYY-MM-DD) in the user's local timezone. */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's date in the user's local timezone. */
export function todayDateKey(now = new Date()): string {
  return toDateKey(now);
}

/** Local calendar date n days before today (0 = today). */
export function dateKeyDaysAgo(n: number, now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return toDateKey(d);
}

/** Parse a YYYY-MM-DD key as local midnight. */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

/** Inclusive local-day range as ISO timestamps for database queries. */
export function localDayRangeIso(from: string, to: string): { fromIso: string; toIso: string } {
  const start = parseDateKey(from);
  const end = parseDateKey(to);
  end.setHours(23, 59, 59, 999);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}
