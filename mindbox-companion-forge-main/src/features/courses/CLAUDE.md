# Feature: courses

Real course entity + per-course roll-up (`/courses`, `/courses/$id`).

- `courses.ts` — pure domain + aggregation: `buildCourseSummaries` rolls schedule events + homework
  into per-course `CourseSummary` (meeting counts by subtype, next exam, homework completion %,
  graded-homework average vs target, **`gradeBreakdown`**) + an `OverallSummary` (credit-weighted average).
  `plannedMeetingCounts(events, code, weeklyBounds)` = per-subtype semester occurrence totals (for "watched
  8/12"; falls back to weekly templates with no term). No React/Supabase.
- `grades.ts` — **weighted "points out of 100" grade scheme** (pure, unit-tested). `buildGradeBreakdown(homework,
exams)` → components (homework with `weight` + graded `grade`; exams with `examWeight`/`examScore`),
  `earnedPoints`/`assignedWeight`/`scoredWeight`. `contribution`/`componentContributionLabel` ("4 / 5"),
  `projectFinalWithExam(breakdown, examId, score)` for the focused what-if.
- `queries.ts` — `useCourses`, `useCourseActions` (add/update/remove + **upsert** by `(user_id, code)` +
  **`setWatched`** which writes only `watched_lectures/tutorials/labs` so the course dialog never clobbers them).
  `remove` takes `{ id, code }` and **also deletes the course's `schedule_events`** (matched by
  `course_code`, `ilike`) — deleting a course clears its classes/exams from the calendar; homework is kept.
- `components/{CourseCard,CourseDialog,CourseGradesTab,WatchedMeetingsCard}`. `CourseCard` has an optional
  `onDelete` (trash + `AlertDialog`, overlaid outside the nav `Link`) and shows next-exam-in-days + earned/100.
  `CourseGradesTab` = standing + per-component breakdown (inline exam weight/score via `useScheduleActions().setExamGrade`)
  - the exam projector; `WatchedMeetingsCard` = per-subtype watched steppers (Meetings tab). The `/courses/$id`
    Delete also confirms and navigates back to `/courses` on success.

Courses link to `schedule_events` and `homework_assignments` by the free-text **`course_code`** (the
join key — `matchesCode` is case-insensitive so old rows aren't orphaned). The detail route keys on the
course **UUID**. The homework kanban (`HomeworkBoard`) lives in `features/homework`, reused on the
course Homework tab. Courses created from an `.ics` import carry `ics_import_id` (migration `0015`,
`on delete cascade`) so deleting the import removes them too — see `features/schedule` ICS notes.

Shared used: `@/features/schedule/schedule` (`upcomingExams`, `daysUntil`, `countdownLabel`,
`COURSE_COLORS`), `@/lib/queries/homework`, `@/components/ui/*`.
