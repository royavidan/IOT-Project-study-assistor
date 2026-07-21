import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

// Insights moved into the Progress hub. Keep this route as a redirect so
// existing/bookmarked links (and deep links with from/to) still work.
export const Route = createFileRoute("/insights")({
  validateSearch: z.object({
    student: z.string().uuid().optional(),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/progress", search: { ...search, tab: "insights" } });
  },
});
