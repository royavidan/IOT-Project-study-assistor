import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState, LoadingState } from "@/components/EmptyState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_SETTINGS,
  useSaveSettings,
  useSettings,
  type AppSettings,
} from "@/lib/queries/settings";
import { ExternalLoadCard } from "@/components/ExternalLoadCard";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — MindBox" }] }),
  component: Settings,
});

type ToggleKey =
  | "notificationsEnabled"
  | "hapticsEnabled"
  | "shareWithReviewers"
  | "reduceMotion"
  | "adaptiveCoachingEnabled";

const toggles: { key: ToggleKey; label: string; desc: string }[] = [
  {
    key: "notificationsEnabled",
    label: "Motivation nudges",
    desc: "Gentle reminders to come back to your routine after long inactivity (Story 12).",
  },
  {
    key: "hapticsEnabled",
    label: "Device haptics",
    desc: "Subtle vibrations on the box when work/break starts.",
  },
  {
    key: "adaptiveCoachingEnabled",
    label: "Adaptive interval coaching",
    desc: "Let the box auto-shift Work/Rest when the Focus Load Estimate is high (Story 16).",
  },
  {
    key: "shareWithReviewers",
    label: "Share with reviewers",
    desc: "Auto-email a weekly PDF report to you and your active reviewers.",
  },
  {
    key: "reduceMotion",
    label: "Reduce motion",
    desc: "Calmer animations across the app.",
  },
];

function Settings() {
  const { data, isLoading, isError, error, refetch } = useSettings();
  const saveMutation = useSaveSettings();

  const [form, setForm] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");

  // Hydrate local form state once the saved settings load.
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (isLoading) return <LoadingState label="Loading settings…" />;
  if (isError) {
    return (
      <ErrorState
        title="Could not load settings"
        description={error instanceof Error ? error.message : undefined}
        onRetry={() => void refetch()}
      />
    );
  }

  const setToggle = (key: ToggleKey, value: boolean) => setForm((f) => ({ ...f, [key]: value }));

  const onSave = () => {
    setMessage(null);
    saveMutation.mutate(form, {
      onSuccess: () => {
        setMessageKind("success");
        setMessage("Settings saved.");
      },
      onError: (err) => {
        setMessageKind("error");
        setMessage(err instanceof Error ? err.message : "Failed to save settings.");
      },
    });
  };

  return (
    <>
      <PageHeader title="Settings" description="Tune the experience to fit your routine." />

      {message && (
        <p
          role="status"
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            messageKind === "success"
              ? "border-success/30 bg-success/10 text-success"
              : "border-danger/30 bg-danger-muted/40 text-danger"
          }`}
        >
          {message}
        </p>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>
            How your name appears on the leaderboard and in reports.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-1.5">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              placeholder="Your name"
              className="max-w-sm"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Daily focus goal</CardTitle>
          <CardDescription>Your dashboard progress ring fills toward this target.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="goal">Minutes per day</Label>
              <Input
                id="goal"
                type="number"
                min={15}
                max={1440}
                step={15}
                value={form.dailyGoalMin}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    dailyGoalMin: Number.parseInt(e.target.value, 10) || 0,
                  }))
                }
                className="w-[140px]"
              />
            </div>
            <p className="pb-2 text-sm text-muted-foreground">
              ≈ {(form.dailyGoalMin / 60).toFixed(1)} h
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent className="divide-y divide-border p-0">
          {toggles.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-4 px-5 py-4">
              <div>
                <Label htmlFor={r.key} className="text-sm font-medium">
                  {r.label}
                </Label>
                <p className="text-xs text-muted-foreground">{r.desc}</p>
              </div>
              <Switch
                id={r.key}
                checked={form[r.key]}
                onCheckedChange={(v) => setToggle(r.key, v)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Quiet hours</CardTitle>
          <CardDescription>
            Suppress motivation nudges during this window — e.g. overnight or class time (Story 12).
            Leave both blank to disable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={`flex flex-wrap items-end gap-3 ${
              form.notificationsEnabled ? "" : "opacity-50"
            }`}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="quiet-start">From</Label>
              <Input
                id="quiet-start"
                type="time"
                disabled={!form.notificationsEnabled}
                value={form.quietHoursStart ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, quietHoursStart: e.target.value || null }))
                }
                className="w-[140px]"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="quiet-end">To</Label>
              <Input
                id="quiet-end"
                type="time"
                disabled={!form.notificationsEnabled}
                value={form.quietHoursEnd ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, quietHoursEnd: e.target.value || null }))}
                className="w-[140px]"
              />
            </div>
          </div>
          {!form.notificationsEnabled && (
            <p className="mt-2 text-xs text-muted-foreground">
              Enable “Motivation nudges” above to set quiet hours.
            </p>
          )}
        </CardContent>
      </Card>

      {form.shareWithReviewers && (
        <p className="mb-6 text-xs text-muted-foreground">
          Weekly PDF reports are emailed to you and your active reviewers at most once every 7 days
          when <code className="rounded bg-muted px-1">SMTP_USER</code> /{" "}
          <code className="rounded bg-muted px-1">SMTP_PASS</code> (Gmail App Password) is
          configured in <code className="rounded bg-muted px-1">.env</code>.
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <ExternalLoadCard />
    </>
  );
}
