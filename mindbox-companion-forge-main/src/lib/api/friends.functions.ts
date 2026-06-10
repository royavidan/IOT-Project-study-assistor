import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase/server";
import { sendFriendAcceptedEmail, sendFriendRequestEmail } from "@/lib/email/friend-notify.server";

const sendInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
});

const respondInput = z.object({
  friendId: z.string().uuid(),
  accept: z.boolean(),
});

type ProfileRow = { id: string; display_name: string | null; email: string | null };

async function requireUser() {
  const supabase = getSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw new Error(`Unable to verify session: ${error.message}`);
  if (!user) throw new Error("You must be signed in.");
  return { user, supabase };
}

async function profileById(id: string): Promise<ProfileRow | null> {
  const { data } = await getSupabaseAdminClient()
    .from("profiles")
    .select("id, display_name, email")
    .eq("id", id)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

function nameFor(p: ProfileRow | null, fallback: string): string {
  return p?.display_name?.trim() || p?.email?.trim() || fallback;
}

/**
 * Send a friend request to an existing MindBox user and email them a friendly
 * heads-up. Lookup + duplicate-check + insert run server-side because resolving
 * the friend's email and sending mail need the service-role client.
 */
export const sendFriendRequestFn = createServerFn({ method: "POST" })
  .validator(sendInput)
  .handler(async ({ data }) => {
    const { user, supabase } = await requireUser();
    const admin = getSupabaseAdminClient();
    const email = data.email;

    const { data: targetRow, error: lookupError } = await admin
      .from("profiles")
      .select("id, display_name, email")
      .ilike("email", email)
      .maybeSingle();
    if (lookupError) throw new Error(`Could not look up that user: ${lookupError.message}`);

    const target = targetRow as ProfileRow | null;
    if (!target?.id) {
      throw new Error("No MindBox user found with that email. They need an account first.");
    }
    if (target.id === user.id) throw new Error("You can't add yourself.");

    // Surface an existing relationship (either direction) instead of duplicating.
    const { data: existingRows, error: existingError } = await admin
      .from("friendships")
      .select("user_id, friend_id, status")
      .or(
        `and(user_id.eq.${user.id},friend_id.eq.${target.id}),and(user_id.eq.${target.id},friend_id.eq.${user.id})`,
      );
    if (existingError)
      throw new Error(`Could not check existing friends: ${existingError.message}`);

    const existing = (existingRows ?? [])[0] as
      | { user_id: string; friend_id: string; status: string }
      | undefined;
    if (existing) {
      if (existing.status === "accepted") throw new Error("You're already friends.");
      if (existing.user_id === target.id) {
        throw new Error("They already sent you a request — accept it from your Friends page.");
      }
      throw new Error("Request already sent and pending.");
    }

    // Insert as the signed-in user (respects RLS: user_id must equal auth.uid()).
    const { error: insertError } = await supabase
      .from("friendships")
      .insert({ user_id: user.id, friend_id: target.id, status: "pending" });
    if (insertError) throw new Error(insertError.message);

    // Resolve the recipient's email — fall back to the auth record if the
    // profile row has none, so we never silently skip the notification.
    let recipientEmail = (target.email ?? "").trim();
    if (!recipientEmail) {
      const { data: authUser } = await admin.auth.admin.getUserById(target.id);
      recipientEmail = (authUser?.user?.email ?? "").trim();
    }

    const me = await profileById(user.id);
    let emailSent = false;
    let emailReason: string | null = null;
    if (!recipientEmail) {
      emailReason = "That user has no email address on file.";
    } else {
      try {
        const result = await sendFriendRequestEmail({
          toEmail: recipientEmail,
          toName: target.display_name,
          fromName: nameFor(me, user.email ?? "A MindBox user"),
        });
        emailSent = result.sent;
        if (!result.sent) emailReason = result.reason;
      } catch (e) {
        emailReason = e instanceof Error ? e.message : "Email send failed.";
      }
    }

    return { displayName: nameFor(target, email), emailSent, emailReason };
  });

/**
 * Accept or decline an incoming friend request. On accept, email the original
 * requester that you accepted. Decline just removes the pending row.
 */
export const respondToFriendRequestFn = createServerFn({ method: "POST" })
  .validator(respondInput)
  .handler(async ({ data }) => {
    const { user, supabase } = await requireUser();

    if (!data.accept) {
      const { error } = await supabase
        .from("friendships")
        .delete()
        .eq("user_id", data.friendId)
        .eq("friend_id", user.id);
      if (error) throw new Error(error.message);
      return { ok: true as const, emailSent: false };
    }

    const { error } = await supabase
      .from("friendships")
      .update({ status: "accepted" })
      .eq("user_id", data.friendId)
      .eq("friend_id", user.id);
    if (error) throw new Error(error.message);

    const [requester, me] = await Promise.all([profileById(data.friendId), profileById(user.id)]);

    let emailSent = false;
    if (requester?.email) {
      const result = await sendFriendAcceptedEmail({
        toEmail: requester.email,
        toName: requester.display_name,
        accepterName: nameFor(me, user.email ?? "Your friend"),
      });
      emailSent = result.sent;
    }

    return { ok: true as const, emailSent };
  });
