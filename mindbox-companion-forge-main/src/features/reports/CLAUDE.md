# Feature: reports

Export + PDF/email report pipeline (`/exports`).

- `export.ts`, `print-report.ts` — assemble report data.
- `build-report-pdf.server.ts`, `deliver-report.server.ts` — render + send.
- `report-email.functions.ts` — server-fn entry point.

Shared used: `@/lib/email/send-html.server.ts` (transport), `@/lib/wellbeing`.
