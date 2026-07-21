import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { LoadingState } from "@/components/EmptyState";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const CallbackSearchSchema = z.object({
  redirect: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export const Route = createFileRoute("/auth/callback")({
  validateSearch: CallbackSearchSchema,
  head: () => ({ meta: [{ title: "Signing in — MindBox" }] }),
  component: AuthCallback,
});

function safeRedirect(input?: string) {
  if (!input) return "/";
  if (!input.startsWith("/")) return "/";
  if (input.startsWith("//")) return "/";
  return input;
}

function AuthCallback() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const redirectTo = safeRedirect(search.redirect);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (search.error) {
      setError(search.error_description ?? search.error);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    let active = true;

    async function finish() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (!active) return;
        if (exchangeError) {
          setError(exchangeError.message);
          return;
        }
        navigate({ to: redirectTo, replace: true });
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (data.session) {
        navigate({ to: redirectTo, replace: true });
        return;
      }

      setError("Sign-in could not be completed. Try again from the login page.");
    }

    void finish();

    return () => {
      active = false;
    };
  }, [navigate, redirectTo, search.error, search.error_description]);

  if (error) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm font-medium text-danger">Google sign-in failed</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <button
          type="button"
          className="text-sm text-sync hover:underline"
          onClick={() => navigate({ to: "/login", search: { redirect: redirectTo } })}
        >
          Back to login
        </button>
      </div>
    );
  }

  return <LoadingState label="Finishing Google sign-in…" />;
}
