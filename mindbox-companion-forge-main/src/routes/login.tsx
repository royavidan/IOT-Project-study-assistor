import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { signInWithGoogle } from "@/lib/auth/google-oauth";
import { useAuth } from "@/lib/auth/auth-context";

const LoginSearchSchema = z.object({
  redirect: z.string().optional(),
});

type AuthMode = "signin" | "signup";

export const Route = createFileRoute("/login")({
  validateSearch: LoginSearchSchema,
  head: () => ({ meta: [{ title: "Login — MindBox" }] }),
  component: LoginPage,
});

function safeRedirect(input?: string) {
  if (!input) return "/";
  if (!input.startsWith("/")) return "/";
  if (input.startsWith("//")) return "/";
  return input;
}

function LoginPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const redirectTo = useMemo(() => safeRedirect(search.redirect), [search.redirect]);

  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error">("success");

  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      navigate({ to: redirectTo, replace: true });
    }
  }, [user, navigate, redirectTo]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    const supabase = getSupabaseBrowserClient();

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      setMessageKind("error");
      setMessage("Please enter both email and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (error) throw error;
        setMessageKind("success");
        setMessage("Signed in successfully. Redirecting...");
        // The auth context picks up the new session and the effect above
        // redirects to `redirectTo`.
        return;
      }

      const { error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            display_name: displayName.trim() || normalizedEmail.split("@")[0],
          },
        },
      });
      if (error) throw error;

      setMessageKind("success");
      setMessage("Account created. If email confirmation is enabled, check your inbox.");
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const continueWithGoogle = async () => {
    setMessage(null);
    setIsGoogleLoading(true);
    try {
      await signInWithGoogle(redirectTo);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Google sign-in failed.");
      setIsGoogleLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Welcome to MindBox"
        description="Sign in to manage sessions, reviewers, and shared reports."
      />

      <Card className="mx-auto max-w-md">
        <CardContent className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
            <Button
              type="button"
              variant={mode === "signin" ? "default" : "ghost"}
              onClick={() => setMode("signin")}
            >
              Sign in
            </Button>
            <Button
              type="button"
              variant={mode === "signup" ? "default" : "ghost"}
              onClick={() => setMode("signup")}
            >
              Create account
            </Button>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            disabled={isSubmitting || isGoogleLoading}
            onClick={() => void continueWithGoogle()}
          >
            <GoogleIcon />
            {isGoogleLoading ? "Redirecting to Google…" : "Continue with Google"}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or use email</span>
            </div>
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <div className="grid gap-1.5">
                <Label htmlFor="display-name">Display name</Label>
                <Input
                  id="display-name"
                  placeholder="Your name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                placeholder="••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting || isGoogleLoading}>
              {isSubmitting
                ? mode === "signin"
                  ? "Signing in..."
                  : "Creating account..."
                : mode === "signin"
                  ? "Sign in"
                  : "Create account"}
            </Button>
          </form>

          {message && (
            <p className={`text-sm ${messageKind === "error" ? "text-danger" : "text-success"}`}>
              {message}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
