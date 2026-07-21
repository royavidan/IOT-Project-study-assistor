import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { importIcsFn, syncIcsImportFn } from "@/features/schedule/ics.functions";

export interface IcsImport {
  id: string;
  name: string;
  sourceType: "url" | "file";
  sourceUrl: string | null;
  eventCount: number;
  lastSyncedAt: string;
  createdAt: string;
}

export type ImportSource = { type: "url"; url: string } | { type: "file"; text: string };

function mapRow(row: Record<string, unknown>): IcsImport {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    sourceType: row.source_type === "url" ? "url" : "file",
    sourceUrl: row.source_url ? String(row.source_url) : null,
    eventCount: row.event_count == null ? 0 : Number(row.event_count),
    lastSyncedAt: String(row.last_synced_at ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
}

async function fetchImports(): Promise<IcsImport[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("ics_imports")
    .select("id, name, source_type, source_url, event_count, last_synced_at, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
}

async function removeImport(id: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.from("ics_imports").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export function useIcsImports() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["ics-imports", user?.id],
    queryFn: fetchImports,
    enabled: !!user,
  });
}

export function useIcsActions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["ics-imports", user?.id] });
    void queryClient.invalidateQueries({ queryKey: ["schedule-events", user?.id] });
    void queryClient.invalidateQueries({ queryKey: ["courses", user?.id] });
  };

  return {
    importCalendar: useMutation({
      mutationFn: (input: { name?: string; source: ImportSource }) => importIcsFn({ data: input }),
      onSuccess: invalidate,
    }),
    sync: useMutation({
      mutationFn: (importId: string) => syncIcsImportFn({ data: { importId } }),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: removeImport, onSuccess: invalidate }),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Once per session, re-sync any URL import whose last sync was over a day ago.
 * This is the "updates once a day" behavior without a background cron.
 */
export function useAutoSyncStaleImports() {
  const { data } = useIcsImports();
  const { sync } = useIcsActions();
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current || !data) return;
    const now = Date.now();
    const stale = data.filter(
      (i) =>
        i.sourceType === "url" &&
        i.lastSyncedAt &&
        now - new Date(i.lastSyncedAt).getTime() > DAY_MS,
    );
    if (stale.length === 0) return;
    ranRef.current = true;
    for (const imp of stale) sync.mutate(imp.id);
  }, [data, sync]);
}
