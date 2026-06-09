import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function appOrigin(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

/** Where Supabase returns after Google OAuth (PKCE code exchange). */
export function buildGoogleOAuthRedirectUrl(postAuthPath = "/"): string {
  const url = new URL("/auth/callback", appOrigin());
  if (postAuthPath && postAuthPath.startsWith("/") && !postAuthPath.startsWith("//")) {
    url.searchParams.set("redirect", postAuthPath);
  }
  return url.toString();
}

/** Starts Google sign-in or registration (same flow — new users are created automatically). */
export async function signInWithGoogle(postAuthPath = "/"): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const redirectTo = buildGoogleOAuthRedirectUrl(postAuthPath);

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        prompt: "select_account",
      },
    },
  });

  if (error) throw error;
}
