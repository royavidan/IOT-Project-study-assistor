import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ErrorState, LoadingState } from "@/components/EmptyState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  CHIME_BITS,
  DEFAULT_SETTINGS,
  useSaveSettings,
  useSettings,
  type AppSettings,
} from "@/lib/queries/settings";
import { MODE_CONFIGS, PLAN_MODES, type PlanMode } from "@/features/planner/planner";
import { DEVICE_THEME_PRESETS } from "@/features/device/theme-presets";
import { STUDY_PLANNER_ENABLED } from "@/lib/feature-flags";
import { ExternalLoadCard } from "@/features/insights/components/ExternalLoadCard";
import { useDefaultCompanions } from "@/lib/default-companions";
import type { Companions } from "@/lib/types";

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

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">MindBox device</CardTitle>
          <CardDescription>
            Sounds, schedule, screen theme and timing. Delivered to your MindBox within a minute of
            saving — the website owns these while the device is paired.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="device-sound" className="text-sm font-medium">
                Speaker sounds
              </Label>
              <p className="text-xs text-muted-foreground">
                Master switch for every chime on the box (quiet hours always mute it).
              </p>
            </div>
            <Switch
              id="device-sound"
              className="shrink-0"
              checked={form.deviceSoundEnabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, deviceSoundEnabled: v }))}
            />
          </div>

          <div className={form.deviceSoundEnabled ? "space-y-5" : "space-y-5 opacity-50"}>
            <div className="space-y-2">
              <Label>Volume</Label>
              <ToggleGroup
                type="single"
                value={String(form.deviceSoundLevel)}
                onValueChange={(v) =>
                  v &&
                  setForm((f) => ({
                    ...f,
                    deviceSoundLevel: Number(v) as AppSettings["deviceSoundLevel"],
                  }))
                }
                variant="outline"
                className="grid w-full max-w-md grid-cols-3"
                disabled={!form.deviceSoundEnabled}
              >
                <ToggleGroupItem value="0" className="min-h-10 text-xs">
                  Soft
                </ToggleGroupItem>
                <ToggleGroupItem value="1" className="min-h-10 text-xs">
                  Medium
                </ToggleGroupItem>
                <ToggleGroupItem value="2" className="min-h-10 text-xs">
                  Loud
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="space-y-2.5">
              <Label>Which chimes play</Label>
              {(
                [
                  { bit: CHIME_BITS.session, label: "Session start / pause / resume" },
                  { bit: CHIME_BITS.complete, label: "Session complete" },
                  { bit: CHIME_BITS.autoStart, label: "Scheduled block starting" },
                  { bit: CHIME_BITS.alerts, label: "Environment alerts (noise / heat / light)" },
                ] as const
              ).map(({ bit, label }) => (
                <div key={bit} className="flex items-center justify-between gap-4">
                  <span className="text-sm">{label}</span>
                  <Switch
                    className="shrink-0"
                    disabled={!form.deviceSoundEnabled}
                    checked={(form.deviceChimeMask & (1 << bit)) !== 0}
                    onCheckedChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        deviceChimeMask: v
                          ? f.deviceChimeMask | (1 << bit)
                          : f.deviceChimeMask & ~(1 << bit),
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <div className="min-w-0">
              <Label htmlFor="auto-start" className="text-sm font-medium">
                Auto-start planned sessions
              </Label>
              <p className="text-xs text-muted-foreground">
                When a study block from your calendar begins, the box chimes and starts the session
                by itself (tap to cancel on the device).
              </p>
            </div>
            <Switch
              id="auto-start"
              className="shrink-0"
              checked={form.autoStartScheduled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, autoStartScheduled: v }))}
            />
          </div>

          <div className="space-y-2.5 border-t border-border pt-4">
            <div>
              <Label className="text-sm font-medium">Screen theme</Label>
              <p className="text-xs text-muted-foreground">
                Accent colors for the box UI (timer ring, menus). Screen brightness is set on the
                device itself.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {DEVICE_THEME_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={form.deviceThemeId === p.id}
                  onClick={() => setForm((f) => ({ ...f, deviceThemeId: p.id }))}
                  className={
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors " +
                    (form.deviceThemeId === p.id
                      ? "border-primary bg-primary/10 font-medium"
                      : "border-border hover:bg-muted/50")
                  }
                >
                  <span className="flex -space-x-1">
                    <span
                      className="h-4 w-4 rounded-full border border-background"
                      style={{ backgroundColor: p.accent }}
                    />
                    <span
                      className="h-4 w-4 rounded-full border border-background"
                      style={{ backgroundColor: p.break }}
                    />
                    <span
                      className="h-4 w-4 rounded-full border border-background"
                      style={{ backgroundColor: p.longBreak }}
                    />
                  </span>
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5 border-t border-border pt-4">
            <div>
              <Label className="text-sm font-medium">Session rhythm (pomodoro)</Label>
              <p className="text-xs text-muted-foreground">
                The box runs <b>{form.deviceCycles}</b> focus blocks of {form.deviceFocusMin}m with{" "}
                {form.deviceBreakMin}m breaks and a {form.deviceLongBreakMin}m long break after the
                last one. A save lands on the device once — you can still adjust on the box
                afterwards (until the next site save).
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1">
                <Label htmlFor="device-focus" className="text-xs">
                  Focus (min)
                </Label>
                <Input
                  id="device-focus"
                  type="number"
                  min={5}
                  max={120}
                  className="w-24"
                  value={form.deviceFocusMin}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, deviceFocusMin: Number(e.target.value) }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="device-break" className="text-xs">
                  Break (min)
                </Label>
                <Input
                  id="device-break"
                  type="number"
                  min={1}
                  max={60}
                  className="w-24"
                  value={form.deviceBreakMin}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, deviceBreakMin: Number(e.target.value) }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="device-longbreak" className="text-xs">
                  Long break (min)
                </Label>
                <Input
                  id="device-longbreak"
                  type="number"
                  min={1}
                  max={60}
                  className="w-24"
                  value={form.deviceLongBreakMin}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, deviceLongBreakMin: Number(e.target.value) }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="device-cycles" className="text-xs">
                  Focus blocks
                </Label>
                <Input
                  id="device-cycles"
                  type="number"
                  min={1}
                  max={8}
                  className="w-24"
                  value={form.deviceCycles}
                  onChange={(e) => setForm((f) => ({ ...f, deviceCycles: Number(e.target.value) }))}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <div className="min-w-0">
              <Label htmlFor="exam-mode" className="text-sm font-medium">
                Exam mode (do not disturb)
              </Label>
              <p className="text-xs text-muted-foreground">
                Mutes chimes and coaching nudges on the box and shows an exam countdown. Turns on
                automatically on days with an exam in your calendar — this switch only extends it.
              </p>
            </div>
            <Switch
              id="exam-mode"
              className="shrink-0"
              checked={form.examMode}
              onCheckedChange={(v) => setForm((f) => ({ ...f, examMode: v }))}
            />
          </div>
        </CardContent>
      </Card>

      {STUDY_PLANNER_ENABLED && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Study planner</CardTitle>
            <CardDescription>
              Defaults for “Auto-plan study time” on the calendar. The planner fills these working
              hours with study blocks, ramps up before deadlines, and stays under a healthy cap.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Default strategy</Label>
              <ToggleGroup
                type="single"
                value={form.studyPlanMode}
                onValueChange={(v) => v && setForm((f) => ({ ...f, studyPlanMode: v as PlanMode }))}
                variant="outline"
                className="grid w-full max-w-md grid-cols-3"
              >
                {PLAN_MODES.map((m) => (
                  <ToggleGroupItem key={m} value={m} className="min-h-10 whitespace-nowrap text-xs">
                    {MODE_CONFIGS[m].label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">
                {MODE_CONFIGS[form.studyPlanMode].blurb}
              </p>
            </div>

            <div className="grid max-w-md gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="plan-start">Study from</Label>
                <Input
                  id="plan-start"
                  type="time"
                  value={form.planDayStart}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      planDayStart: e.target.value || DEFAULT_SETTINGS.planDayStart,
                    }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="plan-end">Study until</Label>
                <Input
                  id="plan-end"
                  type="time"
                  value={form.planDayEnd}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      planDayEnd: e.target.value || DEFAULT_SETTINGS.planDayEnd,
                    }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="plan-cap">Daily cap (min)</Label>
                <Input
                  id="plan-cap"
                  type="number"
                  min={30}
                  max={600}
                  step={15}
                  placeholder="Auto"
                  onWheel={(e) => e.currentTarget.blur()}
                  value={form.planDailyCapMin ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      planDailyCapMin:
                        e.target.value === "" ? null : Number.parseInt(e.target.value, 10) || null,
                    }))
                  }
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Leave the daily cap blank to use each strategy's built-in limit (
              {Math.round(MODE_CONFIGS[form.studyPlanMode].dailyCapMin / 60)}h for{" "}
              {MODE_CONFIGS[form.studyPlanMode].label}).
            </p>
          </CardContent>
        </Card>
      )}

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

      <StudyContextDefaultCard />
      <ExternalLoadCard />
    </>
  );
}

function StudyContextDefaultCard() {
  const [companions, setCompanions] = useDefaultCompanions();
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Study context default</CardTitle>
        <CardDescription>
          How you usually study. New sessions start with this; you can still retag any session on
          its detail page. It nudges your Focus Battery, not your grade.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-1.5">
          <Label>Usually I study</Label>
          <ToggleGroup
            type="single"
            value={companions}
            onValueChange={(v) => v && setCompanions(v as Companions)}
            className="justify-start"
          >
            <ToggleGroupItem value="solo" className="min-h-10 text-xs">
              Solo
            </ToggleGroupItem>
            <ToggleGroupItem value="with_others" className="min-h-10 text-xs">
              With friends
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardContent>
    </Card>
  );
}
