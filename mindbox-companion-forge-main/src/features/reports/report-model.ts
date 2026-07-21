// The report MODEL + pure section renderers + inline-SVG chart helpers.
//
// This is the extensibility backbone: a single `ReportModel` with a `scope`
// discriminant ("weekly" | "session") and OPTIONAL section payloads. The server
// (`report-model.server.ts`) assembles the model from the DB + aggregators; this
// file only turns a model into self-contained HTML (inline styles + inline SVG,
// so Puppeteer/Chrome and the browser print path render it with no library or
// API key). Everything here is pure (data in / string out) → unit-tested, and
// reused verbatim by both the weekly and the per-session report.
//
// The model holds REPORT-LOCAL shapes (not raw aggregator types) so this layer
// is decoupled and stable; the server maps aggregator outputs into these blocks.
//
// Framing invariant: behavioral pattern estimates with honest uncertainty, never
// a clinical/diagnostic claim (same as wellbeing / Focus Load / Focus Model).

import type { ReportMeta } from "./export";

export type ReportScope = "weekly" | "session";

export interface StatCard {
  label: string;
  value: string;
}
export interface FocusBlock {
  energyScore: number;
  energyCI: [number, number];
  headline: string;
  reliability: string;
  trendLabel: string;
  drivers: { label: string; effect: "adds" | "eases" }[];
}
export interface WellbeingBlock {
  ready: boolean;
  signals: { title: string; score: number; status: string; headline: string }[];
}
export interface OverloadBlock {
  level: "ok" | "warning" | "danger";
  rules: string[];
}
export interface InsightsBlock {
  bestTime: string | null;
  modes: { mode: string; minutes: number; count: number }[];
  /** 24 values, minutes studied per hour-of-day. */
  hourly: number[];
  /** Per-day focus minutes across the range (for the trend bar chart). */
  weekly: { label: string; minutes: number }[];
}
export interface StudyTimeBlock {
  rawMin: number;
  effectiveMin: number;
  ratio: number;
  sweetSpot: string;
}
export interface ConditionsBlock {
  score: number;
  band: string;
  factors: { label: string; value: string; band: string; tip: string }[];
}
export interface CheckinBlock {
  count: number;
  avgTiredness: number | null;
  /** Counts for tiredness 1..5 (index 0 = tiredness 1). */
  distribution: number[];
  notes: { date: string; tiredness: number; text: string }[];
}
export interface AcademicBlock {
  overall: { completionPct: number; gradeAvg: number | null };
  courses: {
    code: string;
    name: string;
    completionPct: number;
    grade: number | null;
    target: number | null;
  }[];
  upcomingExams: { title: string; course: string; daysUntil: number }[];
  homeworkDue: { title: string; course: string; due: string; status: string }[];
}
export interface SessionRow {
  date: string;
  start: string;
  durationMin: number;
  mode: string;
  status: string;
  focusScore: number;
  tiredness: number | null;
}
export interface SessionDetailBlock {
  mode: string;
  status: string;
  durationMin: number;
  breaks: number;
  presenceInterruptions: number;
  dynamics: {
    loadMean: number;
    loadPeak: number;
    loadVolatility: number;
    loadSlope: number;
    sustainedHighShare: number;
    envNoiseCoupling: number;
  };
  series: { tMin: number; focus: number | null; noise: number | null }[];
  checkin: { tiredness: number; note: string | null } | null;
}
export interface NarrativeBlock {
  headline: string;
  paragraphs: string[];
  highlights: string[];
  source: "ai" | "fallback";
}

export interface ReportModel {
  scope: ReportScope;
  meta: ReportMeta;
  narrative?: NarrativeBlock | null;
  stats?: StatCard[];
  focus?: FocusBlock | null;
  wellbeing?: WellbeingBlock;
  overload?: OverloadBlock | null;
  insights?: InsightsBlock;
  studyTime?: StudyTimeBlock;
  conditions?: ConditionsBlock | null;
  checkin?: CheckinBlock;
  academic?: AcademicBlock;
  sessions?: SessionRow[];
  sessionDetail?: SessionDetailBlock;
}

// --- helpers ---------------------------------------------------------------

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const C = {
  ink: "#1a1a1a",
  grid: "#e2e2e2",
  bar: "#2563eb",
  good: "#16a34a",
  warn: "#d97706",
  bad: "#dc2626",
};

/** Vertical bar chart. `bars` values are absolute; scaled to the max. */
export function svgBarChart(
  bars: { label: string; value: number }[],
  opts: { width?: number; height?: number; color?: string } = {},
): string {
  const w = opts.width ?? 520;
  const h = opts.height ?? 130;
  const pad = 22;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const bw = bars.length ? (w - pad * 2) / bars.length : 0;
  const color = opts.color ?? C.bar;
  const rects = bars
    .map((b, i) => {
      const bh = (b.value / max) * (h - pad * 2);
      const x = pad + i * bw + bw * 0.15;
      const y = h - pad - bh;
      const label = escapeHtml(b.label);
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${color}"/><text x="${(x + bw * 0.35).toFixed(1)}" y="${h - 6}" font-size="8" fill="#666" text-anchor="middle">${label}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg"><line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="${C.grid}"/>${rects}</svg>`;
}

/** Line chart over a series (nulls create gaps). y auto-scaled to [min,max]. */
export function svgLineChart(
  points: { x: number; y: number | null }[],
  opts: { width?: number; height?: number; color?: string; yMax?: number } = {},
): string {
  const w = opts.width ?? 520;
  const h = opts.height ?? 130;
  const pad = 22;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y).filter((y): y is number => y != null);
  if (ys.length === 0) return `<svg viewBox="0 0 ${w} ${h}" width="100%"></svg>`;
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs, xMin + 1);
  const yMax = opts.yMax ?? Math.max(...ys, 1);
  const yMin = Math.min(...ys, 0);
  const sx = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * (w - pad * 2);
  const sy = (y: number) => h - pad - ((y - yMin) / (yMax - yMin || 1)) * (h - pad * 2);
  let d = "";
  let pen = false;
  for (const p of points) {
    if (p.y == null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)} `;
    pen = true;
  }
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg"><line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="${C.grid}"/><path d="${d.trim()}" fill="none" stroke="${opts.color ?? C.bar}" stroke-width="1.5"/></svg>`;
}

/** 24-cell hour-of-day heat strip (0..23), intensity by value. */
export function svgHourHeatmap(hourly: number[]): string {
  const w = 520;
  const h = 46;
  const cell = w / 24;
  const max = Math.max(1, ...hourly);
  const cells = hourly
    .map((v, hr) => {
      const alpha = v > 0 ? 0.15 + 0.85 * (v / max) : 0.05;
      const label =
        hr % 6 === 0
          ? `<text x="${(hr * cell + cell / 2).toFixed(1)}" y="${h - 2}" font-size="7" fill="#888" text-anchor="middle">${hr}</text>`
          : "";
      return `<rect x="${(hr * cell).toFixed(1)}" y="2" width="${(cell - 1).toFixed(1)}" height="26" rx="1" fill="rgba(37,99,235,${alpha.toFixed(2)})"/>${label}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg">${cells}</svg>`;
}

/** Horizontal gauge 0..100 with an optional shaded confidence band. */
export function svgGauge(value: number, ci?: [number, number]): string {
  const w = 520;
  const h = 26;
  const v = Math.max(0, Math.min(100, value));
  const color = v >= 67 ? C.good : v >= 34 ? C.warn : C.bad;
  const band =
    ci && ci.length === 2
      ? `<rect x="${(ci[0] / 100) * w}" y="7" width="${(Math.max(0, ci[1] - ci[0]) / 100) * w}" height="12" rx="6" fill="rgba(0,0,0,0.10)"/>`
      : "";
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="7" width="${w}" height="12" rx="6" fill="#eee"/>${band}<rect x="0" y="7" width="${((v / 100) * w).toFixed(1)}" height="12" rx="6" fill="${color}"/></svg>`;
}

// --- section renderers -----------------------------------------------------

function cards(items: { k: string; v: string }[]): string {
  return `<div class="cards">${items
    .map(
      (c) =>
        `<div class="card"><div class="k">${escapeHtml(c.k)}</div><div class="v">${escapeHtml(c.v)}</div></div>`,
    )
    .join("")}</div>`;
}

function h2(t: string): string {
  return `<h2>${escapeHtml(t)}</h2>`;
}

export function renderNarrative(n: NarrativeBlock): string {
  const paras = n.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  const hl = n.highlights.length
    ? `<ul class="datalist">${n.highlights.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
    : "";
  return `<div class="summary"><div class="k">Summary</div><p class="lead">${escapeHtml(n.headline)}</p>${paras}${hl}<p class="muted">${n.source === "ai" ? "AI-written from your computed data" : "Auto-generated summary"} · behavioral pattern estimate, not medical advice</p></div>`;
}

export function renderFocus(f: FocusBlock): string {
  const drivers = f.drivers
    .map(
      (d) =>
        `<li>${escapeHtml(d.label)} <span class="${d.effect === "adds" ? "bad" : "good"}">${d.effect === "adds" ? "adds strain" : "eases strain"}</span></li>`,
    )
    .join("");
  return `${h2("Focus Model — your calibrated estimate")}
    <div class="big">${f.energyScore}<span class="suffix"> / 100 focus energy · ${escapeHtml(f.headline)}</span></div>
    ${svgGauge(f.energyScore, f.energyCI)}
    <p class="muted">Likely range ${f.energyCI[0]}–${f.energyCI[1]} · ${escapeHtml(f.trendLabel)}</p>
    <p class="muted"><strong>How reliable:</strong> ${escapeHtml(f.reliability)}</p>
    ${drivers ? `<div class="k">What's shaping it</div><ul class="datalist">${drivers}</ul>` : ""}`;
}

export function renderWellbeing(w: WellbeingBlock): string {
  if (!w.ready)
    return `<p class="muted">Not enough sessions in this range to estimate wellbeing patterns.</p>`;
  const c = w.signals
    .map(
      (s) =>
        `<div class="card"><div class="k">${escapeHtml(s.title)}</div><div class="v">${s.score}<span class="suffix"> / 100 · ${escapeHtml(s.status)}</span></div><div class="muted">${escapeHtml(s.headline)}</div></div>`,
    )
    .join("");
  return `<div class="cards">${c}</div>`;
}

export function renderOverload(o: OverloadBlock): string {
  const tone = o.level === "danger" ? "bad" : o.level === "warning" ? "warn" : "good";
  const label =
    o.level === "ok"
      ? "All clear — no overload pattern"
      : o.level === "danger"
        ? "Danger-level load pattern"
        : "Warning-level load pattern";
  const rules = o.rules.length
    ? `<ul class="datalist">${o.rules.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`
    : "";
  return `${h2("Load check")}<p class="lead ${tone}">${escapeHtml(label)}</p>${rules}`;
}

export function renderInsights(i: InsightsBlock): string {
  const weeklyChart = i.weekly.length
    ? svgBarChart(
        i.weekly.map((d) => ({ label: d.label, value: d.minutes })),
        { color: C.bar },
      )
    : "";
  const modeRows = i.modes
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.mode)}</td><td class="num">${m.count}</td><td class="num">${Math.round(m.minutes)}</td></tr>`,
    )
    .join("");
  return `${h2("When & how you studied")}
    ${i.bestTime ? `<p class="muted">Most focus minutes: <strong>${escapeHtml(i.bestTime)}</strong></p>` : ""}
    <div class="chart-label">Focus minutes per day</div>${weeklyChart}
    <div class="chart-label">By hour of day</div>${svgHourHeatmap(i.hourly)}
    ${modeRows ? `<table><thead><tr><th>Mode</th><th class="num">Sessions</th><th class="num">Minutes</th></tr></thead><tbody>${modeRows}</tbody></table>` : ""}`;
}

export function renderStudyTime(s: StudyTimeBlock): string {
  return `${h2("Study output")}${cards([
    { k: "Logged", v: `${(s.rawMin / 60).toFixed(1)} h` },
    { k: "Effective", v: `${(s.effectiveMin / 60).toFixed(1)} h` },
    { k: "Efficiency", v: `${Math.round(s.ratio * 100)}%` },
    { k: "Sweet spot", v: s.sweetSpot },
  ])}<p class="muted">Effective focus applies a diminishing-returns model — long unbroken sessions count for less.</p>`;
}

export function renderConditions(c: ConditionsBlock): string {
  const f = c.factors
    .map(
      (x) =>
        `<tr><td>${escapeHtml(x.label)}</td><td>${escapeHtml(x.value)}</td><td>${escapeHtml(x.band)}</td><td class="muted">${escapeHtml(x.tip)}</td></tr>`,
    )
    .join("");
  return `${h2("Study conditions")}<div class="big">${c.score}<span class="suffix"> / 100 · ${escapeHtml(c.band)}</span></div>${f ? `<table><thead><tr><th>Factor</th><th>Avg</th><th>Rating</th><th>Tip</th></tr></thead><tbody>${f}</tbody></table>` : ""}`;
}

export function renderCheckin(c: CheckinBlock): string {
  if (c.count === 0)
    return `${h2("Your check-in feedback")}<p class="muted">No post-session check-ins in this range. Answer the quick tiredness prompt after a session to feed this.</p>`;
  const dist = svgBarChart(
    c.distribution.map((n, i) => ({ label: `${i + 1}`, value: n })),
    { color: C.warn, height: 100 },
  );
  const notes = c.notes.length
    ? `<div class="k">Your notes</div><ul class="notes">${c.notes.map((n) => `<li><span class="muted">${escapeHtml(n.date)} · tiredness ${n.tiredness}/5</span><br/>“${escapeHtml(n.text)}”</li>`).join("")}</ul>`
    : "";
  return `${h2("Your check-in feedback")}
    <p class="muted">${c.count} check-in${c.count === 1 ? "" : "s"}${c.avgTiredness != null ? ` · average tiredness ${c.avgTiredness.toFixed(1)}/5` : ""}</p>
    <div class="chart-label">Tiredness distribution (1 = fresh, 5 = exhausted)</div>${dist}${notes}`;
}

export function renderAcademic(a: AcademicBlock): string {
  const courseRows = a.courses
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.code)}</td><td>${escapeHtml(c.name)}</td><td class="num">${c.completionPct}%</td><td class="num">${c.grade != null ? c.grade.toFixed(0) : "—"}</td><td class="num">${c.target != null ? c.target.toFixed(0) : "—"}</td></tr>`,
    )
    .join("");
  const exams = a.upcomingExams.length
    ? `<div class="k">Upcoming exams</div><ul class="datalist">${a.upcomingExams.map((e) => `<li>${escapeHtml(e.title)} (${escapeHtml(e.course)}) — in ${e.daysUntil} day${e.daysUntil === 1 ? "" : "s"}</li>`).join("")}</ul>`
    : "";
  const hw = a.homeworkDue.length
    ? `<div class="k">Homework due soon</div><ul class="datalist">${a.homeworkDue.map((h) => `<li>${escapeHtml(h.title)} (${escapeHtml(h.course)}) — ${escapeHtml(h.due)} · ${escapeHtml(h.status)}</li>`).join("")}</ul>`
    : "";
  return `${h2("Academic context")}
    ${cards([
      { k: "Completion", v: `${a.overall.completionPct}%` },
      { k: "Grade avg", v: a.overall.gradeAvg != null ? a.overall.gradeAvg.toFixed(0) : "—" },
      { k: "Courses", v: String(a.courses.length) },
    ])}
    ${courseRows ? `<table><thead><tr><th>Code</th><th>Course</th><th class="num">Done</th><th class="num">Grade</th><th class="num">Target</th></tr></thead><tbody>${courseRows}</tbody></table>` : ""}
    ${exams}${hw}`;
}

export function renderSessionTable(rows: SessionRow[]): string {
  const body = rows
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.date)}</td><td>${escapeHtml(s.start)}</td><td class="num">${s.durationMin}</td><td>${escapeHtml(s.mode)}</td><td>${escapeHtml(s.status)}</td><td class="num">${s.focusScore}</td><td class="num">${s.tiredness ?? "—"}</td></tr>`,
    )
    .join("");
  return `${h2("Session log")}<table><thead><tr><th>Date</th><th>Start</th><th class="num">Min</th><th>Mode</th><th>Status</th><th class="num">Load</th><th class="num">Tired</th></tr></thead><tbody>${body || `<tr><td colspan="7" class="muted">No sessions in this range.</td></tr>`}</tbody></table>`;
}

export function renderSessionDetail(d: SessionDetailBlock): string {
  const focusSeries = d.series.map((p) => ({ x: p.tMin, y: p.focus }));
  const noiseSeries = d.series.map((p) => ({
    x: p.tMin,
    y: p.noise == null ? null : p.noise * 100,
  }));
  const slope = d.dynamics.loadSlope;
  return `${h2("Session")}
    ${cards([
      { k: "Mode", v: d.mode },
      { k: "Length", v: `${d.durationMin} min` },
      { k: "Status", v: d.status },
      { k: "Breaks", v: String(d.breaks) },
      { k: "Interruptions", v: String(d.presenceInterruptions) },
    ])}
    <div class="chart-label">Focus Load over the session (0–100)</div>${svgLineChart(focusSeries, { color: C.bar, yMax: 100 })}
    <div class="chart-label">Ambient noise over the session (%)</div>${svgLineChart(noiseSeries, { color: C.warn, yMax: 100 })}
    ${h2("Within-session dynamics")}
    ${cards([
      { k: "Avg load", v: d.dynamics.loadMean.toFixed(0) },
      { k: "Peak", v: d.dynamics.loadPeak.toFixed(0) },
      { k: "Volatility", v: d.dynamics.loadVolatility.toFixed(0) },
      { k: "Trend", v: `${slope > 0 ? "+" : ""}${slope.toFixed(0)}/10min` },
      { k: "High-load time", v: `${Math.round(d.dynamics.sustainedHighShare * 100)}%` },
    ])}
    <p class="muted">Positive trend = strain climbed through the session. Noise→load coupling: ${d.dynamics.envNoiseCoupling.toFixed(2)} (higher = noisier minutes preceded heavier load).</p>
    ${d.checkin ? `${h2("Your check-in")}<p>Tiredness <strong>${d.checkin.tiredness}/5</strong>${d.checkin.note ? ` — “${escapeHtml(d.checkin.note)}”` : ""}</p>` : ""}`;
}

function transparency(): string {
  return `${h2("What's in this report")}<ul class="datalist">
    <li>Sessions, per-minute focus/environment samples, and your post-session check-ins (tiredness + notes)</li>
    <li>The Focus Model — a personalized estimate calibrated on your check-ins, with its validated accuracy</li>
    <li>Wellbeing patterns, load check, study insights, conditions, and academic context (grades/homework/exams)</li>
    <li>No health, clinical, or device-telemetry data. These are behavioral estimates, not clinical measures.</li>
  </ul>
  <p class="disclaimer">Focus Load and the Focus Model are transparent estimates (0–100) with uncertainty — <strong>not</strong> validated scientific or clinical measurements of fatigue, focus, or cognitive health.</p>`;
}

const STYLE = `
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 22px 0 8px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  .muted { color: #666; font-size: 12px; }
  .lead { font-size: 13px; font-weight: 600; margin: 6px 0; }
  .big { font-size: 26px; font-weight: 700; margin: 6px 0; }
  .suffix { font-size: 12px; color: #666; font-weight: 400; }
  .cards { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0; }
  .card { border: 1px solid #e2e2e2; border-radius: 8px; padding: 8px 12px; min-width: 96px; }
  .card .k, .k { font-size: 11px; color: #666; margin-top: 6px; }
  .card .v { font-size: 17px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0; }
  th, td { border-bottom: 1px solid #eee; padding: 5px 8px; text-align: left; }
  th { background: #f7f7f7; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .chart-label { font-size: 11px; color: #666; margin: 10px 0 2px; }
  .datalist { margin: 4px 0; padding-left: 18px; font-size: 12px; color: #444; }
  .notes { list-style: none; padding: 0; margin: 6px 0; }
  .notes li { border-left: 3px solid #e2e2e2; padding: 2px 0 6px 10px; margin: 6px 0; font-size: 12px; }
  .summary { border: 1px solid #dbeafe; background: #eff6ff; border-radius: 10px; padding: 12px 16px; margin: 14px 0; }
  .summary p { font-size: 12px; margin: 6px 0; }
  .good { color: #16a34a; } .warn { color: #d97706; } .bad { color: #dc2626; }
  .disclaimer { margin-top: 14px; font-size: 11px; color: #777; }
  @media print { body { margin: 12mm; } }
`;

/** Compose the full self-contained HTML report from a model, keyed by scope. */
export function buildReportHtml(model: ReportModel): string {
  const m = model;
  const title =
    m.scope === "session" ? "MindBox — Session Report" : "MindBox — Weekly Focus Report";
  const parts: string[] = [];

  parts.push(`<h1>${title}</h1>`);
  parts.push(
    `<p class="muted">For ${escapeHtml(m.meta.user)} · ${escapeHtml(m.meta.from)} → ${escapeHtml(m.meta.to)} · generated ${escapeHtml(m.meta.generatedAt)}</p>`,
  );

  if (m.narrative) parts.push(renderNarrative(m.narrative));
  if (m.stats?.length) parts.push(cards(m.stats.map((s) => ({ k: s.label, v: s.value }))));

  if (m.scope === "session") {
    if (m.sessionDetail) parts.push(renderSessionDetail(m.sessionDetail));
  } else {
    if (m.focus) parts.push(renderFocus(m.focus));
    if (m.wellbeing) parts.push(`${h2("Wellbeing patterns")}${renderWellbeing(m.wellbeing)}`);
    if (m.overload) parts.push(renderOverload(m.overload));
    if (m.insights) parts.push(renderInsights(m.insights));
    if (m.studyTime) parts.push(renderStudyTime(m.studyTime));
    if (m.conditions) parts.push(renderConditions(m.conditions));
    if (m.checkin) parts.push(renderCheckin(m.checkin));
    if (m.academic) parts.push(renderAcademic(m.academic));
    if (m.sessions) parts.push(renderSessionTable(m.sessions));
  }

  parts.push(transparency());

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>${escapeHtml(title)} — ${escapeHtml(m.meta.user)}</title><style>${STYLE}</style></head><body>${parts.join("\n")}</body></html>`;
}
