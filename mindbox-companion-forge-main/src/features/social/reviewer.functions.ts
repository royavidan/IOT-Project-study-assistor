import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { z } from "zod";

import { getServerConfig } from "@/lib/config.server";
import { sendReviewerInviteEmail } from "@/features/social/reviewer-invite.server";
import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase/server";

const reviewerInviteInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

const revokeInviteInput = z.object({
  id: z.string().uuid(),
});

const acceptInviteInput = z.object({
  token: z.string().trim().min(1),
});

function requireUser() {
  return getSupabaseServerClient().auth.getUser();
}

function getAppBaseUrl() {
  const { appBaseUrl } = getServerConfig();
  if (appBaseUrl) return appBaseUrl.replace(/\/$/, "");
  return getRequestUrl().origin.replace(/\/$/, "");
}

function isMissingSessionError(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) return false;
  const message = String(error.message ?? "");
  return /auth session missing/i.test(message);
}

function toReadableReviewerError(error: { message?: string } | null, fallback: string) {
  const message = error?.message ?? "";
  if (message.includes("Could not find the table 'public.reviewer_grants' in the schema cache")) {
    return new Error(
      "Reviewer database tables are not installed in Supabase yet. Run supabase/migrations/0001_init.sql in the Supabase SQL Editor, then run: NOTIFY pgrst, 'reload schema';",
    );
  }
  if (message) return new Error(fallback + message);
  return new Error(fallback + "Unknown error.");
}

export const createReviewerInvite = createServerFn({ method: "POST" })
  .validator(reviewerInviteInput)
  .handler(async ({ data }) => {
    const {
      data: { user },
      error: userError,
    } = await requireUser();

    if (userError && !isMissingSessionError(userError)) {
      throw new Error(`Unable to verify user session: ${userError.message}`);
    }
    if (!user) throw new Error("You must be signed in to invite a reviewer.");

    const expiresInDays = data.expiresInDays ?? 7;
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    const token = crypto.randomUUID().replaceAll("-", "");

    const supabase = getSupabaseServerClient();
    const { data: created, error } = await supabase
      .from("reviewer_grants")
      .insert({
        owner_user_id: user.id,
        reviewer_email: data.email,
        token,
        status: "pending",
        expires_at: expiresAt,
      })
      .select("id, reviewer_email, status, token, expires_at, created_at")
      .single();

    if (error) throw toReadableReviewerError(error, "Failed to create reviewer invite: ");

    const row = (created ?? {}) as Record<string, unknown>;
    const inviteLink = `${getAppBaseUrl()}/reviewer/accept?token=${String(row.token ?? token)}`;
    const emailResult = await sendReviewerInviteEmail({
      reviewerEmail: String(row.reviewer_email ?? data.email),
      inviteLink,
    });

    return {
      id: String(row.id ?? ""),
      reviewerEmail: String(row.reviewer_email ?? data.email),
      status: String(row.status ?? "pending"),
      token: String(row.token ?? token),
      inviteLink,
      expiresAt: String(row.expires_at ?? expiresAt),
      createdAt: String(row.created_at ?? ""),
      emailSent: emailResult.sent,
      emailReason: emailResult.sent ? null : emailResult.reason,
    };
  });

export const listReviewerGrants = createServerFn({ method: "GET" }).handler(async () => {
  const {
    data: { user },
    error: userError,
  } = await requireUser();

  if (userError && !isMissingSessionError(userError)) {
    throw new Error(`Unable to verify user session: ${userError.message}`);
  }
  if (!user) return [];

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("reviewer_grants")
    .select("id, reviewer_email, reviewer_user_id, status, token, expires_at, created_at")
    .eq("owner_user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw toReadableReviewerError(error, "Failed to load reviewer invites: ");

  return (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      id: String(row.id ?? ""),
      reviewerEmail: String(row.reviewer_email ?? ""),
      reviewerUserId:
        typeof row.reviewer_user_id === "string"
          ? row.reviewer_user_id
          : (row.reviewer_user_id ?? null),
      status: String(row.status ?? "pending"),
      token: String(row.token ?? ""),
      expiresAt: String(row.expires_at ?? ""),
      createdAt: String(row.created_at ?? ""),
    };
  });
});

export const revokeReviewerInvite = createServerFn({ method: "POST" })
  .validator(revokeInviteInput)
  .handler(async ({ data }) => {
    const {
      data: { user },
      error: userError,
    } = await requireUser();

    if (userError && !isMissingSessionError(userError)) {
      throw new Error(`Unable to verify user session: ${userError.message}`);
    }
    if (!user) throw new Error("You must be signed in to revoke an invite.");

    const supabase = getSupabaseServerClient();
    const { data: updated, error } = await supabase
      .from("reviewer_grants")
      .update({ status: "revoked" })
      .eq("id", data.id)
      .eq("owner_user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) throw toReadableReviewerError(error, "Failed to revoke invite: ");
    if (!updated) throw new Error("Invite not found or you do not have permission to revoke it.");

    return { ok: true as const };
  });

export const acceptReviewerInvite = createServerFn({ method: "POST" })
  .validator(acceptInviteInput)
  .handler(async ({ data }) => {
    const {
      data: { user },
      error: userError,
    } = await requireUser();

    if (userError && !isMissingSessionError(userError)) {
      throw new Error(`Unable to verify user session: ${userError.message}`);
    }
    if (!user) throw new Error("You must be signed in to accept a reviewer invite.");

    const admin = getSupabaseAdminClient();
    const { data: grant, error: grantError } = await admin
      .from("reviewer_grants")
      .select("id, owner_user_id, reviewer_email, reviewer_user_id, status, expires_at")
      .eq("token", data.token)
      .maybeSingle();

    if (grantError) throw toReadableReviewerError(grantError, "Unable to look up invite: ");
    if (!grant) throw new Error("Invalid invite link.");

    const row = grant as Record<string, unknown>;
    const status = String(row.status ?? "pending");
    const inviteEmail = String(row.reviewer_email ?? "").toLowerCase();
    const userEmail = String(user.email ?? "").toLowerCase();

    if (status === "revoked") throw new Error("This invite has been revoked.");

    const expiresAtRaw = row.expires_at;
    if (typeof expiresAtRaw === "string" && new Date(expiresAtRaw).getTime() < Date.now()) {
      throw new Error("This invite has expired.");
    }

    if (inviteEmail && userEmail && inviteEmail !== userEmail) {
      throw new Error(`This invite was issued to ${inviteEmail}. Please sign in with that email.`);
    }

    const { error: updateError } = await admin
      .from("reviewer_grants")
      .update({
        reviewer_user_id: user.id,
        status: "active",
      })
      .eq("id", String(row.id ?? ""));

    if (updateError) throw toReadableReviewerError(updateError, "Failed to accept invite: ");

    return {
      ok: true as const,
      ownerUserId: String(row.owner_user_id ?? ""),
    };
  });
