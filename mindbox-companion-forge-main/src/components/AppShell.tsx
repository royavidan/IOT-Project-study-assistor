import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Cpu, LayoutDashboard, LogOut, Menu, Search, Settings, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-context";
import { useMotivationNudge } from "@/hooks/use-motivation-nudge";
import { useDeviceStatus } from "@/lib/queries/sessions";
import { MotivationNudgeBanner } from "@/components/MotivationNudgeBanner";
import { LowBatteryBanner } from "@/components/LowBatteryBanner";
import { ReduceMotionRoot } from "@/components/ReduceMotionRoot";
import { CommandMenu } from "@/components/CommandMenu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ALL_NAV_ITEMS,
  DEV_ITEMS,
  NAV_SECTIONS,
  PRIMARY_MOBILE,
  UTILITY_ITEMS,
  isNavActive,
  type NavItem,
} from "@/lib/nav";

function NavLink({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {item.label}
    </Link>
  );
}

function NavGroups({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const utility = [...UTILITY_ITEMS, ...DEV_ITEMS];
  return (
    <div className="flex flex-col gap-4">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {section.label}
          </p>
          <div className="flex flex-col gap-1">
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                item={item}
                active={isNavActive(pathname, item)}
                onClick={onNavigate}
              />
            ))}
          </div>
        </div>
      ))}
      <div className="border-t border-border pt-3">
        <div className="flex flex-col gap-1">
          {utility.map((item) => (
            <NavLink
              key={item.to}
              item={item}
              active={isNavActive(pathname, item)}
              onClick={onNavigate}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60"
    >
      <Search className="h-4 w-4" aria-hidden />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
        ⌘K
      </kbd>
    </button>
  );
}

function AccountMenu({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const initial = email.trim().charAt(0).toUpperCase() || "U";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-lg border border-border p-2 text-left transition-colors hover:bg-accent/60">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs font-medium">{initial}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={email}>
            {email}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSignOut()}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const { user, signOut } = useAuth();
  const nudge = useMotivationNudge();
  const deviceQuery = useDeviceStatus();

  const email = user?.email ?? "Signed in";
  const primaryMobile = PRIMARY_MOBILE.map((to) =>
    ALL_NAV_ITEMS.find((item) => item.to === to),
  ).filter((item): item is NavItem => Boolean(item));

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <ReduceMotionRoot />
      <CommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen} />

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur lg:hidden">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-foreground text-background">
            <Cpu className="h-4 w-4" aria-hidden />
          </div>
          <span className="text-sm font-semibold tracking-tight">MindBox</span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            aria-label="Search"
            onClick={() => setCmdkOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border"
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-foreground/40" />
          <nav
            onClick={(e) => e.stopPropagation()}
            className="absolute right-0 top-0 flex h-full w-72 flex-col border-l border-border bg-card p-4"
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
            <div className="flex-1 overflow-y-auto">
              <NavGroups pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
            {user && (
              <div className="pt-3">
                <AccountMenu
                  email={email}
                  onSignOut={() => {
                    setOpen(false);
                    void signOut();
                  }}
                />
              </div>
            )}
          </nav>
        </div>
      )}

      <div className="lg:flex">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-card/40 p-4 lg:flex">
          <Link to="/" className="mb-4 flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-foreground text-background">
              <Cpu className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight">MindBox</p>
              <p className="text-xs text-muted-foreground">Companion</p>
            </div>
          </Link>
          <SearchButton onClick={() => setCmdkOpen(true)} />
          <nav className="mt-4 flex-1 overflow-y-auto" aria-label="Main navigation">
            <NavGroups pathname={pathname} />
          </nav>
          {user && (
            <div className="pt-3">
              <AccountMenu email={email} onSignOut={() => void signOut()} />
            </div>
          )}
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

      {/* Mobile bottom nav — intentional primary destinations + More */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-background/90 backdrop-blur lg:hidden"
      >
        {primaryMobile.map((item) => {
          const Icon = item.icon;
          const active = isNavActive(pathname, item);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className={cn("h-5 w-5", active && "text-foreground")} aria-hidden />
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={() => setOpen(true)}
          aria-label="More"
          className="flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium text-muted-foreground"
        >
          <Menu className="h-5 w-5" aria-hidden />
          More
        </button>
      </nav>
    </div>
  );
}
