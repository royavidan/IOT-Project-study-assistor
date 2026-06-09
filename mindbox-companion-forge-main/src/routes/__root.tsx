import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useNavigate,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AppShell } from "../components/AppShell";
import { AuthProvider, useAuth } from "../lib/auth/auth-context";
import { LoadingState } from "../components/EmptyState";

// Routes a guest (signed-out user) is allowed to see.
const PUBLIC_PATHS = ["/login", "/reviewer/accept", "/auth/callback"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MindBox Companion" },
      {
        name: "description",
        content: "Companion app for the MindBox focus device — sessions, streaks, and reports.",
      },
      { name: "author", content: "MindBox" },
      { property: "og:title", content: "MindBox Companion" },
      {
        property: "og:description",
        content: "Companion app for the MindBox focus device — sessions, streaks, and reports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function FullScreenStatus({ label }: { label: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <LoadingState label={label} />
    </div>
  );
}

/** Centered, chrome-free layout for guests (login / accept-invite). */
function GuestShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

/**
 * Decides what a request can see:
 * - while the session resolves -> loading screen
 * - guest on a public route   -> standalone page (no app nav)
 * - guest on a private route  -> redirect to /login
 * - signed-in user            -> full app shell
 */
function AuthGate() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const publicRoute = isPublicPath(pathname);

  useEffect(() => {
    if (loading) return;
    if (!user && !publicRoute) {
      navigate({ to: "/login", search: { redirect: pathname }, replace: true });
    }
  }, [loading, user, publicRoute, pathname, navigate]);

  if (loading) {
    return <FullScreenStatus label="Loading…" />;
  }

  if (!user) {
    if (publicRoute) {
      return (
        <GuestShell>
          <Outlet />
        </GuestShell>
      );
    }
    return <FullScreenStatus label="Redirecting to sign in…" />;
  }

  // Signed in. The login page redirects itself once a user is present.
  if (pathname === "/login") {
    return (
      <GuestShell>
        <Outlet />
      </GuestShell>
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
