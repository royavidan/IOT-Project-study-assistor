import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { StudentScopePicker } from "@/components/StudentScopePicker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSessionScope } from "@/hooks/use-session-scope";
import { SessionsHistoryView } from "@/features/sessions/components/SessionsHistoryView";
import { InsightsView } from "@/features/insights/components/InsightsView";
import { ExportsView } from "@/features/reports/components/ExportsView";

const TABS = ["sessions", "insights", "export"] as const;
type ProgressTab = (typeof TABS)[number];

const searchSchema = z.object({
  tab: z.enum(TABS).optional(),
  student: z.string().uuid().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const Route = createFileRoute("/progress")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Progress — MindBox" }] }),
  component: ProgressPage,
});

function ProgressPage() {
  const navigate = useNavigate({ from: "/progress" });
  const { tab = "sessions", student, from, to } = Route.useSearch();
  const { students, viewingStudent, isReviewerView } = useSessionScope(student);

  const onStudentChange = (value: string) =>
    navigate({
      search: (prev) => ({ ...prev, student: value === "mine" ? undefined : value }),
      replace: true,
    });

  const onTab = (value: string) =>
    navigate({ search: (prev) => ({ ...prev, tab: value as ProgressTab }), replace: true });

  return (
    <>
      <PageHeader
        title={isReviewerView ? "Student progress" : "Progress"}
        description={
          isReviewerView
            ? `Reviewing ${viewingStudent?.displayName ?? "a student"} — sessions, insights, and exports.`
            : "Your sessions, insights, and exports in one place."
        }
      />

      <StudentScopePicker
        students={students}
        value={student ?? "mine"}
        onChange={onStudentChange}
        isReviewerView={isReviewerView}
        studentName={viewingStudent?.displayName}
      />

      {isReviewerView && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-info/30 bg-info/5 px-4 py-2.5 text-sm">
          <ShieldCheck className="h-4 w-4 shrink-0 text-info" aria-hidden />
          <span>
            Viewing{" "}
            <span className="font-medium">{viewingStudent?.displayName ?? "a student"}</span>&apos;s
            data — read-only, no edits or deletes.
          </span>
        </div>
      )}

      <Tabs value={tab} onValueChange={onTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>
        <TabsContent value="sessions">
          <SessionsHistoryView student={student} initialFrom={from} initialTo={to} />
        </TabsContent>
        <TabsContent value="insights">
          <InsightsView student={student} initialFrom={from} initialTo={to} />
        </TabsContent>
        <TabsContent value="export">
          <ExportsView student={student} />
        </TabsContent>
      </Tabs>
    </>
  );
}
