# Feature: sessions

Single-session detail view + deletion. (The app-wide session **list** query stays shared at
`@/lib/queries/sessions` — it's used by the shell and most routes.)
- `session-detail.ts` — one session's full data. `components/DeleteSessionDialog`.

Routes: `/session/$id`, `/history`.
