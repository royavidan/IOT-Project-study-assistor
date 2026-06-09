import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

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

async function sendFriendRequest(email: string): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const me = await currentUserId();
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error("Enter an email address.");

  const { data: match, error: lookupError } = await supabase.rpc("find_profile_by_email", {
    p_email: normalized,
  });
  if (lookupError) throw new Error(lookupError.message);

  const profile = ((match ?? []) as Record<string, unknown>[])[0];
  if (!profile?.id) {
    throw new Error("No MindBox user found with that email. They need an account first.");
  }
  const friendId = String(profile.id);
  if (friendId === me) throw new Error("You can't add yourself.");

  // If a relationship already exists (either direction), surface it instead of
  // inserting a duplicate.
  const existing = (await fetchFriends()).find((f) => f.friendId === friendId);
  if (existing) {
    if (existing.status === "accepted") throw new Error("You're already friends.");
    if (existing.direction === "incoming") {
      throw new Error("They already sent you a request — accept it below instead.");
    }
    throw new Error("Request already sent and pending.");
  }

  const { error } = await supabase
    .from("friendships")
    .insert({ user_id: me, friend_id: friendId, status: "pending" });
  if (error) throw new Error(error.message);

  return String(profile.display_name ?? normalized);
}

async function respondToRequest(input: { friendId: string; accept: boolean }): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const me = await currentUserId();

  if (input.accept) {
    const { error } = await supabase
      .from("friendships")
      .update({ status: "accepted" })
      .eq("user_id", input.friendId)
      .eq("friend_id", me);
    if (error) throw new Error(error.message);
    return;
  }

  // Decline = remove the incoming request row.
  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("user_id", input.friendId)
    .eq("friend_id", me);
  if (error) throw new Error(error.message);
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
