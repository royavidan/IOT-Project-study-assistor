import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLeaderboard } from "@/features/social/leaderboard";
import type { LeaderboardEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Trophy, Users } from "lucide-react";

export const Route = createFileRoute("/leaderboard")({
  head: () => ({ meta: [{ title: "Leaderboard — MindBox" }] }),
  component: Leaderboard,
});

type View = "top10" | "myrank";

/** "My Rank" shows you plus your nearest neighbours; "Top 10" shows the leaders. */
function selectView(entries: LeaderboardEntry[], view: View): LeaderboardEntry[] {
  if (view === "top10") return entries.slice(0, 10);
  const meIdx = entries.findIndex((e) => e.is_you);
  if (meIdx === -1) return entries.slice(0, 10);
  const start = Math.max(0, meIdx - 2);
  return entries.slice(start, meIdx + 3);
}

function Leaderboard() {
  const { data, isLoading, isError, error, refetch } = useLeaderboard();
  const [view, setView] = useState<View>("top10");

  const entries = data ?? [];
  const shown = useMemo(() => selectView(entries, view), [entries, view]);
  const soloOrEmpty = entries.length <= 1;

  if (isLoading) return <LoadingState label="Loading leaderboard…" />;
  if (isError) {
    return (
      <ErrorState
        title="Could not load leaderboard"
        description={error instanceof Error ? error.message : undefined}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Leaderboard"
        description="This week, among your friends."
        actions={
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            <Button
              size="sm"
              variant={view === "top10" ? "default" : "ghost"}
              onClick={() => setView("top10")}
            >
              Top 10
            </Button>
            <Button
              size="sm"
              variant={view === "myrank" ? "default" : "ghost"}
              onClick={() => setView("myrank")}
            >
              My rank
            </Button>
          </div>
        }
      />

      {soloOrEmpty && (
        <Card className="mb-4 border-info/20 bg-info/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-muted-foreground">
              It's just you here so far. Add friends to make it a competition.
            </p>
            <Button size="sm" variant="outline" asChild>
              <Link to="/friends">
                <Users className="h-4 w-4" /> Add friends
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {shown.length === 0 ? (
            <EmptyState
              icon={<Trophy className="h-8 w-8" />}
              title="No leaderboard yet"
              description="Log some sessions and add friends to compare focus minutes."
              className="border-0 bg-transparent"
            />
          ) : (
            <div className="divide-y divide-border">
              {shown.map((e) => (
                <div
                  key={`${e.rank}-${e.display_name}`}
                  className={cn(
                    "flex items-center justify-between px-5 py-3",
                    e.is_you && "bg-info/5",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-muted text-sm font-semibold tabular-nums">
                      {e.rank}
                    </span>
                    <div>
                      <p className="text-sm font-medium">
                        {e.display_name}
                        {e.is_you && " (you)"}
                      </p>
                      <p className="text-xs text-muted-foreground">{e.streak}d streak</p>
                    </div>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">{e.minutes_this_week} min</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
