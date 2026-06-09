import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  History,
  Trophy,
  Users,
  ShieldCheck,
  Download,
  Settings,
  Cpu,
  FlaskConical,
  Menu,
  X,
  LogOut,
  LineChart,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { useMotivationNudge } from "@/hooks/use-motivation-nudge";
import { useDeviceStatus } from "@/lib/queries/sessions";
import { MotivationNudgeBanner } from "@/components/MotivationNudgeBanner";
import { LowBatteryBanner } from "@/components/LowBatteryBanner";
import { ReduceMotionRoot } from "@/components/ReduceMotionRoot";

const baseNav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/history", label: "Sessions", icon: History },
  { to: "/insights", label: "Insights", icon: LineChart },
  { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { to: "/friends", label: "Friends", icon: Users },
  { to: "/reviewers", label: "Reviewers", icon: ShieldCheck },
  { to: "/exports", label: "Exports", icon: Download },
  { to: "/device", label: "Device", icon: Cpu },
  { to: "/simulator", label: "Simulator", icon: FlaskConical },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function UserMenu({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="truncate px-3 text-xs text-muted-foreground" title={email}>
        {email}
      </p>
      <button
        onClick={onSignOut}
        className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        Sign out
      </button>
    </div>
  );
}

function NavItem({
  to,
  label,
  Icon,
  active,
  onClick,
}: {
  to: string;
  label: string;
  Icon: typeof LayoutDashboard;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </Link>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const { user, signOut } = useAuth();
  const nudge = useMotivationNudge();
  const deviceQuery = useDeviceStatus();
  const nav = baseNav;

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <ReduceMotionRoot />
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur lg:hidden">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-foreground text-background">
            <Cpu className="h-4 w-4" aria-hidden />
          </div>
          <span className="text-sm font-semibold tracking-tight">MindBox</span>
        </Link>
        <button
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border"
        >
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-foreground/40" />
          <nav
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-0 h-full w-72 border-l border-border bg-card p-4"
            aria-label="Main navigation"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold">Menu</span>
              <button
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="h-9 w-9 rounded-md border border-border"
              >
                <X className="mx-auto h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {nav.map((n) => (
                <NavItem
                  key={n.to}
                  to={n.to}
                  label={n.label}
                  Icon={n.icon}
                  active={isActive(n.to, "exact" in n ? n.exact : false)}
                  onClick={() => setOpen(false)}
                />
              ))}
            </div>
            {user && (
              <UserMenu
                email={user.email ?? "Signed in"}
                onSignOut={() => {
                  setOpen(false);
                  void signOut();
                }}
              />
            )}
          </nav>
        </div>
      )}

      <div className="lg:flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 border-r border-border bg-card/40 p-4 lg:block">
          <Link to="/" className="mb-6 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-foreground text-background">
              <Cpu className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight">MindBox</p>
              <p className="text-xs text-muted-foreground">Companion</p>
            </div>
          </Link>
          <nav className="flex flex-col gap-1" aria-label="Main navigation">
            {nav.map((n) => (
              <NavItem
                key={n.to}
                to={n.to}
                label={n.label}
                Icon={n.icon}
                active={isActive(n.to, "exact" in n ? n.exact : false)}
              />
            ))}
          </nav>
          {user && <UserMenu email={user.email ?? "Signed in"} onSignOut={() => void signOut()} />}
        </aside>

        <main className="flex-1 px-4 pb-24 pt-4 sm:px-6 lg:pb-10 lg:pt-8">
          <div className="mx-auto max-w-5xl">
            {nudge.show && (
              <MotivationNudgeBanner
                message={nudge.message}
                onDismiss={nudge.dismiss}
                onEnableNotifications={() => void nudge.requestBrowserNotification()}
                notificationsEnabled={nudge.browserNotificationsEnabled}
              />
            )}
            {deviceQuery.data &&
              deviceQuery.data.battery > 0 &&
              deviceQuery.data.battery < 15 &&
              pathname !== "/" &&
              pathname !== "/device" && <LowBatteryBanner battery={deviceQuery.data.battery} />}
            {children ?? <Outlet />}
          </div>
        </main>
      </div>

      {/* Mobile bottom nav (primary 4) */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-background/90 backdrop-blur lg:hidden"
      >
        {nav.slice(0, 4).map((n) => {
          const Icon = n.icon;
          const active = isActive(n.to, "exact" in n ? n.exact : false);
          return (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className={cn("h-5 w-5", active && "text-foreground")} aria-hidden />
              {n.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
