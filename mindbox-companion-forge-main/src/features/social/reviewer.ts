import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface ReviewerStudent {
  ownerUserId: string;
  displayName: string;
  email: string;
}

async function fetchReviewerStudents(): Promise<ReviewerStudent[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_reviewer_students");
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      ownerUserId: String(r.owner_user_id ?? ""),
      displayName: String(r.display_name ?? r.email ?? "Student"),
      email: String(r.email ?? ""),
    };
  });
}

export function useReviewerStudents() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["reviewer-students", user?.id],
    queryFn: fetchReviewerStudents,
    enabled: !!user,
  });
}
