import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { LeaderboardEntry } from "@/lib/types";

async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_leaderboard");

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      rank: Number(r.rank),
      display_name: String(r.display_name ?? "Unknown"),
      minutes_this_week: Number(r.minutes_this_week ?? 0),
      streak: Number(r.streak ?? 0),
      is_you: Boolean(r.is_you),
    };
  });
}

export function useLeaderboard() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["leaderboard", user?.id],
    queryFn: fetchLeaderboard,
    enabled: !!user,
    refetchOnWindowFocus: true,
  });
}
