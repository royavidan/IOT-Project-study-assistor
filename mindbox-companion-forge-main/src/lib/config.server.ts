import process from "node:process";

// Server-only config. The .server.ts suffix prevents Vite from bundling
// this file into the client — values here never reach the browser.
//
// On Cloudflare Workers, env binds at REQUEST time. Module-scope reads
// (e.g. `const x = process.env.X`) resolve to undefined — always read
// process.env INSIDE a function or handler.
//
// When to use which env-access pattern:
//   - .server.ts module (this file): server-only helpers reused across
//     handlers. Wrap reads in a function so they run per-request.
//   - inline process.env inside a createServerFn handler: one-off reads
//     not reused elsewhere.
//   - import.meta.env.VITE_FOO: PUBLIC config readable from both client
//     and server (analytics IDs, public URLs). Define in .env with the
//     VITE_ prefix. Never put secrets here — they ship to the browser.

export function getServerConfig() {
  return {
    nodeEnv: process.env.NODE_ENV,
    // Supabase. Falls back to the VITE_-prefixed values so the server still
    // works if only the public vars are set. The service-role key bypasses
    // Row-Level Security and must NEVER reach the browser — keep it without a
    // VITE_ prefix and only read it here (server-only).
    supabaseUrl: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    appBaseUrl: process.env.APP_BASE_URL ?? process.env.VITE_APP_BASE_URL,
    // Shared secret the device/simulator sends as the `x-device-secret` header
    // when POSTing to the ingestion endpoints. Server-only.
    deviceIngestSecret: process.env.DEVICE_INGEST_SECRET,
    // Gemini Developer API key for the LLM planner / check-in / load-review
    // features. Server-only (never VITE_-prefixed).
    geminiApiKey: process.env.GEMINI_API_KEY,
    // Shared secret an external scheduler sends as `x-jobs-secret` to trigger
    // `/jobs/*` routes (e.g. the daily load review). Server-only.
    jobsSecret: process.env.JOBS_SECRET,
    // Report pipeline. Self-contained today: the PDF renders via headless Chrome
    // (Puppeteer) with inline SVG charts, the AI executive summary uses the same
    // server-side `generate` Edge Function, and email uses SMTP/Resend — NO
    // dedicated report API key is required. This block is the clean seam for
    // future toggles/keys: set `REPORT_AI_SUMMARY=off` to skip the LLM summary;
    // `REPORT_SERVICE_KEY` is reserved for an optional external PDF/chart service.
    report: {
      aiSummary: process.env.REPORT_AI_SUMMARY !== "off",
      serviceKey: process.env.REPORT_SERVICE_KEY,
    },
  };
}
