import { dateKeyDaysAgo } from "@/lib/dates";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { StateBadge } from "@/components/StateBadge";
import { ErrorState, LoadingState } from "@/components/EmptyState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  clearSimulatorData,
  getSimulatorDevice,
  submitSimulatorSession,
  submitSimulatorTelemetry,
} from "@/features/simulator/simulator.functions";
import { DEFAULT_SIM_ENV, randomSimulatorEnv } from "@/features/simulator/simulator-env";
import { getDefaultCompanions } from "@/lib/default-companions";
import type { Companions, DeviceState, SessionMode, SessionStatus } from "@/lib/types";
import { ArrowRight, Dices, FlaskConical, Trash2 } from "lucide-react";

export const Route = createFileRoute("/simulator")({
  head: () => ({ meta: [{ title: "Device Simulator — MindBox" }] }),
  component: Simulator,
});

const MODES: SessionMode[] = ["Deep Focus", "Study", "Reading", "Review", "Homework"];
const STATUSES: SessionStatus[] = ["completed", "interrupted", "aborted"];
const DEVICE_STATES: DeviceState[] = ["idle", "work", "break", "sync", "warning", "danger"];
const SENSOR_HEALTH = ["ok", "fault", "invalid"] as const;
type SensorHealthStatus = (typeof SENSOR_HEALTH)[number];

type SimSessionForm = {
  date: string;
  startTime: string;
  durationMin: number;
  mode: SessionMode;
  status: SessionStatus;
  companions: Companions;
  breaks: number;
  presenceInterruptions: number;
  focusScore: string;
  noiseAvg: number;
  tempC: number;
  lightLux: number;
  lightVariance: number;
};

function todayDate(): string {
  return dateKeyDaysAgo(0);
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function invalidateData(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["sessions"] });
  void queryClient.invalidateQueries({ queryKey: ["device-status"] });
  void queryClient.invalidateQueries({ queryKey: ["daily-goal"] });
  void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
  void queryClient.invalidateQueries({ queryKey: ["simulator-device"] });
}

function Simulator() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");

  const deviceQuery = useQuery({
    queryKey: ["simulator-device"],
    queryFn: () => getSimulatorDevice(),
  });

  const [sessionForm, setSessionForm] = useState<SimSessionForm>({
    date: todayDate(),
    startTime: nowTime(),
    durationMin: 25,
    mode: "Study" as SessionMode,
    status: "completed" as SessionStatus,
    companions: getDefaultCompanions(),
    breaks: 0,
    presenceInterruptions: 0,
    focusScore: "",
    noiseAvg: DEFAULT_SIM_ENV.noiseAvg,
    tempC: DEFAULT_SIM_ENV.tempC,
    lightLux: DEFAULT_SIM_ENV.lightLux,
    lightVariance: DEFAULT_SIM_ENV.lightVariance,
  });

  const [telemetryForm, setTelemetryForm] = useState({
    state: "work" as DeviceState,
    batteryPct: 85,
    wifiRssi: -55,
    sensorHealth: {
      tof: "ok" as SensorHealthStatus,
      mic: "ok" as SensorHealthStatus,
      light: "ok" as SensorHealthStatus,
      temp: "ok" as SensorHealthStatus,
    },
  });

  const sessionMutation = useMutation({
    mutationFn: () =>
      submitSimulatorSession({
        data: {
          date: sessionForm.date,
          startTime: sessionForm.startTime,
          durationMin: sessionForm.durationMin,
          mode: sessionForm.mode,
          status: sessionForm.status,
          companions: sessionForm.companions,
          breaks: sessionForm.breaks,
          presenceInterruptions: sessionForm.presenceInterruptions,
          focusScore: sessionForm.focusScore
            ? Number.parseInt(sessionForm.focusScore, 10)
            : undefined,
          noiseAvg: sessionForm.noiseAvg,
          tempC: sessionForm.tempC,
          lightLux: sessionForm.lightLux,
          lightVariance: sessionForm.lightVariance,
        },
      }),
    onSuccess: (result) => {
      setMessageKind("success");
      setMessage(result.message);
      invalidateData(queryClient);
    },
    onError: (err) => {
      setMessageKind("error");
      setMessage(err instanceof Error ? err.message : "Failed to log session.");
    },
  });

  const telemetryMutation = useMutation({
    mutationFn: () =>
      submitSimulatorTelemetry({
        data: {
          state: telemetryForm.state,
          batteryPct: telemetryForm.batteryPct,
          wifiRssi: telemetryForm.wifiRssi,
          sensorHealth: telemetryForm.sensorHealth,
        },
      }),
    onSuccess: (result) => {
      setMessageKind("success");
      setMessage(result.message);
      invalidateData(queryClient);
    },
    onError: (err) => {
      setMessageKind("error");
      setMessage(err instanceof Error ? err.message : "Failed to update telemetry.");
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => clearSimulatorData(),
    onSuccess: (result) => {
      setMessageKind("success");
      setMessage(result.message);
      invalidateData(queryClient);
    },
    onError: (err) => {
      setMessageKind("error");
      setMessage(err instanceof Error ? err.message : "Failed to clear data.");
    },
  });

  const liveState = useMemo(() => {
    const s = deviceQuery.data?.status?.state;
    return DEVICE_STATES.includes(s as DeviceState) ? (s as DeviceState) : "idle";
  }, [deviceQuery.data?.status?.state]);

  if (deviceQuery.isLoading) {
    return <LoadingState label="Setting up simulator device…" />;
  }

  if (deviceQuery.isError) {
    return (
      <ErrorState
        title="Could not load simulator"
        description={deviceQuery.error instanceof Error ? deviceQuery.error.message : undefined}
        onRetry={() => void deviceQuery.refetch()}
      />
    );
  }

  const device = deviceQuery.data!;

  return (
    <>
      <PageHeader
        title="Device simulator"
        description="Log sessions and device status manually until your physical MindBox is paired."
        actions={<StateBadge state={liveState} />}
      />

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

      <Card className="mb-6 border-sync/20 bg-sync-muted/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-4 w-4 text-sync" aria-hidden />
            Your simulator device
          </CardTitle>
          <CardDescription>
            This virtual device is owned by your account. Data you submit here appears on Dashboard,
            History, and Leaderboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-sm font-medium">{device.deviceId}</p>
            <p className="text-xs text-muted-foreground">
              {device.sessionCount} session{device.sessionCount === 1 ? "" : "s"} logged
              {device.status
                ? ` · last telemetry ${new Date(device.status.updatedAt).toLocaleString()}`
                : " · no telemetry yet"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/">
                View dashboard <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={clearMutation.isPending}
              onClick={() => clearMutation.mutate()}
            >
              <Trash2 className="h-4 w-4" />
              Clear data
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Log a focus session</CardTitle>
            <CardDescription>
              Record a study block with environment sensor readings (noise, temperature, light) like
              a real MindBox would measure.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="sim-date">Date</Label>
                <Input
                  id="sim-date"
                  type="date"
                  value={sessionForm.date}
                  onChange={(e) => setSessionForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sim-start">Start time</Label>
                <Input
                  id="sim-start"
                  type="time"
                  value={sessionForm.startTime}
                  onChange={(e) => setSessionForm((f) => ({ ...f, startTime: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="sim-duration">Duration (min)</Label>
                <Input
                  id="sim-duration"
                  type="number"
                  min={1}
                  max={480}
                  value={sessionForm.durationMin}
                  onChange={(e) =>
                    setSessionForm((f) => ({
                      ...f,
                      durationMin: Number.parseInt(e.target.value, 10) || 1,
                    }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sim-breaks">Breaks</Label>
                <Input
                  id="sim-breaks"
                  type="number"
                  min={0}
                  max={20}
                  value={sessionForm.breaks}
                  onChange={(e) =>
                    setSessionForm((f) => ({
                      ...f,
                      breaks: Number.parseInt(e.target.value, 10) || 0,
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Mode</Label>
                <Select
                  value={sessionForm.mode}
                  onValueChange={(v) => setSessionForm((f) => ({ ...f, mode: v as SessionMode }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Status</Label>
                <Select
                  value={sessionForm.status}
                  onValueChange={(v) =>
                    setSessionForm((f) => ({ ...f, status: v as SessionStatus }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Studied with</Label>
                <Select
                  value={sessionForm.companions}
                  onValueChange={(v) =>
                    setSessionForm((f) => ({ ...f, companions: v as Companions }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="solo">Solo</SelectItem>
                    <SelectItem value="with_others">With friends</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="sim-presence">Presence interruptions</Label>
                <Input
                  id="sim-presence"
                  type="number"
                  min={0}
                  max={10}
                  value={sessionForm.presenceInterruptions}
                  onChange={(e) =>
                    setSessionForm((f) => ({
                      ...f,
                      presenceInterruptions: Number.parseInt(e.target.value, 10) || 0,
                    }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sim-score">Focus score (optional)</Label>
                <Input
                  id="sim-score"
                  type="number"
                  min={0}
                  max={100}
                  placeholder="Auto from sensors"
                  value={sessionForm.focusScore}
                  onChange={(e) => setSessionForm((f) => ({ ...f, focusScore: e.target.value }))}
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Environment sensors</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSessionForm((f) => ({
                      ...f,
                      ...randomSimulatorEnv(),
                    }))
                  }
                >
                  <Dices className="h-4 w-4" />
                  Randomize
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="sim-noise">Noise (0–1)</Label>
                  <Input
                    id="sim-noise"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={sessionForm.noiseAvg}
                    onChange={(e) =>
                      setSessionForm((f) => ({
                        ...f,
                        noiseAvg: Number.parseFloat(e.target.value) || 0,
                      }))
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Mic sensor · 0 = quiet, 1 = loud
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sim-light-var">Light variance (0–1)</Label>
                  <Input
                    id="sim-light-var"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={sessionForm.lightVariance}
                    onChange={(e) =>
                      setSessionForm((f) => ({
                        ...f,
                        lightVariance: Number.parseFloat(e.target.value) || 0,
                      }))
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    How unstable the light level was
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sim-temp">Temperature (°C)</Label>
                  <Input
                    id="sim-temp"
                    type="number"
                    min={10}
                    max={40}
                    step={0.1}
                    value={sessionForm.tempC}
                    onChange={(e) =>
                      setSessionForm((f) => ({
                        ...f,
                        tempC: Number.parseFloat(e.target.value) || 20,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sim-light">Light (lux)</Label>
                  <Input
                    id="sim-light"
                    type="number"
                    min={0}
                    max={5000}
                    step={1}
                    value={sessionForm.lightLux}
                    onChange={(e) =>
                      setSessionForm((f) => ({
                        ...f,
                        lightLux: Number.parseInt(e.target.value, 10) || 0,
                      }))
                    }
                  />
                </div>
              </div>
            </div>

            <Button
              className="w-full"
              disabled={sessionMutation.isPending}
              onClick={() => sessionMutation.mutate()}
            >
              {sessionMutation.isPending ? "Logging…" : "Log session"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Update device status</CardTitle>
            <CardDescription>
              Simulates live telemetry — state, battery, Wi-Fi, and per-sensor health flags.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>State</Label>
              <Select
                value={telemetryForm.state}
                onValueChange={(v) => setTelemetryForm((f) => ({ ...f, state: v as DeviceState }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEVICE_STATES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="sim-battery">Battery %</Label>
                <Input
                  id="sim-battery"
                  type="number"
                  min={0}
                  max={100}
                  value={telemetryForm.batteryPct}
                  onChange={(e) =>
                    setTelemetryForm((f) => ({
                      ...f,
                      batteryPct: Number.parseInt(e.target.value, 10) || 0,
                    }))
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sim-wifi">Wi-Fi RSSI</Label>
                <Input
                  id="sim-wifi"
                  type="number"
                  min={-100}
                  max={0}
                  value={telemetryForm.wifiRssi}
                  onChange={(e) =>
                    setTelemetryForm((f) => ({
                      ...f,
                      wifiRssi: Number.parseInt(e.target.value, 10) || -55,
                    }))
                  }
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              RSSI guide: -50 or higher = Strong, -70 = Fair, below -70 = Weak.
            </p>

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="mb-3 text-sm font-medium">Sensor health</p>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ["tof", "Presence (ToF)"],
                    ["mic", "Microphone"],
                    ["light", "Light"],
                    ["temp", "Temperature"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className="grid gap-1.5">
                    <Label>{label}</Label>
                    <Select
                      value={telemetryForm.sensorHealth[key]}
                      onValueChange={(v) =>
                        setTelemetryForm((f) => ({
                          ...f,
                          sensorHealth: {
                            ...f.sensorHealth,
                            [key]: v as SensorHealthStatus,
                          },
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SENSOR_HEALTH.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {(["idle", "work", "break"] as DeviceState[]).map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTelemetryForm((f) => ({ ...f, state: preset }))}
                >
                  {preset}
                </Button>
              ))}
            </div>

            <Button
              className="w-full"
              disabled={telemetryMutation.isPending}
              onClick={() => telemetryMutation.mutate()}
            >
              {telemetryMutation.isPending ? "Sending…" : "Send telemetry"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
