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
  };
}
