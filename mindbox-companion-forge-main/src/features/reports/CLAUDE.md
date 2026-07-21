# Feature: reports

Comprehensive export + PDF/email report pipeline (`/progress?tab=export`, redirected from `/exports`).

## Architecture — one model, composable renderers, two scopes

- `report-model.ts` — **pure** backbone: a `ReportModel { scope: "weekly" | "session", ... optional blocks }`
  + one `(model) => html` **section renderer** per section + inline-**SVG chart** helpers (`svgBarChart`,
  `svgLineChart`, `svgHourHeatmap`, `svgGauge`). `buildReportHtml(model)` composes by scope. Self-contained
  HTML (inline styles + inline SVG) so both headless Chrome and the browser print path render it with **no
  library/API key**. Unit-tested (`lib/__tests__/report-model.test.ts`). Adding a new report scope/section =
  a new block + renderer here.
- `report-model.server.ts` — server assembly: `buildWeeklyReportModel` (reuses `loadPlanContext` +
  `computeFocusEstimate` + `computeWellbeing`/`assessOverload`/`computeSessionInsights`/`summarizeStudyTime`/
  `conditionsFromSessions`/`buildCourseSummaries` + a check-in-feedback roll-up incl. the free-text
  `checkin_note`) and `buildSessionReportModel` (session detail + `computeSessionDynamics` + that session's
  check-in). Maps aggregator outputs → report-local blocks.
- `report-narrative.server.ts` — the AI **executive summary** via `generateStructured` (→ `generate` Edge
  Function): deterministic numbers in, JSON narrative out, behavioral/non-clinical, **templated fallback**
  (same contract as load-review / focus-review). Gated by `getServerConfig().report.aiSummary`.
- `build-report-pdf.server.ts` — `buildReportPdf(model)`: **Puppeteer/headless-Chrome** renders the HTML (incl.
  charts) → PDF bytes; **pdfkit** text-only fallback (no charts) if Chrome is unavailable — still renders the
  narrative + stats + session log / session dynamics.
- `report.functions.ts` — `getReportHtml({from,to})` + `getSessionReportHtml({sessionId})` server fns that
  assemble the model and return the rich HTML for the **client print path** (one report for print + email).
- `deliver-report.server.ts` — `deliverReportByEmail` assembles the weekly model → PDF → emails owner + active
  reviewers; `report-email.functions.ts` = `emailReport` + `maybeSendWeeklySummaries` (weekly auto-share).
- `export.ts` — CSV/JSON (now incl. `tiredness`) + `summarize` + `ReportMeta`/`ReportSummary`.
- `components/ExportsView.tsx` — the Export tab (CSV/JSON/print/email). Per-session export lives on
  `/session/$id`.

## Config / keys
Self-contained: PDF via local Chrome + inline SVG, AI via the server-side Edge Function, email via SMTP/Resend
— **no dedicated report API key**. `getServerConfig().report` is the seam: `REPORT_AI_SUMMARY=off` skips the
LLM summary; `REPORT_SERVICE_KEY` is reserved for a future external service.

Framing: behavioral pattern estimates with honest uncertainty — never a clinical/diagnostic claim.
Shared: `@/lib/email/send-html.server.ts`, `@/features/planner/plan-input.server`, `@/features/insights/*`.
