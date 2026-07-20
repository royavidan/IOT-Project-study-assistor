import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface MyDevice {
  id: string;
  name: string;
  firmwareVersion: string | null;
  pairedAt: string | null;
}

/** The MindBox currently linked to the signed-in account (RLS scopes to the owner). */
async function fetchMyDevice(): Promise<MyDevice | null> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("devices")
    .select("id, name, firmware_version, paired_at")
    .eq("owner_user_id", user.id)
    .order("paired_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const d = data as Record<string, unknown>;
  return {
    id: String(d.id),
    name: String(d.name ?? "MindBox"),
    firmwareVersion: d.firmware_version ? String(d.firmware_version) : null,
    pairedAt: d.paired_at ? String(d.paired_at) : null,
  };
}

export function useMyDevice() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-device", user?.id],
    queryFn: fetchMyDevice,
    enabled: !!user,
    refetchInterval: 5000, // reflect a device-initiated sign-out within ~5s
  });
}

// --- Remote commands (read side; enqueue lives in commands.functions.ts) ---

/** Mirrors the serve-side expiry in ingest.server.ts. */
const COMMAND_EXPIRY_MS = 10 * 60_000;

export type DeviceCommandPhase = "queued" | "sent" | "done" | "expired";

export interface RecentDeviceCommand {
  id: number;
  type: string;
  arg: number | null;
  text: string | null;
  createdAt: string;
  /** Queued -> (served: put in a config response) -> (delivered: box acked). */
  phase: DeviceCommandPhase;
}

function commandPhase(row: {
  created_at: string;
  served_at: string | null;
  delivered_at: string | null;
}): DeviceCommandPhase {
  if (row.delivered_at) return "done";
  if (Date.now() - Date.parse(row.created_at) > COMMAND_EXPIRY_MS) return "expired";
  if (row.served_at) return "sent";
  return "queued";
}

/** Last few commands for the /device card (RLS: SELECT-only policy, own rows). */
export function useRecentDeviceCommands(deviceId: string | null | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["device-commands", deviceId],
    enabled: !!user && !!deviceId,
    refetchInterval: 5000, // watch Queued -> Sent -> Done progress live
    queryFn: async (): Promise<RecentDeviceCommand[]> => {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from("device_commands")
        .select("id, type, arg, text, created_at, served_at, delivered_at")
        .eq("device_id", deviceId!)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: Number(r.id),
        type: String(r.type),
        arg: r.arg == null ? null : Number(r.arg),
        text: r.text == null ? null : String(r.text),
        createdAt: String(r.created_at),
        phase: commandPhase({
          created_at: String(r.created_at),
          served_at: r.served_at ? String(r.served_at) : null,
          delivered_at: r.delivered_at ? String(r.delivered_at) : null,
        }),
      }));
    },
  });
}
