// Web Bluetooth client (browser-only).
//
// SUPPORT / LIMITATIONS — read before relying on this:
//  - navigator.bluetooth works in Chrome/Edge on desktop and Chrome on Android.
//  - It is NOT available on iOS/iPadOS (any browser — Apple blocks it), nor in
//    Firefox or desktop Safari. Those users must use Wi-Fi + code pairing.
//  - Requires a secure context (HTTPS or localhost) and a user gesture
//    (call connect from a click handler).
//  - This only works once the ESP32 firmware exposes the GATT profile below.
//
// ───────────────────────────────────────────────────────────────────────────
// GATT CONTRACT (firmware must implement this exact profile)
//
//  Primary service:  MINDBOX_GATT.service
//  Characteristics (all UTF-8 strings):
//    deviceInfo   (read)          JSON: { "deviceId": string, "firmwareVersion": string }
//    pairingCode  (read)          the 6-digit code as a string, e.g. "482915"
//                                 (lets the app claim the device via the existing flow)
//    telemetry    (read | notify) JSON: { "state": string, "batteryPct": number,
//                                          "wifiRssi": number, "sensorHealth": object }
//    wifiConfig   (write)         JSON: { "ssid": string, "password": string }
//                                 (optional alternative to the captive-portal setup)
// ───────────────────────────────────────────────────────────────────────────

export const MINDBOX_GATT = {
  service: "7a9b0000-3c2d-4e1f-8a6b-0c1d2e3f4a50",
  deviceInfo: "7a9b0001-3c2d-4e1f-8a6b-0c1d2e3f4a50",
  pairingCode: "7a9b0002-3c2d-4e1f-8a6b-0c1d2e3f4a50",
  telemetry: "7a9b0003-3c2d-4e1f-8a6b-0c1d2e3f4a50",
  wifiConfig: "7a9b0004-3c2d-4e1f-8a6b-0c1d2e3f4a50",
} as const;

// --- Minimal Web Bluetooth types -------------------------------------------
// The standard TS DOM lib doesn't always ship Web Bluetooth types, so we model
// only the slice we use (and avoid `any`).

interface GattCharacteristicLite {
  readValue(): Promise<DataView>;
  writeValue(value: BufferSource): Promise<void>;
}
interface GattServiceLite {
  getCharacteristic(uuid: string): Promise<GattCharacteristicLite>;
}
interface GattServerLite {
  connect(): Promise<GattServerLite>;
  getPrimaryService(uuid: string): Promise<GattServiceLite>;
  disconnect(): void;
}
interface BluetoothDeviceLite {
  id?: string;
  name?: string;
  gatt?: GattServerLite;
}
interface BluetoothLite {
  requestDevice(options: unknown): Promise<BluetoothDeviceLite>;
}

function getBluetooth(): BluetoothLite | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { bluetooth?: BluetoothLite };
  return nav.bluetooth ?? null;
}

/** True when this browser can talk to BLE devices (Chrome desktop / Android). */
export function isWebBluetoothSupported(): boolean {
  return getBluetooth() !== null;
}

export interface MindBoxBleInfo {
  deviceId: string;
  firmwareVersion: string;
  /** The 6-digit pairing code, if the device exposes it. */
  pairingCode: string | null;
}

async function readJson(
  service: GattServiceLite,
  uuid: string,
  decoder: TextDecoder,
): Promise<Record<string, unknown>> {
  const ch = await service.getCharacteristic(uuid);
  const view = await ch.readValue();
  try {
    return JSON.parse(decoder.decode(view)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Opens the browser's device chooser, connects to a MindBox over BLE, and reads
 * its identity + pairing code per the GATT contract above. Must be called from
 * a user gesture. Throws a friendly error if Bluetooth is unavailable.
 */
export async function connectMindBoxOverBluetooth(): Promise<MindBoxBleInfo> {
  const bt = getBluetooth();
  if (!bt) {
    throw new Error(
      "Web Bluetooth isn't available in this browser. On iPhone/iPad, or in Firefox/Safari, " +
        "use Wi-Fi + code pairing instead.",
    );
  }

  const device = await bt.requestDevice({
    filters: [{ services: [MINDBOX_GATT.service] }],
    optionalServices: [MINDBOX_GATT.service],
  });
  if (!device.gatt) throw new Error("Selected device doesn't expose a GATT server.");

  const server = await device.gatt.connect();
  try {
    const service = await server.getPrimaryService(MINDBOX_GATT.service);
    const decoder = new TextDecoder();

    const info = await readJson(service, MINDBOX_GATT.deviceInfo, decoder);

    let pairingCode: string | null = null;
    try {
      const codeCh = await service.getCharacteristic(MINDBOX_GATT.pairingCode);
      pairingCode = decoder.decode(await codeCh.readValue()).trim() || null;
    } catch {
      // Optional characteristic — device may not expose a code over BLE.
    }

    return {
      deviceId: String(info.deviceId ?? device.id ?? "mindbox"),
      firmwareVersion: String(info.firmwareVersion ?? "unknown"),
      pairingCode,
    };
  } finally {
    // Reading is one-shot here; drop the link so we don't hold the radio.
    server.disconnect();
  }
}
