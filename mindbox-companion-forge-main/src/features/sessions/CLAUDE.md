# Feature: sessions

Single-session detail view + deletion. (The app-wide session **list** query stays shared at
`@/lib/queries/sessions` — it's used by the shell and most routes.)

- `session-detail.ts` — one session's full data + `useSessionTagActions` (patch `mode` / `companions`).
  `components/DeleteSessionDialog`; `components/SessionTagCard` — tag a session's **activity** (mode, incl.
  "Homework") + **who you studied with** (`solo`/`with_others`) and show its drain multiplier. These feed the
  activity-weighted "study strain" in `@/lib/study-strain` (nudges the Focus Battery, not grades). Read-only
  for reviewers.
- **Post-session check-in** (migration `0021`: `sessions.{tiredness,checkin_at,checkin_note}`):
  `checkin.ts` — pure, unit-tested (`findPendingCheckin` 6h window; `shouldReplan` explicit thresholds:
  progress Δ≥25pts / task hit 100% / tiredness≥4). `checkin.functions.ts` — `submitSessionCheckin` server fn
  writes the report + `homework_assignments.progress_pct`, and when thresholds fire reruns the LLM plan
  pipeline (`features/planner/llm/run-plan.server`) and returns a fresh draft. `components/SessionCheckinCard`
  (on the dashboard) **auto-commits** that draft via `useCommitPlan()` — the "model output updates data" POC.
  Thresholds are documented in `docs/ASSUMPTIONS.md`.

Routes: `/session/$id`, `/history`.
