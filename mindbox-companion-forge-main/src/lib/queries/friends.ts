import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { respondToFriendRequestFn, sendFriendRequestFn } from "@/lib/api/friends.functions";

export interface Friend {
  friendId: string;
  displayName: string;
  email: string;
  /** 'pending' | 'accepted' (the friendships.status column). */
  status: string;
  /** 'outgoing' = you sent the request, 'incoming' = you received it. */
  direction: "outgoing" | "incoming";
}

async function currentUserId(): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");
  return user.id;
}

async function fetchFriends(): Promise<Friend[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("get_friends");
  if (error) throw new Error(error.message);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    friendId: String(row.friend_id ?? ""),
    displayName: String(row.display_name ?? "Unknown"),
    email: String(row.email ?? ""),
    status: String(row.status ?? "pending"),
    direction: row.direction === "incoming" ? "incoming" : "outgoing",
  }));
}

export function useFriends() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["friends", user?.id],
    queryFn: fetchFriends,
    enabled: !!user,
  });
}

async function sendFriendRequest(
  email: string,
): Promise<{ displayName: string; emailSent: boolean; emailReason: string | null }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("Enter an email address.");
  // Lookup, duplicate-check, insert, and the recipient's notification email all
  // run server-side (resolving the friend's email + sending mail need the
  // service role). See src/lib/api/friends.functions.ts.
  const result = await sendFriendRequestFn({ data: { email: normalized } });
  return {
    displayName: result.displayName,
    emailSent: result.emailSent,
    emailReason: result.emailReason ?? null,
  };
}

async function respondToRequest(input: { friendId: string; accept: boolean }): Promise<void> {
  // Accept/decline + the "accepted" notification email run server-side.
  await respondToFriendRequestFn({ data: input });
}

async function removeFriend(friendId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const me = await currentUserId();
  // Friendship may be stored in either direction — clear both.
  const { error } = await supabase
    .from("friendships")
    .delete()
    .or(
      `and(user_id.eq.${me},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${me})`,
    );
  if (error) throw new Error(error.message);
}

export function useFriendActions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["friends", user?.id] });
    void queryClient.invalidateQueries({ queryKey: ["leaderboard", user?.id] });
  };

  return {
    send: useMutation({ mutationFn: sendFriendRequest, onSuccess: invalidate }),
    respond: useMutation({ mutationFn: respondToRequest, onSuccess: invalidate }),
    remove: useMutation({ mutationFn: removeFriend, onSuccess: invalidate }),
  };
}
