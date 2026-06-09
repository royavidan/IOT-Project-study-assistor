import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { mockReviewers } from "@/lib/mock-data";
import { EmptyState } from "@/components/EmptyState";
import { ShieldCheck, Mail } from "lucide-react";

export const Route = createFileRoute("/reviewers")({
  head: () => ({ meta: [{ title: "Reviewer Access — MindBox" }] }),
  component: Reviewers,
});

function Reviewers() {
  return (
    <>
      <PageHeader
        title="Reviewer access"
        description="Invite a parent, tutor, or mentor to view your sessions."
      />

      <Card className="mb-6">
        <CardContent className="grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-2">
            <Label htmlFor="invite">Email</Label>
            <Input id="invite" type="email" placeholder="reviewer@example.com" />
          </div>
          <Button>
            <Mail className="h-4 w-4" /> Send invite
          </Button>
        </CardContent>
      </Card>

      {mockReviewers.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="h-8 w-8" />}
          title="No reviewers yet"
          description="Invite someone to share your weekly focus reports."
        />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {mockReviewers.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{r.email} · {r.role}</p>
                </div>
                <span
                  className={
                    r.status === "active"
                      ? "rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success"
                      : "rounded-full bg-warning-muted px-2 py-0.5 text-xs font-medium text-warning-foreground"
                  }
                >
                  {r.status}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
