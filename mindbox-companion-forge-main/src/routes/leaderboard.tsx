import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { mockLeaderboard } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/leaderboard")({
  head: () => ({ meta: [{ title: "Leaderboard — MindBox" }] }),
  component: Leaderboard,
});

function Leaderboard() {
  return (
    <>
      <PageHeader title="Leaderboard" description="This week, among your group." />
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {mockLeaderboard.map((e) => (
            <div
              key={e.rank}
              className={cn(
                "flex items-center justify-between px-5 py-3",
                e.you && "bg-info/5",
              )}
            >
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-muted text-sm font-semibold tabular-nums">
                  {e.rank}
                </span>
                <div>
                  <p className="text-sm font-medium">{e.name}{e.you && " (you)"}</p>
                  <p className="text-xs text-muted-foreground">{e.streak}d streak</p>
                </div>
              </div>
              <p className="text-sm font-semibold tabular-nums">{e.minutes} min</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
