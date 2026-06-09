function parseMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number.parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

/** True when `now` falls inside the quiet-hours window (supports overnight spans). */
export function isInQuietHours(
  now: Date,
  start: string | null | undefined,
  end: string | null | undefined,
): boolean {
  if (!start || !end) return false;
  const s = parseMinutes(start);
  const e = parseMinutes(end);
  const n = now.getHours() * 60 + now.getMinutes();
  if (s === e) return false;
  if (s < e) return n >= s && n < e;
  return n >= s || n < e;
}
