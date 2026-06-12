import { useEffect, useState } from "react";
import { Bluetooth, BluetoothOff } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  connectMindBoxOverBluetooth,
  isWebBluetoothSupported,
  type MindBoxBleInfo,
} from "@/features/device/web-bluetooth";

/**
 * Optional BLE pairing entry point. Feature-detects Web Bluetooth and degrades
 * gracefully where it's unavailable (iOS, Firefox, Safari). When the device
 * exposes a pairing code over BLE, it's handed back via `onPairingCode` to fill
 * the existing claim form.
 */
export function BluetoothConnectCard({
  onPairingCode,
}: {
  onPairingCode?: (code: string) => void;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [info, setInfo] = useState<MindBoxBleInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Detect after mount — navigator isn't available during SSR.
  useEffect(() => setSupported(isWebBluetoothSupported()), []);

  const connect = async () => {
    setError(null);
    setConnecting(true);
    try {
      const result = await connectMindBoxOverBluetooth();
      setInfo(result);
      if (result.pairingCode) onPairingCode?.(result.pairingCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bluetooth connection failed.");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader className="flex-row items-center gap-2">
        <Bluetooth className="h-4 w-4 text-sync" aria-hidden />
        <CardTitle className="text-base">Connect via Bluetooth (beta)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {supported === false ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <BluetoothOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            This browser doesn't support Web Bluetooth. It works in Chrome/Edge on desktop and
            Chrome on Android — on iPhone/iPad, Firefox or Safari, use the 6-digit code method
            above.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Pair over Bluetooth Low Energy — no Wi-Fi needed. Requires MindBox firmware with
              Bluetooth support.
            </p>
            <Button
              type="button"
              onClick={() => void connect()}
              disabled={connecting || supported === null}
            >
              <Bluetooth className="h-4 w-4" />
              {connecting ? "Connecting…" : "Connect via Bluetooth"}
            </Button>
            {info && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Connected to {info.deviceId}</p>
                <p className="text-muted-foreground">Firmware {info.firmwareVersion}</p>
                {info.pairingCode ? (
                  <p className="mt-1 text-success">
                    Pairing code {info.pairingCode} filled in above — tap “Pair device”.
                  </p>
                ) : (
                  <p className="mt-1 text-muted-foreground">
                    No pairing code exposed by this device.
                  </p>
                )}
              </div>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
