import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";

import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { acceptReviewerInvite } from "@/features/social/reviewer.functions";
import { useAuth } from "@/lib/auth/auth-context";

export const Route = createFileRoute("/reviewer/accept")({
  validateSearch: z.object({
    token: z.string().optional(),
  }),
  head: () => ({ meta: [{ title: "Accept Reviewer Invite — MindBox" }] }),
  component: AcceptReviewerInvitePage,
});

function AcceptReviewerInvitePage() {
  const { token } = Route.useSearch();
  const { user } = useAuth();

  const acceptMutation = useMutation({
    mutationFn: (inviteToken: string) => acceptReviewerInvite({ data: { token: inviteToken } }),
  });

  const handleAccept = () => {
    if (!token) return;
    acceptMutation.mutate(token);
  };

  return (
    <>
      <PageHeader
        title="Reviewer invite"
        description="Accept read-only access to view this student's focus reports."
      />

      <Card>
        <CardContent className="space-y-4 p-5">
          {!token ? (
            <p className="text-sm text-danger">
              This invite link is missing a token. Please ask for a fresh invite link.
            </p>
          ) : !user ? (
            <>
              <p className="text-sm text-muted-foreground">
                You need to sign in (with the invited email) to accept this invite.
              </p>
              <Button asChild>
                <Link to="/login" search={{ redirect: `/reviewer/accept?token=${token}` }}>
                  Sign in to continue
                </Link>
              </Button>
            </>
          ) : acceptMutation.isSuccess ? (
            <>
              <p className="text-sm text-success">
                Invite accepted. You now have read-only access to the shared reports.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link to="/history">Open session history</Link>
                </Button>
                {acceptMutation.data?.ownerUserId && (
                  <Button variant="outline" asChild>
                    <Link to="/history" search={{ student: acceptMutation.data.ownerUserId }}>
                      View this student
                    </Link>
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Click below to accept this invite. You must be signed in with the invited email.
              </p>
              <Button onClick={handleAccept} disabled={acceptMutation.isPending}>
                {acceptMutation.isPending ? "Accepting..." : "Accept invite"}
              </Button>
            </>
          )}

          {acceptMutation.isError && (
            <p className="text-sm text-danger">
              {acceptMutation.error instanceof Error
                ? acceptMutation.error.message
                : "Failed to accept invite."}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
