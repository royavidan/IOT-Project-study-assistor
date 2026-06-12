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
