import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ExternalLoadEntry } from "@/lib/wellbeing";

export type ExternalLoad = ExternalLoadEntry & { id: string };

export interface AddExternalLoadInput {
  label: string;
  kind: "weekly" | "dated";
  hours: number;
  date?: string | null;
}

async function fetchExternalLoads(): Promise<ExternalLoad[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("external_loads")
    .select("id, label, kind, hours, date")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    label: String(r.label ?? ""),
    kind: r.kind === "dated" ? "dated" : "weekly",
    hours: Number(r.hours ?? 0),
    date: r.date ? String(r.date) : null,
  }));
}

async function addExternalLoad(input: AddExternalLoadInput): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");

  const hours = Math.max(0, Number(input.hours) || 0);
  if (hours <= 0) throw new Error("Enter how many hours of load this adds.");
  if (input.kind === "dated" && !input.date) throw new Error("Pick a date for this commitment.");

  const { error } = await supabase.from("external_loads").insert({
    user_id: user.id,
    label: input.label.trim() || (input.kind === "dated" ? "Commitment" : "Weekly load"),
    kind: input.kind,
    hours,
    date: input.kind === "dated" ? input.date : null,
  });
  if (error) throw new Error(error.message);
}

async function removeExternalLoad(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("external_loads").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export function useExternalLoads() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["external-loads", user?.id],
    queryFn: fetchExternalLoads,
    enabled: !!user,
  });
}

export function useExternalLoadActions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["external-loads", user?.id] });
  };
  return {
    add: useMutation({ mutationFn: addExternalLoad, onSuccess: invalidate }),
    remove: useMutation({ mutationFn: removeExternalLoad, onSuccess: invalidate }),
  };
}
