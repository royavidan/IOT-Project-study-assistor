import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFriends, useFriendActions, type Friend } from "@/lib/queries/friends";
import { UserPlus, Users } from "lucide-react";

export const Route = createFileRoute("/friends")({
  head: () => ({ meta: [{ title: "Friends — MindBox" }] }),
  component: Friends,
});

function FriendRow({ friend, children }: { friend: Friend; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{friend.displayName}</p>
        <p className="truncate text-xs text-muted-foreground">{friend.email}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function Friends() {
  const { data, isLoading, isError, error, refetch } = useFriends();
  const { send, respond, remove } = useFriendActions();

  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");

  const { accepted, incoming, outgoing } = useMemo(() => {
    const all = data ?? [];
    return {
      accepted: all.filter((f) => f.status === "accepted"),
      incoming: all.filter((f) => f.status !== "accepted" && f.direction === "incoming"),
      outgoing: all.filter((f) => f.status !== "accepted" && f.direction === "outgoing"),
    };
  }, [data]);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    send.mutate(email, {
      onSuccess: ({ displayName, emailSent, emailReason }) => {
        setMessageKind(emailSent ? "success" : "error");
        setMessage(
          emailSent
            ? `Friend request sent to ${displayName} — we emailed them a heads-up too.`
            : `Friend request sent to ${displayName}, but the email didn't go out${
                emailReason ? `: ${emailReason}` : ""
              }.`,
        );
        setEmail("");
      },
      onError: (err) => {
        setMessageKind("error");
        setMessage(err instanceof Error ? err.message : "Could not send request.");
      },
    });
  };

  if (isLoading) return <LoadingState label="Loading friends…" />;
  if (isError) {
    return (
      <ErrorState
        title="Could not load friends"
        description={error instanceof Error ? error.message : undefined}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Friends"
        description="Add friends to compare focus streaks on the leaderboard."
      />

      <Card className="mb-6">
        <CardContent className="p-5">
          <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="grid gap-2">
              <Label htmlFor="friend-email">Add by email</Label>
              <Input
                id="friend-email"
                type="email"
                placeholder="friend@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={send.isPending}>
              <UserPlus className="h-4 w-4" />
              {send.isPending ? "Sending…" : "Send request"}
            </Button>
          </form>
          {message && (
            <p
              className={`mt-3 text-sm ${messageKind === "error" ? "text-danger" : "text-success"}`}
            >
              {message}
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Enter the email address your friend used to sign up for MindBox. They need an account
            before you can add them — if they haven&apos;t joined yet, ask them to register first,
            then try again. We&apos;ll email them a heads-up when you send a request.
          </p>
        </CardContent>
      </Card>

      {incoming.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Requests for you</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {incoming.map((f) => (
              <FriendRow key={f.friendId} friend={f}>
                <Button
                  size="sm"
                  disabled={respond.isPending}
                  onClick={() => respond.mutate({ friendId: f.friendId, accept: true })}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={respond.isPending}
                  onClick={() => respond.mutate({ friendId: f.friendId, accept: false })}
                >
                  Decline
                </Button>
              </FriendRow>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Friends ({accepted.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {accepted.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title="No friends yet"
              description="Send a request above. Once accepted, you'll see each other on the leaderboard."
              className="border-0 bg-transparent"
            />
          ) : (
            <div className="divide-y divide-border">
              {accepted.map((f) => (
                <FriendRow key={f.friendId} friend={f}>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(f.friendId)}
                  >
                    Remove
                  </Button>
                </FriendRow>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {outgoing.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sent requests</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {outgoing.map((f) => (
              <FriendRow key={f.friendId} friend={f}>
                <span className="text-xs text-muted-foreground">Pending</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(f.friendId)}
                >
                  Cancel
                </Button>
              </FriendRow>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
