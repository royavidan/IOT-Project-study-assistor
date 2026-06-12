import "@tanstack/react-start/server-only";

import { createClient } from "@supabase/supabase-js";

import { getServerConfig } from "@/lib/config.server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

type InviteEmailInput = {
  reviewerEmail: string;
  inviteLink: string;
};

export type InviteEmailResult = { sent: true; id: string } | { sent: false; reason: string };

export async function sendReviewerInviteEmail({
  reviewerEmail,
  inviteLink,
}: InviteEmailInput): Promise<InviteEmailResult> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(reviewerEmail, {
    redirectTo: inviteLink,
    data: {
      invited_as: "reviewer",
      invite_source: "mindbox",
    },
  });

  if (!error) {
    return {
      sent: true,
      id: data.user?.id ?? "unknown",
    };
  }

  // Supabase invite emails only work for users that are not yet registered.
  // If the reviewer already exists, use a Supabase magic-link email instead.
  if (/already been registered/i.test(error.message)) {
    const { supabaseUrl, supabaseAnonKey } = getServerConfig();
    if (!supabaseUrl || !supabaseAnonKey) {
      return {
        sent: false,
        reason:
          "Invite target already has an account, but SUPABASE_URL/SUPABASE_ANON_KEY are missing for magic-link fallback.",
      };
    }

    const publicClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { error: otpError } = await publicClient.auth.signInWithOtp({
      email: reviewerEmail,
      options: {
        emailRedirectTo: inviteLink,
        shouldCreateUser: false,
      },
    });

    if (otpError) {
      return {
        sent: false,
        reason: `Supabase magic-link fallback failed: ${otpError.message}`,
      };
    }

    return {
      sent: true,
      id: "existing-user-magic-link",
    };
  }

  return {
    sent: false,
    reason: `Supabase email invite failed: ${error.message}`,
  };
}
