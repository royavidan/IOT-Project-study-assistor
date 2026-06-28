import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export const Route = createFileRoute("/auth/reset")({
  head: () => ({ meta: [{ title: "Reset password — MindBox" }] }),
  component: ResetPasswordPage,
});

type LinkState = "checking" | "ready" | "invalid";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageKind, setMessageKind] = useState<"success" | "error">("error");

  // The reset email lands here with a recovery session. Depending on the flow
  // it arrives as a `?code=` (PKCE) we exchange, or an auto-detected session
  // that fires PASSWORD_RECOVERY. Accept either; if neither shows up, the link
  // is treated as expired/invalid.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let active = true;

    async function init() {
      const params = new URLSearchParams(window.location.search);
      if (params.get("error")) {
        if (active) setLinkState("invalid");
        return;
      }
      const code = params.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!active) return;
        setLinkState(error ? "invalid" : "ready");
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (active && data.session) setLinkState("ready");
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || session) setLinkState("ready");
    });

    void init();

    const timer = setTimeout(() => {
      if (active) setLinkState((s) => (s === "checking" ? "invalid" : s));
    }, 3000);

    return () => {
      active = false;
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);

    if (password.length < 8) {
      setMessageKind("error");
      setMessage("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setMessageKind("error");
      setMessage("Those passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setMessageKind("success");
      setMessage("Password updated. Redirecting…");
      setTimeout(() => navigate({ to: "/", replace: true }), 800);
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : "Could not update your password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Set a new password"
        description="Choose a new password to finish recovering your account."
      />

      <Card className="mx-auto max-w-md">
        <CardContent className="space-y-4 p-5">
          {linkState === "invalid" ? (
            <div className="space-y-3 text-sm">
              <p className="font-medium text-danger">This reset link is invalid or has expired.</p>
              <p className="text-muted-foreground">
                Request a fresh link from the sign-in page and try again.
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link to="/login">Back to sign in</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="grid gap-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={linkState !== "ready" || submitting}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={linkState !== "ready" || submitting}
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={linkState !== "ready" || submitting}
              >
                {linkState === "checking"
                  ? "Verifying link…"
                  : submitting
                    ? "Updating…"
                    : "Update password"}
              </Button>
            </form>
          )}

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
