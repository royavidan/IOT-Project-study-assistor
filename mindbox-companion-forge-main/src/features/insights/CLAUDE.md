# Feature: insights

Study analytics. **Framing invariant:** `Session.focusScore` IS the device's Focus **Load** Estimate
(higher = more strain), never a "goodness" score — so nothing ranks "best" by it. "Best time" and
heatmap intensity are driven by focus **minutes**; environment quality comes from fixed research
thresholds, not from load. Higher load is shown neutral/amber ("Load N"), never a green success badge.

- `insights.ts` — pure aggregation: `computeSessionInsights` (timeOfDay, `bestTimeSlot` **by minutes**,
  mode/status breakdowns), `computeHourlyHeatmap` (intensity **by minutes**), `computeDashboardInsightTeaser`.
  The old load-vs-noise correlations + circular "ideal conditions" + noise scatter were **retired**.
- `@/lib/env-quality.ts` — Study-conditions scoring from FIXED bands (temp ~20.5–23.5 °C, noise ≤0.35
  of the 0–1 mic scale, light 300–500 lux): `rateFactor`, `computeStudyConditions`, `conditionsFromSessions`,
  `factorTip`. `@/lib/study-time.ts` — diminishing-returns model: `efficiencyAt`/`effectiveMinutes`
  (full to ~45 min, taper to 0.5 at ~90), `bestSessionLength`, `summarizeStudyTime`. Both unit-tested.
- `@/lib/study-strain.ts` — **activity-weighted drain**: `sessionIntensity`/`strainMinutes` weight a session
  by `mode` (Homework 1.25 / Deep Focus 1.2 / Study 1.0 / Review 1.0 / Reading 0.85) × difficulty-aware
  group factor (hard task + `companions:"with_others"` → 0.85, light task → 1.1), clamped 0.5–1.5. Grounded in
  CLT / ICAP / collective-working-memory. `computeRecoveryBalance` (`wellbeing.ts`) uses **strain minutes** in
  its load-spike term only (rest/late-night stay on raw timing). `schedule-load.ts` `externalLoadFromSchedule`
  bridges the **real timetable** → passive external load (attended lectures/tutorials/labs × `LECTURE_PASSIVE_FACTOR`
  0.6) so classes drain the battery without manual re-entry; `InsightsView` merges it with the manual
  `external_loads` and shows a strain-hours note on `FocusBatteryCard`. Session tagging (activity + solo/with-others)
  lives on the session-detail page (`features/sessions/SessionTagCard`); DB: `sessions.companions` (migration 0019).
- `components/` — `FocusBatteryCard` (the wellbeing **recovery** score as a 0–100 energy tank +
  circadian/consistency contributors; replaces the old `WellbeingPanel`), `StudyConditionsCard` +
  `BandBar` (per-factor gauge with the ideal range shaded + a tip), `StudyTimeEffectCard`
  (effective vs raw minutes + best session length), `InsightsCharts` (weekly trend, when-you-study,
  hourly heatmap — all now labeled + legended), `InsightsView` (composes the above), `ExternalLoadCard`.

- **Load review** (migration `0023`): `overload.ts` — pure, unit-tested "dangerous state" rules (OUR
  thresholds, never the AI's: recovery strained / tiredness≥4 / planned>1.25×weekly cap / ≥6 active days /
  exam≤72h + >6h homework backlog; `danger` = strained + any other). `load-review.server.ts` — the
  `POST /jobs/load-review` body (guarded by `x-jobs-secret`, triggered by the repo-root GitHub Actions cron
  `.github/workflows/load-review.yml`): per user → assess → Gemini writes ONLY the narrative
  (plain-template fallback) → `sendEmail` → stamp `user_settings.last_load_review{,_at}` (72h throttle,
  quiet-hours + notifications gates). `load-review.functions.ts` + `components/LoadReviewCard` = the
  "Run review now" demo button on InsightsView. Purpose + thresholds table: `docs/ASSUMPTIONS.md`.

- **Focus Model** (calibrated, personalized — `@/lib/focus/*` + `focus-model.server.ts` +
  `focus-model.functions.ts` + `components/FocusStateCard`): unlike the fixed-weight Focus Battery, this
  normalizes each session's features against the USER'S OWN robust baseline (shrinkage to a population
  prior when sparse — `baselines.ts`), mines the per-minute samples for within-session dynamics
  (`session-dynamics.ts`), and **calibrates against the `tiredness` check-ins** via ridge-with-heuristic-
  prior + leave-one-out validation (`model.ts`) — so it reports its OWN accuracy. `focus-state.ts` fuses
  it into a confidence-banded estimate; `focus-review.server.ts` adds an AI narrative (same
  deterministic-numbers/AI-narrates-only/fallback contract as the load review). Additive: does NOT touch
  `computeWellbeing`/`recovery.status`. Framing + thresholds: `docs/ASSUMPTIONS.md` items 16a–16e. Pure
  math is unit-tested in `lib/__tests__/{robust,session-dynamics,baselines,focus-trends,focus-model,focus-state}.test.ts`.

Consumed by `/progress?tab=insights` (via `InsightsView`) and the dashboard teaser (`routes/index.tsx`).
Shared used: `@/lib/queries/sessions`, `@/lib/{wellbeing,env-quality,study-time,session-scope,dates}`.
