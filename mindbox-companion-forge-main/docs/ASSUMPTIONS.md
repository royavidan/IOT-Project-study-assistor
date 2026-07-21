# MindBox AI features — stated assumptions & design decisions

The TA asked for every assumption behind the LLM features to be written down.
This is that list. It covers the **Smart (AI) study planner**, the
**post-session check-in auto-replan**, the **scheduled load review**, and the
**device agenda/sound slice**.

## Provider & integration

1. **LLM = Gemini `gemini-2.5-flash`** via the official `@google/genai` JS SDK,
   authenticated with a Gemini Developer API key (`GEMINI_API_KEY`, free tier).
   Vertex-AI-via-ADC (as used in the team's other project) was **rejected for
   this app**: ADC only exists on a developer's machine and cannot run on the
   deployed Cloudflare target. The SDK is fetch-based, so it runs on Workers.
2. **Structured output end to end**: every call sets
   `responseMimeType: "application/json"` + a `responseSchema`, and the
   response is **re-validated with Zod** on our side. On validation failure the
   model gets exactly **one corrective retry** (it sees its own output + the
   error); a second failure falls back to a non-LLM path. The two schemas are
   colocated in one module per feature with a drift-guard unit test.
3. **The LLM never writes to the database.** Plan drafts go through the same
   commit path as the heuristic planner (`replaceGenerated`, which only touches
   `plan_generated=true` study blocks); the load review only produces email
   text. Every write is a validated app write.

## Planner (Feature 1)

4. **Calendar truth** = `schedule_events` + logged `sessions`. Commitments not
   in the app are invisible to the planner — free slots derive only from these
   plus quiet hours, **default meal windows** (lunch 12:30–13:30, dinner
   18:30–19:30, `MEAL_BREAKS` in `planner.ts`), and the working window in
   Settings. Both engines subtract the same meals, so study never runs over
   lunch or dinner.
5. **Free slots are computed by our deterministic code and _given_ to the
   model** — the model never does interval math. Its proposed blocks are then
   clipped/rejected against slots **recomputed from DB truth**: unknown task
   refs, inverted times, deadline violations, over-cap days and overlaps are
   dropped (and shown in the preview as "N proposals didn't fit").
6. Missing homework `estimated_minutes` defaults to a weight-based heuristic
   (60/120/180 min); `progress_pct = null` means status-derived completion
   (pending → 0%, otherwise 100%). Same rules as the heuristic engine.
7. **Timezone** = `profiles.tz_offset_min` (kept fresh by the dashboard). No
   DST transitions beyond the stored offset; server-side planning shifts all
   dates into the user's zone before any date math.
8. **Stale plans are detected, not silently fixed**: a fingerprint of schedule +
   homework is stamped at commit; when live data hashes differently, a banner
   offers "Regenerate". Auto-replan happens **only** from a check-in.
9. Model failures (bad output twice, network, missing key) degrade to the
   deterministic heuristic engine — a plan is always produced, labeled as such.
10. **Humane pacing is guaranteed, not just requested.** The AI prompt asks for
    breaks, meals, spread-across-the-day, energy-matching and interleaving, but
    the guarantees are enforced deterministically regardless of model output:
    meals are removed from the slots (item 4); the sanitizer reserves a
    `breakMin` gap around every accepted block so blocks are never back-to-back;
    and the heuristic engine rotates a day's blocks across its free chunks
    (morning/afternoon/evening) instead of piling them into the earliest one.

## Check-in (Feature 3)

10. Check-in is offered for the latest completed session for up to **6 hours**
    after it ends, once per session (`checkin_at` is the answered marker).
11. **Explicit auto-replan thresholds** (our rules, not the model's): homework
    progress moved ≥ **25 points**, an assignment reached **100%**, or
    tiredness ≥ **4/5**. When they fire, the fresh AI draft is committed
    automatically and the card reports what changed.

## Load review (Feature 4)

12. **Purpose statement**: collect data → **our deterministic rules** decide
    ok/warning/danger → the AI writes only the personalized narrative → contact
    the user by email. The AI never decides what counts as dangerous.
13. **Danger definition** (`src/features/insights/overload.ts`):
    | # | Rule | Threshold |
    |---|---|---|
    | 1 | Recovery balance strained | existing wellbeing score < 45 |
    | 2 | Self-reported tiredness | mean of last ≤3 check-ins ≥ 4/5 |
    | 3 | Over-planned week | planned study next 7d > 1.25 × weekly cap |
    | 4 | No rest | ≥ 6 consecutive active days |
    | 5 | Exam crunch | exam ≤ 72h away AND > 6h homework backlog |

    `danger` = rule 1 **plus** any other rule; `warning` = any single rule.

14. Contact is throttled to **once per 72h**, requires `notifications_enabled`,
    and is skipped during the user's quiet hours (the demo button bypasses
    throttle/quiet on purpose). If the model fails, a **plain templated email**
    with the raw metrics is sent instead — contact never depends on the LLM.
15. **Scheduler**: the stack has no built-in cron, so a GitHub Actions workflow
    (`.github/workflows/load-review.yml`) curls `POST /jobs/load-review` daily
    with the `x-jobs-secret` header (same shared-secret pattern as `/ingest/*`).
    Alternatives: cron-job.org, or Supabase `pg_cron` + `http`.
16. This is a **behavioral pattern estimate, never a clinical/diagnostic
    claim** — same framing invariant as the rest of the wellbeing code, and the
    email says so.

## Focus Model — calibrated focus/energy estimate (`lib/focus/*`, `insights/focus-model.*`)

16a. **Personalized, not global.** Every session feature is centered/scaled
     against the USER'S OWN robust baseline (median/MAD), with empirical-Bayes
     shrinkage toward a population prior when data is thin (`baselines.ts`,
     `PRIOR_STRENGTH = 5`). A night owl is no longer judged by a global 22:00
     rule. The richest signal — the per-minute `focus_load_samples` /
     `env_samples` — is mined for within-session dynamics (load slope, volatility,
     sustained-high share, noise→load coupling; `session-dynamics.ts`).
16b. **Calibrated against ground truth.** The model (`model.ts`) predicts the
     student's own `tiredness` check-in (1–5) from those features via **ridge
     regression whose prior mean is the existing heuristic's coefficients**
     (partial pooling: sparse labels → heuristic, many labels → the user's own
     data; no per-user weight to tune). **Leave-one-out CV** produces an HONEST
     validated accuracy (MAE + R²) that is surfaced — never a made-up confidence.
     Below `MIN_PERSONAL_LABELS = 6` it returns the pure heuristic prior; below
     `MIN_CV_LABELS = 8` it withholds a validated number and says "still learning".
16c. **Lead with honesty.** The `FocusStateCard` shows the estimate with a
     confidence band, a "how reliable" line (validated ± / R² / basis / check-in
     count), the drivers, and a trend. The AI (`focus-review.server.ts`) writes
     ONLY a behavioral narrative from the derived estimate — same
     deterministic-numbers / AI-narrates-only / templated-fallback contract as the
     load review (items 12–16); it never invents a number or a diagnosis.
16d. **Additive & non-circular.** It does NOT modify `computeWellbeing` /
     `recovery.status`, so the planner throttle, load-review Rule 1, and reports
     are untouched. The model's TARGET is the independent tiredness label, never
     the FLE-derived `focusScore` (avoids the circularity the old correlations had).
16e. **Same framing invariant** — a behavioral focus/energy pattern estimate with
     honest uncertainty, **never** a clinical/cognitive-health measure.

## Device slice (ESP32-S3)

17. The box learns its schedule from `GET /ingest/config` (60s poll → up to
    ~60s staleness). Today = `agendaStr` (≤ 12 items; drives the Today screen
    AND auto-start); the box's week paging reads `weekStr` (days +1..+6,
    ≤ 36 items, ≤ 10/day, view-only). Titles truncated to 23 UTF-8 bytes;
    flat `…|…;…` strings because the firmware parses flat JSON with no array
    support.
18. **Auto-start is device-side and clock-driven** (NTP + `tzOffsetMin` from
    the downlink): when a _study_ block's start minute arrives, the box chimes,
    shows a 10s "tap to cancel" splash, then starts a session sized to the
    block. Each block triggers at most once per day (cancel included). During
    quiet hours the chime is muted but the session still starts — a scheduled
    block is the user's own plan.
19. **While paired, the website owns the sound settings** (enabled / volume /
    per-chime mask): the box re-applies them on every poll, overwriting local
    changes.
20. Single shared `DEVICE_INGEST_SECRET` for all boxes — a known limitation
    accepted for the course project.

## Site↔device communication features (migrations 0024/0025)

21. **Remote interface control.** The site only ever sends a theme **preset id**
    (0–4); the firmware owns the actual RGB565 values and derives dim/track
    variants (`theme-presets.ts` ↔ firmware `Theme.cpp`, synced BY ID).
    Pomodoro timing uses **adopt-on-revision**: saving the settings card stamps
    `device_timing_updated_at` only when focus/break changed; the box adopts the
    values exactly once per revision, so on-box spinner edits are never stomped
    by the 60s poll (last writer wins). Screen **brightness stays device-local**
    — the light-sensor auto-brightness loop and the on-box slider already own
    the backlight.
22. **Remote commands ride the poll, not a push channel.** One command per
    config response; the box acks via `&ack=<id>` on its next GET (and re-polls
    immediately, so bursts drain at ~1/s). An un-acked command is re-served
    after 75 s (deduped on-box by last-seen id) and expires after **10 min**
    undelivered. Ack means "accepted into the device queue", not "executed" —
    a crash in between can lose (or rarely repeat) one command; accepted for a
    POC and bounded by the expiry. Worst-case latency ≈ one 60 s poll, and the
    UI says so. "Ring my device" deliberately **bypasses** mute/quiet-hours/DND.
23. **Online status is derived, not reported**: `device_status.updated_at`
    older than **90 s** (3 × the 30 s telemetry heartbeat) = offline. Room
    readings (temp/humidity/light/noise) are optional telemetry fields — old
    firmware keeps validating, missing sensors render as "—".
24. **Exam/DND rule (ours, deterministic)**: effective =
    `manual switch OR an exam occurs today` (owner-local). Auto wins — the
    switch can extend DND but cannot disable it on an exam day. DND mutes all
    chimes except find-my ring and suppresses coaching nudges; it never dims
    the screen (that's quiet hours' job).
25. **Homework from the device** updates only assignments the server just
    listed for that box's owner (top-3 pending by due date), re-verifying
    ownership server-side. 100% maps `pending → submitted`; graded/submitted
    rows are never downgraded. Streak on the box is computed server-side over a
    **45-day window** (longer streaks report 45 — accepted).

## Known limitations

- Gemini free-tier rate limits are accepted for a student POC; the heuristic
  fallback covers outages.
- `last_plan_*` metadata lives on `user_settings` (one row per user), so only
  the most recent committed plan is tracked.
- Migrations `0020`–`0023` must be run by hand in the Supabase SQL editor
  (in order) before these features work; restart the dev server after adding
  `GEMINI_API_KEY` / `JOBS_SECRET` to `.env`.
- Migrations `0024`–`0025` add the remote-command queue and device
  prefs/status columns for the site↔device features (no new env vars).
