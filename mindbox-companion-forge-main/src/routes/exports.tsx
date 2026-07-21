import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

// Exports moved into the Progress hub. Keep this route as a redirect so
// existing/bookmarked links (and the reviewer student param) still work.
export const Route = createFileRoute("/exports")({
  validateSearch: z.object({
    student: z.string().uuid().optional(),
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/progress", search: { ...search, tab: "export" } });
  },
});
