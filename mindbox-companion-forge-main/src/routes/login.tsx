import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
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

            <Button type="submit" className="w-full" disabled={isSubmitting}>
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
