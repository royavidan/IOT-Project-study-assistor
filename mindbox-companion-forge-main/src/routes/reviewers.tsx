import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/EmptyState";
import { Mail, ShieldCheck } from "lucide-react";
import {
  createReviewerInvite,
  listReviewerGrants,
  revokeReviewerInvite,
} from "@/features/social/reviewer.functions";

export const Route = createFileRoute("/reviewers")({
  head: () => ({ meta: [{ title: "Reviewer Access — MindBox" }] }),
  component: Reviewers,
});

function Reviewers() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"error" | "success" | "warning">("success");
  const [latestInvite, setLatestInvite] = useState<{ email: string; link: string } | null>(null);

  const grantsQuery = useQuery({
    queryKey: ["reviewer-grants"],
    queryFn: () => listReviewerGrants(),
  });

  const createInviteMutation = useMutation({
    mutationFn: (reviewerEmail: string) => createReviewerInvite({ data: { email: reviewerEmail } }),
    onSuccess: (invite) => {
      const link = invite.inviteLink;
      setLatestInvite({ email: invite.reviewerEmail, link });
      setEmail("");
      if (invite.emailSent) {
        setMessageKind("success");
        setMessage(`Invite emailed to ${invite.reviewerEmail}. You can also share the link below.`);
      } else {
        setMessageKind("warning");
        setMessage(
          `Invite created for ${invite.reviewerEmail}, but automatic email was not sent. ${invite.emailReason ?? ""}`.trim(),
        );
      }
      queryClient.invalidateQueries({ queryKey: ["reviewer-grants"] });
    },
    onError: (error) => {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Failed to create invite.");
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeReviewerInvite({ data: { id } }),
    onSuccess: () => {
      setMessageKind("success");
      setMessage("Invite revoked.");
      queryClient.invalidateQueries({ queryKey: ["reviewer-grants"] });
    },
    onError: (error) => {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Failed to revoke invite.");
    },
  });

  const mailtoHref = useMemo(() => {
    if (!latestInvite) return null;
    const subject = encodeURIComponent("MindBox reviewer access invite");
    const body = encodeURIComponent(
      `You have been invited to view my MindBox study reports.\n\nOpen this link and accept the invite:\n${latestInvite.link}`,
    );
    return `mailto:${latestInvite.email}?subject=${subject}&body=${body}`;
  }, [latestInvite]);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setMessageKind("error");
      setMessage("Please enter a reviewer email.");
      return;
    }

    createInviteMutation.mutate(normalized);
  };

  const copyInviteLink = async () => {
    if (!latestInvite) return;
    try {
      await navigator.clipboard.writeText(latestInvite.link);
      setMessageKind("success");
      setMessage("Invite link copied to clipboard.");
    } catch {
      setMessageKind("error");
      setMessage("Couldn't copy the link automatically. Please copy it manually.");
    }
  };

  const grants = grantsQuery.data ?? [];

  const statusClass = (status: string) => {
    if (status === "active")
      return "rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success";
    if (status === "revoked")
      return "rounded-full bg-danger-muted px-2 py-0.5 text-xs font-medium text-danger";
    return "rounded-full bg-warning-muted px-2 py-0.5 text-xs font-medium text-warning-foreground";
  };

  return (
    <>
      <PageHeader
        title="Reviewer access"
        description="Invite a parent, tutor, or mentor to view your sessions."
      />

      <Card className="mb-6">
        <CardContent className="p-5">
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="grid gap-2">
              <Label htmlFor="invite">Email</Label>
              <Input
                id="invite"
                type="email"
                placeholder="reviewer@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={createInviteMutation.isPending}>
              <Mail className="h-4 w-4" />
              {createInviteMutation.isPending ? "Sending..." : "Send invite"}
            </Button>
          </form>

          {message && (
            <p
              className={`mt-3 text-sm ${
                messageKind === "error"
                  ? "text-danger"
                  : messageKind === "warning"
                    ? "text-warning-foreground"
                    : "text-success"
              }`}
            >
              {message}
            </p>
          )}

          <p className="mt-2 text-xs text-muted-foreground">
            Need to log in first?{" "}
            <Link to="/login" search={{ redirect: "/reviewers" }} className="underline">
              Open login
            </Link>
          </p>

          {latestInvite && (
            <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">Latest invite link</p>
              <p className="mt-1 break-all text-sm">{latestInvite.link}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={copyInviteLink}>
                  Copy link
                </Button>
                {mailtoHref && (
                  <Button type="button" variant="outline" size="sm" asChild>
                    <a href={mailtoHref}>Open email draft</a>
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {grantsQuery.isLoading ? (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">
            Loading reviewer invites...
          </CardContent>
        </Card>
      ) : grantsQuery.error ? (
        <Card>
          <CardContent className="p-5 text-sm text-danger">
            {grantsQuery.error instanceof Error
              ? grantsQuery.error.message
              : "Failed to load reviewer invites."}
          </CardContent>
        </Card>
      ) : grants.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title="No reviewers yet"
          description="Invite someone to share your weekly focus reports."
        />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {grants.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{invite.reviewerEmail}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Expires {invite.expiresAt ? new Date(invite.expiresAt).toLocaleString() : "N/A"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={statusClass(invite.status)}>{invite.status}</span>
                  {invite.status !== "revoked" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={revokeMutation.isPending}
                      onClick={() => revokeMutation.mutate(invite.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
