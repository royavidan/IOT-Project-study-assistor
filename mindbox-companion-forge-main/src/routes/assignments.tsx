import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { ErrorState, LoadingState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/lib/auth/auth-context";
import { useHomeworkAssignments, useHomeworkActions } from "@/lib/queries/homework";
import { useCourses } from "@/features/courses/queries";
import { homeworkCompletion } from "@/features/courses/courses";
import type { HomeworkAssignment, HomeworkStatus } from "@/lib/types";
import type { HomeworkInput, HomeworkUpdateInput } from "@/lib/queries/homework";
import { HomeworkDialog } from "@/features/homework/components/HomeworkDialog";
import { HomeworkBoard } from "@/features/homework/components/HomeworkBoard";

export const Route = createFileRoute("/assignments")({
  head: () => ({ meta: [{ title: "Assignments — MindBox" }] }),
  component: AssignmentsPage,
});

function AssignmentsPage() {
  const { user } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<HomeworkAssignment | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const homeworkQuery = useHomeworkAssignments();
  const coursesQuery = useCourses();
  const { add, update, remove, setStatus } = useHomeworkActions();

  const openCreate = () => {
    setEditing(null);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (homework: HomeworkAssignment) => {
    setEditing(homework);
    setFormError(null);
    setDialogOpen(true);
  };

  const onSubmit = (input: HomeworkInput | HomeworkUpdateInput, file?: File) => {
    setFormError(null);
    const handlers = {
      onSuccess: () => {
        setDialogOpen(false);
        setEditing(null);
      },
      onError: (e: Error) => setFormError(e.message),
    };

    if (editing) {
      update.mutate({ id: editing.id, input: input as HomeworkUpdateInput, file }, handlers);
    } else {
      add.mutate({ input: input as HomeworkInput, file }, handlers);
    }
  };

  if (homeworkQuery.isLoading) {
    return <LoadingState label="Loading your assignments…" />;
  }

  if (homeworkQuery.isError) {
    return (
      <ErrorState
        title="Could not load assignments"
        description={homeworkQuery.error instanceof Error ? homeworkQuery.error.message : undefined}
        onRetry={() => void homeworkQuery.refetch()}
      />
    );
  }

  const assignments = homeworkQuery.data ?? [];
  const completion = homeworkCompletion(assignments);

  return (
    <>
      <PageHeader
        title="Assignments"
        description="Track homework on a board — tap to move work along as you finish it."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add assignment
          </Button>
        }
      />

      {assignments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-muted-foreground">No assignments yet. Create one to get started!</p>
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div>
                <p className="text-sm text-muted-foreground">Overall progress</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">
                  {completion}%{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    of your homework done
                  </span>
                </p>
              </div>
              <div className="min-w-[180px] flex-1">
                <Progress value={completion} aria-label={`Overall homework ${completion}%`} />
              </div>
            </CardContent>
          </Card>

          <HomeworkBoard
            assignments={assignments}
            onMove={(id, status: HomeworkStatus) => setStatus.mutate({ id, status })}
            onEdit={openEdit}
            onDelete={(id) => remove.mutate(id)}
          />
        </div>
      )}

      <HomeworkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        courses={coursesQuery.data ?? []}
        onSubmit={onSubmit}
        busy={add.isPending || update.isPending}
        error={formError}
      />
    </>
  );
}
