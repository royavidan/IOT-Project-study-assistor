import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { StateBadge } from "@/components/StateBadge";
import { ErrorState, LoadingState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDeviceStatus } from "@/lib/queries/sessions";
import { claimDeviceByCode, createTestPairingCode } from "@/lib/api/pairing.functions";
import { summarizeSensorHealth } from "@/lib/sensor-health";
import { LowBatteryBanner } from "@/components/LowBatteryBanner";
import { Battery, Wifi, AlertTriangle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/device")({
  head: () => ({ meta: [{ title: "Device Setup — MindBox" }] }),
  component: Device,
});

const steps = [
  {
    n: 1,
    title: "Power on",
    body: "Hold the side button for 3 seconds until the ring pulses blue.",
  },
  {
    n: 2,
    title: "Connect Wi-Fi",
    body: "Join the 'MindBox_Setup' Wi-Fi network from your phone and pick your home network in the captive portal.",
  },
  {
    n: 3,
    title: "Pair this app",
    body: "Enter the 6-digit code the device shows on its OLED into the form below.",
  },
];

function Device() {
  const queryClient = useQueryClient();
  const { data: status, isLoading, isError, error, refetch } = useDeviceStatus();

  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error" | "info">("success");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["device-status"] });
    void queryClient.invalidateQueries({ queryKey: ["simulator-device"] });
  };

  const claimMutation = useMutation({
    mutationFn: (c: string) => claimDeviceByCode({ data: { code: c } }),
    onSuccess: (result) => {
      setMessageKind("success");
      setMessage(`Paired with ${result.name}. Your sessions will now sync to this app.`);
      setCode("");
      invalidate();
    },
    onError: (err) => {
      setMessageKind("error");
      setMessage(err instanceof Error ? err.message : "Could not pair device.");
    },
  });

  const testCodeMutation = useMutation({
    mutationFn: () => createTestPairingCode(),
    onSuccess: (result) => {
      setCode(result.code);
      setMessageKind("info");
      setMessage(
        `Test code ${result.code} generated (no hardware needed). Click “Pair device” to claim it.`,
      );
    },
    onError: (err) => {
      setMessageKind("error");
      setMessage(err instanceof Error ? err.message : "Could not create a test code.");
    },
  });

  const onPair = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setMessageKind("error");
      setMessage("Enter the 6-digit code shown on your MindBox.");
      return;
    }
    claimMutation.mutate(trimmed);
  };

  return (
    <>
      <PageHeader
        title="Device setup"
        description="Pair your MindBox in under a minute."
        actions={status ? <StateBadge state={status.state} battery={status.battery} /> : undefined}
      />

      {!isLoading && !isError && status && status.battery > 0 && status.battery < 15 && (
        <LowBatteryBanner battery={status.battery} />
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <LoadingState label="Checking device…" />}
          {isError && (
            <ErrorState
              title="Could not load device status"
              description={error instanceof Error ? error.message : undefined}
              onRetry={() => void refetch()}
            />
          )}
          {!isLoading && !isError && status && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <StateBadge state={status.state} battery={status.battery} />
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Battery className="h-4 w-4" aria-hidden />
                  {status.battery > 0 ? `${status.battery}%` : "No reading"}
                </span>
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Wifi className="h-4 w-4" aria-hidden />
                  {status.wifi}
                </span>
              </div>

              {(() => {
                const health = summarizeSensorHealth(status.sensorHealth);
                if (!health.hasData) return null;
                return (
                  <div className="rounded-lg border border-border bg-muted/20 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Sensor health</p>
                    {health.fault.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {health.fault.map((s) => (
                          <li key={s.key} className="flex items-center gap-2 text-sm text-danger">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span>
                              {s.label}: <span className="font-medium">{s.status}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {health.ok.length > 0 && (
                      <ul className={`space-y-1 ${health.fault.length > 0 ? "mt-2" : "mt-2"}`}>
                        {health.ok.map((s) => (
                          <li
                            key={s.key}
                            className="flex items-center gap-2 text-sm text-muted-foreground"
                          >
                            <CheckCircle2
                              className="h-3.5 w-3.5 shrink-0 text-success"
                              aria-hidden
                            />
                            <span>
                              {s.label}: {s.status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })()}

              {status.battery === 0 && status.state === "idle" && (
                <p className="w-full text-sm text-muted-foreground">
                  No paired device found. Complete the steps below to connect your MindBox, or{" "}
                  <Link
                    to="/simulator"
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    use the simulator
                  </Link>{" "}
                  to log data manually.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.n}>
            <Card>
              <CardContent className="flex items-start gap-4 p-5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sync-muted text-sm font-semibold text-sync">
                  {s.n}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-semibold">{s.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Pair with a code</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onPair} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="pair-code">6-digit code</Label>
              <Input
                id="pair-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-[160px] font-mono tracking-widest"
              />
            </div>
            <Button type="submit" disabled={claimMutation.isPending}>
              {claimMutation.isPending ? "Pairing…" : "Pair device"}
            </Button>
          </form>

          {message && (
            <p
              role="status"
              className={`text-sm ${
                messageKind === "error"
                  ? "text-danger"
                  : messageKind === "info"
                    ? "text-sync"
                    : "text-success"
              }`}
            >
              {message}
            </p>
          )}

          <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              No hardware yet? Generate a one-time test code to try the pairing flow end-to-end.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              disabled={testCodeMutation.isPending}
              onClick={() => testCodeMutation.mutate()}
            >
              {testCodeMutation.isPending ? "Generating…" : "Generate a test code"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
