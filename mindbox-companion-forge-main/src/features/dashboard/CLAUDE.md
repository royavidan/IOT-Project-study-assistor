# Feature: dashboard

The mobile-first **"Today"** home (`/`, `src/routes/index.tsx`). It is **state-aware** — it never shows a
wall of zeros. A personalized greeting + date lead; then quick actions + the academic day; then it branches
on **engagement**.

- **Engagement:** `engaged = isEngaged({ hasDevice, hasSessions })` — true once a MindBox is paired
  (`useMyDevice`) **or** any session exists (`useSessions`). Engaged → show the device/session block (Focus
  hero, Sessions/Streak stats, device-active card, Recent sessions, Insights teaser). Not engaged → show the
  **`GettingStartedCard`** checklist instead (no empty `0/180`, no `Idle` badge). `StateBadge` only renders
  when a device is paired; the Wi-Fi stat was dropped (lives on `/device`).
- `today.ts` — **pure**, unit-tested in `lib/__tests__/today.test.ts`. Academic aggregation
  (`todaysOccurrences`, `dueSoon`, `nextExam`, `pickNextAction`, `pickUrgentCourse`/`courseSnapshot`) **plus**
  first-run helpers: `greetingFor(name, now)` (time-of-day greeting), `onboardingSteps({hasCourses,hasSchedule,
hasDevice,hasSessions})` → 4-step checklist with per-step `done`, `completedStepCount`, and `isEngaged`.
- `components/` — `TodayPlanCard` (today's classes + due homework + next-exam chip; only shown when the user
  has any schedule/homework), `NextActionBar` (the one dominant CTA — homework/exam always; the "start a
  session" fallback only for engaged, not-mid-session users), `CourseSnapshotCard` (cross-course progress +
  most-urgent course), `QuickActions` (4 thumb-friendly shortcuts; the 4th = Connect or Log session by
  `hasDevice`), `GettingStartedCard` (the checklist), `DashboardSkeleton` (card placeholders while the
  shape-deciding queries load — replaces the full-screen spinner).

Reuses existing queries only — `useScheduleEvents`, `useHomeworkAssignments`, `useCourses`, `useSettings`
(name + semester bounds), `useMyDevice`, `useSessions`, `useTodayStats` — and `buildCourseSummaries`
(`@/features/courses`). **No new tables/queries/migrations.** Color/label helpers from
`@/features/schedule/schedule`; `BATTERY_TRACKING_ENABLED` still gates the battery stat.
