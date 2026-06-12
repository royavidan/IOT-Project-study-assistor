# Feature: insights

Study analytics + recommendations.
- `insights.ts` — env↔focus correlations, ideal conditions, recommendation builders.
  `external-load.ts` — external-load query.
- `components/{InsightsCharts,ExternalLoadCard,WellbeingPanel}`.

Consumed by `/insights` and the dashboard (`routes/index.tsx`).
Shared used: `@/lib/queries/sessions`, `@/lib/{streak,wellbeing,session-scope}`.
