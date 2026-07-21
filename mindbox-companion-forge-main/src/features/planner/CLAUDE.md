# Feature: planner

Auto-scheduled, burnout-aware **study blocks**. Reads the user's real schedule and proposes
`category='study'` calendar events that fill free time, ramp up _before_ deadlines (anti-cramming),
and stay under a daily/weekly cap. Gated by `STUDY_PLANNER_ENABLED` (`lib/feature-flags.ts`).
**Routeless** — `GenerateScheduleSheet` is a `ResponsiveModal` opened by local `planOpen` state, so
entry points _embed_ the sheet: a **"Plan your week" CTA card on the dashboard** (`routes/index.tsx`,
after `TodayPlanCard`, gated on `hasAcademics`), plus `/calendar` (header button, a compact `lg:hidden`
mobile button, and the FAB). Generated blocks render slim on the calendar and can be hidden/**cleared**
there (see `features/schedule` — `planGenerated`, `hideStudy`, `replaceGenerated`).

**Two engines share the same inputs + commit path**: deterministic `planStudyBlocks` ("Standard") and
the Gemini-backed **"Smart (AI)"** engine (`LLM_PLANNER_ENABLED` flag, needs `GEMINI_API_KEY`, migration
`0020`). LLM path, all server-side: `llm-plan.functions.ts` (`generateLlmPlan`) → `plan-input.server.ts`
(`loadPlanContext` re-assembles PlanInput server-side, shifted to the user's tz) → `llm/run-plan.server.ts`
(pipeline; falls back to `planStudyBlocks` on ANY model failure) → `llm/prompt.ts` (deterministic prompt;
free slots PRE-computed — the model never does interval math) → `llm/gemini.server.ts`
(`generateStructured`: responseSchema + Zod re-validation + one corrective retry; reused by the check-in
replan and the load review) → `llm/postprocess.ts` (`sanitizeLlmBlocks` clips/rejects blocks against slots
recomputed from DB truth — **the LLM never writes to the DB**). `llm/schema.ts` colocates the Gemini
responseSchema with its Zod mirror (drift-guard test). `fingerprint.ts` + `usePlanMeta`/`useSavePlanMeta`
(queries.ts, meta stamped at COMMIT) power `components/PlanStaleBanner` ("schedule changed — regenerate",
on dashboard + `/calendar`). Assumptions/thresholds: `docs/ASSUMPTIONS.md`. Tests:
`llm-plan-{schema,prompt,postprocess}.test.ts`, `plan-fingerprint.test.ts`.

- `planner.ts` — **pure, unit-tested** domain (no React/Supabase; takes `now` in — style of
  `today.ts`/`wellbeing.ts`). Tests in `lib/__tests__/planner.test.ts`.
  - `MODE_CONFIGS` / `PLAN_MODES` — the three rhythm strategies (`balanced` 50/10 default,
    `deep_focus` 90/20 ≤2 blocks/day, `sprint` 25/5) + `BURNOUT` guardrails (strained throttle 0.75,
    weekly cap = daily×5).
  - `busyIntervalsForDay` + `freeSlotsForDay` — invert classes/exams/hand-made study/past sessions
    into free gaps within the working window, minus quiet hours (`quietIntervalsWithin` handles
    overnight) and minus `SlotOpts.meals` (both engines pass `MEAL_BREAKS` — lunch 12:30–13:30,
    dinner 18:30–19:30 — so study never runs over meals). **Not** built on `buildDayAgenda` (that
    drops bad-time events silently).
  - `examReviewOffsets(daysUntilExam)` — SM-2-style spacing (14/7/3/1, compressed <7d, extended >21d).
  - `lectureBacklogFor(course, events, now, semStart, semEnd)` — a course's _(class meetings occurred up
    to today)_ − _(watched count)_; drives **lecture-review catch-up** tasks (gated by
    `input.includeLectureReview`). Derives "occurred so far" via `expandScheduleEvents(...→today)` since
    no stored count exists; 8-week lookback fallback without a semester term.
  - `planStudyBlocks(input)` → `PlanDraft` (blocks + weekLoad + warnings). Three task sources —
    **homework**, **exam review**, **lecture-review** (catch-up on unwatched meetings, before the next
    exam). Scores tasks
    (`importance×0.6 + urgency×0.4`), front-loads effort across eligible days, places mode-sized blocks
    into slots honoring daily/weekly caps + `maxBlocksPerDay`, prefers the circadian best-window for
    hard tasks, and throttles when `recovery.ready && status==='strained'`. For interleave modes it
    rotates a day's blocks across its free chunks (morning/afternoon/evening around meals) instead of
    piling them into the earliest one. Deterministic. Generated blocks are always `kind:'once'`.
- `queries.ts` — `usePlanInputs()` composes existing hooks (schedule/sessions/homework/**courses**/
  settings/external-load + `computeWellbeing`) into a `build(mode, horizonDays, includeLectureReview)`
  factory; `useCommitPlan()`
  maps the approved draft to study-block inputs and calls schedule's `replaceGenerated` (delete
  prior `plan_generated` study blocks in range, then insert — hand-made study blocks untouched).
- `components/{ModeCard,GenerateScheduleSheet,PlanPreview}` — pick a mode + horizon + an "Include
  lecture review" toggle → preview → approve. Nothing is written until approval (`ResponsiveModal`).
  `PlanPreview` chips: "Review" (exam) / "Catch-up" (lecture).

Data model (migration `0018_study_planner.sql`): `user_settings.{study_plan_mode,plan_day_start,
plan_day_end,plan_daily_cap_min}`, `homework_assignments.estimated_minutes`,
`schedule_events.plan_generated`. Settings round-trip via `lib/queries/settings.ts`; the planner card
is on `/settings`. Homework effort override is on `HomeworkDialog`.

Shared used: `@/features/schedule` (`expandScheduleEvents`, `parseTimeToMinutes`, `STUDY_COLOR`,
`useScheduleEvents/Actions`, `friendlyDateLabel`), `@/lib/queries/{homework,sessions,settings}`,
`@/features/insights/external-load`, `@/lib/wellbeing`, `@/lib/dates`.
