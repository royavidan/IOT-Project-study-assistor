import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteSession } from "@/lib/api/sessions.functions";

interface DeleteSessionDialogProps {
  sessionId: string;
  /** Button style: full label on detail page, icon-only in lists. */
  variant?: "button" | "icon";
  /** Where to navigate after delete (defaults to /history). Pass null to stay put. */
  redirectTo?: string | null;
  onDeleted?: () => void;
}

export function DeleteSessionDialog({
  sessionId,
  variant = "button",
  redirectTo = "/history",
  onDeleted,
}: DeleteSessionDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => deleteSession({ data: { sessionId } }),
    onSuccess: () => {
      setOpen(false);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      void queryClient.invalidateQueries({ queryKey: ["session-detail", sessionId] });
      void queryClient.invalidateQueries({ queryKey: ["daily-aggregates"] });
      void queryClient.invalidateQueries({ queryKey: ["focus-streak"] });
      void queryClient.invalidateQueries({ queryKey: ["today-stats"] });
      onDeleted?.();
      if (redirectTo !== null) void navigate({ to: redirectTo ?? "/history" });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Could not delete session.");
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        {variant === "icon" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-danger"
            aria-label="Delete session"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="button" variant="destructive" size="sm">
            <Trash2 className="h-4 w-4" />
            Delete session
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this session?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the session and its focus-load and environment samples from your history.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            {mutation.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
