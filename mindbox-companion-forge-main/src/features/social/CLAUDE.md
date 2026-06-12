# Feature: social

Friends, leaderboard, reviewers.
- queries: `friends.ts`, `leaderboard.ts`, `reviewer.ts`.
- server fns: `friends.functions.ts`, `reviewer.functions.ts`.
- emails: `friend-notify.server.ts`, `reviewer-invite.server.ts`.

Routes: `/friends`, `/leaderboard`, `/reviewers`, `/reviewer/accept`.
Shared used: `@/lib/email/send-html.server.ts`, `@/components/StudentScopePicker`.
