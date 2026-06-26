import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { ErrorState, LoadingState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-context";
import { useHomeworkAssignments, useHomeworkActions } from "@/lib/queries/homework";
import type { HomeworkAssignment } from "@/lib/types";
import type { HomeworkInput, HomeworkUpdateInput } from "@/lib/queries/homework";
import { HomeworkDialog } from "@/features/homework/components/HomeworkDialog";
import { HomeworkCard } from "@/features/homework/components/HomeworkCard";

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
  const { add, update, remove } = useHomeworkActions();

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
        description={
          homeworkQuery.error instanceof Error
            ? homeworkQuery.error.message
            : undefined
        }
        onRetry={() => void homeworkQuery.refetch()}
      />
    );
  }

  const assignments = homeworkQuery.data ?? [];

  // Sort by due date
  const sortedAssignments = [...assignments].sort(
    (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
  );

  // Group by status
  const pending = sortedAssignments.filter((a) => a.status === "pending");
  const submitted = sortedAssignments.filter((a) => a.status === "submitted");
  const graded = sortedAssignments.filter((a) => a.status === "graded");

  return (
    <>
      <PageHeader
        title="Assignments"
        description="Upload, track, and manage your homework assignments."
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add assignment
          </Button>
        }
      />

      <div className="space-y-8">
        {pending.length > 0 && (
          <section>
            <h2 className="mb-4 text-lg font-semibold text-foreground">Pending ({pending.length})</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pending.map((hw) => (
                <HomeworkCard
                  key={hw.id}
                  homework={hw}
                  onEdit={openEdit}
                  onDelete={(id) => remove.mutate(id)}
                  isDeleting={remove.isPending}
                />
              ))}
            </div>
          </section>
        )}

        {submitted.length > 0 && (
          <section>
            <h2 className="mb-4 text-lg font-semibold text-foreground">Submitted ({submitted.length})</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {submitted.map((hw) => (
                <HomeworkCard
                  key={hw.id}
                  homework={hw}
                  onEdit={openEdit}
                  onDelete={(id) => remove.mutate(id)}
                  isDeleting={remove.isPending}
                />
              ))}
            </div>
          </section>
        )}

        {graded.length > 0 && (
          <section>
            <h2 className="mb-4 text-lg font-semibold text-foreground">Graded ({graded.length})</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {graded.map((hw) => (
                <HomeworkCard
                  key={hw.id}
                  homework={hw}
                  onEdit={openEdit}
                  onDelete={(id) => remove.mutate(id)}
                  isDeleting={remove.isPending}
                />
              ))}
            </div>
          </section>
        )}

        {assignments.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-muted-foreground">
              No assignments yet. Create one to get started!
            </p>
          </div>
        )}
      </div>

      <HomeworkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSubmit={onSubmit}
        busy={add.isPending || update.isPending}
        error={formError}
      />
    </>
  );
}
