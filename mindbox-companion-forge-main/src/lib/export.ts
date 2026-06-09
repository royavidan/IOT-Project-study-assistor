// Pure, dependency-free report builders for Story 11 (Export Delivery).
// CSV and JSON are generated as real downloadable strings; the PDF path uses
// printReportHtml() (hidden iframe + print dialog) with an HTML download fallback.
//
// Every builder is pure (string in / string out) so it can be unit-tested
// without a DOM or network.

import type { Session } from "@/lib/types";

export interface ReportMeta {
  /** Who the report is for — display name or email. */
  user: string;
  from: string; // ISO date (YYYY-MM-DD)
  to: string; // ISO date (YYYY-MM-DD)
  generatedAt: string; // ISO timestamp
}

export interface ReportSummary {
  sessionCount: number;
  totalFocusMin: number;
  avgFocusScore: number;
  avgNoise: number | null;
  avgTempC: number | null;
  avgLightLux: number | null;
}

const CSV_HEADERS = [
  "Date",
  "Start",
  "Duration (min)",
  "Mode",
  "Status",
  "Focus Load Estimate",
  "Breaks",
  "Presence interruptions",
  "Avg noise (0-1)",
  "Avg temp (C)",
  "Avg light (lux)",
] as const;

/** Escapes a value for RFC-4180 CSV (quote fields containing , " or newlines). */
export function escapeCsv(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function cell(value: number | null): string {
  return value == null ? "" : String(value);
}

export function sessionsToCsv(sessions: Session[]): string {
  const rows = sessions.map((s) =>
    [
      s.date,
      s.start,
      s.durationMin,
      s.mode,
      s.status,
      s.focusScore,
      s.breaks,
      s.presenceInterruptions,
      cell(s.noiseAvg),
      cell(s.tempC),
      cell(s.lightLux),
    ]
      .map(escapeCsv)
      .join(","),
  );
  return [CSV_HEADERS.join(","), ...rows].join("\r\n");
}

function avg(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length === 0) return null;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

export function summarize(sessions: Session[]): ReportSummary {
  const totalFocusMin = sessions.reduce((sum, s) => sum + s.durationMin, 0);
  const avgScore = sessions.length
    ? Math.round(sessions.reduce((sum, s) => sum + s.focusScore, 0) / sessions.length)
    : 0;
  const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  return {
    sessionCount: sessions.length,
    totalFocusMin,
    avgFocusScore: avgScore,
    avgNoise: round1(avg(sessions.map((s) => s.noiseAvg))),
    avgTempC: round1(avg(sessions.map((s) => s.tempC))),
    avgLightLux: round1(avg(sessions.map((s) => s.lightLux))),
  };
}

export function sessionsToJson(sessions: Session[], meta: ReportMeta): string {
  return JSON.stringify(
    {
      report: "MindBox focus history",
      meta,
      summary: summarize(sessions),
      note: "Focus Load Estimate is a transparent heuristic (0-100), not a validated scientific measurement.",
      sessions,
    },
    null,
    2,
  );
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Self-contained printable HTML report. Opened in a new window where the user
 * invokes Print -> "Save as PDF". Inline styles keep it dependency-free.
 */
export function buildReportHtml(sessions: Session[], meta: ReportMeta): string {
  const sum = summarize(sessions);
  const fmtNum = (v: number | null, suffix = "") => (v == null ? "—" : `${v}${suffix}`);

  const rows = sessions
    .map(
      (s) => `<tr>
        <td>${escapeHtml(s.date)}</td>
        <td>${escapeHtml(s.start)}</td>
        <td class="num">${s.durationMin}</td>
        <td>${escapeHtml(s.mode)}</td>
        <td>${escapeHtml(s.status)}</td>
        <td class="num">${s.focusScore}</td>
        <td class="num">${s.breaks}</td>
        <td class="num">${fmtNum(s.noiseAvg)}</td>
        <td class="num">${fmtNum(s.tempC)}</td>
        <td class="num">${fmtNum(s.lightLux)}</td>
      </tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>MindBox report — ${escapeHtml(meta.user)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #666; font-size: 12px; }
  .cards { display: flex; flex-wrap: wrap; gap: 12px; margin: 20px 0; }
  .card { border: 1px solid #e2e2e2; border-radius: 8px; padding: 10px 14px; min-width: 120px; }
  .card .k { font-size: 11px; color: #666; }
  .card .v { font-size: 18px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border-bottom: 1px solid #eee; padding: 6px 8px; text-align: left; }
  th { background: #f7f7f7; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .disclaimer { margin-top: 18px; font-size: 11px; color: #777; }
  @media print { body { margin: 12mm; } .noprint { display: none; } }
</style>
</head>
<body>
  <h1>MindBox — Focus History Report</h1>
  <p class="muted">For ${escapeHtml(meta.user)} · ${escapeHtml(meta.from)} → ${escapeHtml(meta.to)} · generated ${escapeHtml(meta.generatedAt)}</p>

  <div class="cards">
    <div class="card"><div class="k">Sessions</div><div class="v">${sum.sessionCount}</div></div>
    <div class="card"><div class="k">Total focus</div><div class="v">${(sum.totalFocusMin / 60).toFixed(1)} h</div></div>
    <div class="card"><div class="k">Avg Focus Load Est.</div><div class="v">${sum.avgFocusScore}</div></div>
    <div class="card"><div class="k">Avg noise</div><div class="v">${fmtNum(sum.avgNoise)}</div></div>
    <div class="card"><div class="k">Avg temp</div><div class="v">${fmtNum(sum.avgTempC, "°C")}</div></div>
    <div class="card"><div class="k">Avg light</div><div class="v">${fmtNum(sum.avgLightLux, " lux")}</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Date</th><th>Start</th><th class="num">Min</th><th>Mode</th><th>Status</th>
        <th class="num">Focus Load Est.</th><th class="num">Breaks</th>
        <th class="num">Noise</th><th class="num">Temp</th><th class="num">Light</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="10" class="muted">No sessions in this range.</td></tr>`}
    </tbody>
  </table>

  <p class="disclaimer">
    Focus Load Estimate is a transparent heuristic on a 0–100 scale, derived from session length and
    observed attention/environment patterns. It is <strong>not</strong> a validated scientific or clinical
    measurement.
  </p>
</body>
</html>`;
}
