import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { StateBadge } from "@/components/StateBadge";
import { ErrorState, LoadingState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/auth-context";
import { useDeviceStatus } from "@/lib/queries/sessions";
import { useMyDevice, type MyDevice } from "@/features/device/queries";
import { useSettings } from "@/lib/queries/settings";
import {
  claimDeviceByCode,
  createTestPairingCode,
  renameDevice,
  unlinkDevice,
} from "@/features/device/pairing.functions";
import { summarizeSensorHealth } from "@/features/device/sensor-health";
import { deriveDeviceFreshness } from "@/features/device/freshness";
import { LowBatteryBanner } from "@/components/LowBatteryBanner";
import { BluetoothConnectCard } from "@/features/device/components/BluetoothConnectCard";
import { PairingCodeInput } from "@/features/device/components/PairingCodeInput";
import { RemoteControlCard } from "@/features/device/components/RemoteControlCard";
import { BATTERY_TRACKING_ENABLED } from "@/lib/feature-flags";
import {
  Battery,
  Wifi,
  AlertTriangle,
  CheckCircle2,
  User,
  Thermometer,
  Droplets,
  Sun,
  Volume2,
} from "lucide-react";

export const Route = createFileRoute("/device")({
  head: () => ({ meta: [{ title: "Device Setup — MindBox" }] }),
  // Support a deep link / QR like /device?code=123456 — the code pre-fills (and
  // auto-submits) the pairing form so a phone never has to type it.
  validateSearch: (search: Record<string, unknown>): { code?: string } => {
    const code = typeof search.code === "string" ? search.code.replace(/\D/g, "").slice(0, 6) : "";
    return code ? { code } : {};
  },
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
    body: "Join the “MindBox_Setup” Wi-Fi from your phone, then pick your home network in the page that opens automatically. On iPhone: Settings → Wi-Fi. On Android: Settings → Network & internet → Wi-Fi.",
  },
  {
    n: 3,
    title: "Pair this app",
    body: "Type the 6-digit code shown on the device screen into the boxes below — or scan its QR code to fill it in automatically.",
  },
];

function formatAccountLabel(displayName: string | undefined, email: string | undefined): string {
  const name = displayName?.trim();
  const mail = email?.trim();
  if (name && mail) return `${name} (${mail})`;
  return name || mail || "Signed in";
}

function Device() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: settings } = useSettings();
  const accountLabel = useMemo(
    () => formatAccountLabel(settings?.displayName, user?.email ?? undefined),
    [settings?.displayName, user?.email],
  );
  const { data: status, isLoading, isError, error, refetch } = useDeviceStatus();

  // Freshness is a function of wall-clock time, but react-query only re-renders
  // when data CHANGES — and a silent device stops changing updated_at. Tick so
  // "Online" actually decays to "Last seen …".
  const [freshnessNow, setFreshnessNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setFreshnessNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error" | "info">("success");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["device-status"] });
    void queryClient.invalidateQueries({ queryKey: ["my-device"] });
    void queryClient.invalidateQueries({ queryKey: ["simulator-device"] });
  };

  const { data: myDevice } = useMyDevice();
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const unlinkMutation = useMutation({
    mutationFn: () => unlinkDevice(),
    onSuccess: () => {
      setMessageKind("success");
      setMessage(
        "Signed out. Your MindBox returns to its pairing screen and stops syncing shortly.",
      );
      if (user?.id) {
        queryClient.setQueryData<MyDevice | null>(["my-device", user.id], null);
      }
      invalidate();
    },
    onError: (err) => {
      setMessageKind("error");
      setMessage(err instanceof Error ? err.message : "Could not sign out the device.");
    },
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => renameDevice({ data: { deviceId: myDevice?.id ?? "", name } }),
    onSuccess: () => {
      setRenaming(false);
      invalidate();
    },
    onError: (err) => {
      setMessageKind("error");
      setMessage(err instanceof Error ? err.message : "Could not rename the device.");
    },
  });

  const claimMutation = useMutation({
    mutationFn: (c: string) => claimDeviceByCode({ data: { code: c } }),
    onSuccess: (result) => {
      const linked: MyDevice = {
        id: result.deviceId,
        name: result.name,
        firmwareVersion: result.firmwareVersion,
        pairedAt: result.pairedAt,
      };
      if (user?.id) {
        queryClient.setQueryData<MyDevice | null>(["my-device", user.id], linked);
      }
      setMessageKind("success");
      setMessage(`Paired with ${result.name}. Your sessions will now sync to this app.`);
      setCode("");
      void queryClient.invalidateQueries({ queryKey: ["device-status", user?.id] });
      void queryClient.refetchQueries({ queryKey: ["my-device", user?.id] });
      void refetch();
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

  const submitCode = useCallback(
    (raw: string) => {
      setMessage(null);
      const trimmed = raw.trim();
      if (!/^\d{6}$/.test(trimmed)) {
        setMessageKind("error");
        setMessage("Enter the 6-digit code shown on your MindBox.");
        return;
      }
      claimMutation.mutate(trimmed);
    },
    [claimMutation],
  );

  const onPair = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitCode(code);
  };

  // Deep link / QR support: /device?code=123456 fills the field and pairs once.
  const search = Route.useSearch();
  const deepLinkRan = useRef(false);
  useEffect(() => {
    if (deepLinkRan.current || myDevice) return;
    const c = (search.code ?? "").replace(/\D/g, "").slice(0, 6);
    if (c.length === 6) {
      deepLinkRan.current = true;
      setCode(c);
      submitCode(c);
    }
  }, [search.code, myDevice, submitCode]);

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
          {user && (
            <p className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
              <User className="h-4 w-4 shrink-0" aria-hidden />
              <span>
                Signed in as <span className="font-medium text-foreground">{accountLabel}</span>
              </span>
            </p>
          )}
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
              {myDevice && (
                <div
                  className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success"
                  role="status"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    <span className="font-medium">{myDevice.name}</span> linked to{" "}
                    <span className="font-medium">{accountLabel}</span>
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-4">
                <StateBadge state={status.state} battery={status.battery} />
                {(() => {
                  const fresh = deriveDeviceFreshness(status.updatedAt, freshnessNow);
                  return (
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <span
                        aria-hidden
                        className={`h-2 w-2 rounded-full ${
                          fresh.online ? "bg-success" : "bg-muted-foreground/40"
                        }`}
                      />
                      {fresh.label}
                    </span>
                  );
                })()}
                {BATTERY_TRACKING_ENABLED && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Battery className="h-4 w-4" aria-hidden />
                    {status.battery > 0 ? `${status.battery}%` : "No reading"}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Wifi className="h-4 w-4" aria-hidden />
                  {status.wifi}
                </span>
                {status.firmwareVersion && (
                  <span className="text-sm text-muted-foreground">FW {status.firmwareVersion}</span>
                )}
              </div>

              {status.room && (
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Room right now</p>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <Thermometer className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      {status.room.tempC != null ? `${Math.round(status.room.tempC)}°C` : "—"}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Droplets className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      {status.room.humidityPct != null
                        ? `${Math.round(status.room.humidityPct)}%`
                        : "—"}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Sun className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      {status.room.lightLux != null
                        ? `${Math.round(status.room.lightLux)} lux`
                        : "—"}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Volume2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      {status.room.noiseDb != null ? `${Math.round(status.room.noiseDb)} dB` : "—"}
                    </span>
                  </div>
                </div>
              )}

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

              {myDevice && status.battery === 0 && status.state === "idle" && (
                <p className="w-full text-sm text-muted-foreground" role="status">
                  Account linked — waiting for your MindBox to check in (usually within a few
                  seconds).
                </p>
              )}
              {!myDevice && status.battery === 0 && status.state === "idle" && (
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

      {myDevice && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Your MindBox</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {renaming ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = nameInput.trim();
                  if (n) renameMutation.mutate(n);
                }}
                className="flex flex-wrap items-end gap-2"
              >
                <div className="grid gap-1.5">
                  <Label htmlFor="device-name">Device name</Label>
                  <Input
                    id="device-name"
                    value={nameInput}
                    maxLength={40}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="max-w-xs"
                  />
                </div>
                <Button type="submit" size="sm" disabled={renameMutation.isPending}>
                  {renameMutation.isPending ? "Saving…" : "Save"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{myDevice.name}</p>
                  {myDevice.firmwareVersion && (
                    <p className="text-xs text-muted-foreground">
                      Firmware {myDevice.firmwareVersion}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setNameInput(myDevice.name);
                      setRenaming(true);
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={unlinkMutation.isPending}
                    onClick={() => unlinkMutation.mutate()}
                  >
                    {unlinkMutation.isPending ? "Signing out…" : "Unlink / Sign out"}
                  </Button>
                </div>
              </div>
            )}
            {message && (
              <p
                role="status"
                className={`text-sm ${messageKind === "error" ? "text-danger" : "text-success"}`}
              >
                {message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Signing out releases this MindBox from your account — it returns to its pairing screen
              and stops syncing your sessions. Re-pair anytime with a new code.
            </p>
          </CardContent>
        </Card>
      )}

      {myDevice && <RemoteControlCard deviceId={myDevice.id} />}

      {!myDevice && (
        <>
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
              {user && (
                <p className="text-sm text-muted-foreground">
                  Pairing links your MindBox to{" "}
                  <span className="font-medium text-foreground">{accountLabel}</span>.
                </p>
              )}
              <form onSubmit={onPair} className="space-y-3">
                <div className="grid gap-1.5">
                  <Label>6-digit code</Label>
                  <PairingCodeInput
                    value={code}
                    onChange={setCode}
                    onComplete={submitCode}
                    disabled={claimMutation.isPending}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={claimMutation.isPending}
                  className="w-full sm:w-auto"
                >
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

          <BluetoothConnectCard onPairingCode={setCode} />
        </>
      )}
    </>
  );
}
