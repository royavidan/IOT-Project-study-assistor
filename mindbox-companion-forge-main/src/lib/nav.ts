import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Cpu,
  FlaskConical,
  GraduationCap,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";

import { SHOW_DEV_TOOLS } from "@/lib/feature-flags";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match the route exactly (used for the Dashboard "/" root). */
  exact?: boolean;
  /** Extra search terms for the command palette (not shown in the sidebar). */
  keywords?: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

// Grouped by the student's job-to-be-done, not by code feature folder.
export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Study",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { to: "/calendar", label: "Calendar", icon: CalendarDays },
      { to: "/courses", label: "Courses", icon: GraduationCap },
      { to: "/assignments", label: "Assignments", icon: BookOpen },
      {
        to: "/progress",
        label: "Progress",
        icon: BarChart3,
        keywords: "sessions history insights analytics exports reports",
      },
    ],
  },
  {
    label: "Social",
    items: [
      { to: "/friends", label: "Friends", icon: Users },
      { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
      { to: "/reviewers", label: "Reviewers", icon: ShieldCheck },
    ],
  },
];

// De-emphasized utility cluster pinned to the bottom of the sidebar.
export const UTILITY_ITEMS: NavItem[] = [
  { to: "/device", label: "Device", icon: Cpu },
  { to: "/settings", label: "Settings", icon: Settings },
];

// Developer tooling — only shown in nav when SHOW_DEV_TOOLS is on (dev builds).
export const DEV_ITEMS: NavItem[] = SHOW_DEV_TOOLS
  ? [{ to: "/simulator", label: "Simulator", icon: FlaskConical }]
  : [];

// The intentional set shown in the mobile bottom bar (4) + a "More" button.
// These are the daily-study destinations, not an arbitrary slice of the list.
export const PRIMARY_MOBILE = ["/", "/calendar", "/courses", "/assignments"] as const;

// Flat list of every reachable destination (sidebar + utility + dev), used by
// the command palette and active-route detection.
export const ALL_NAV_ITEMS: NavItem[] = [
  ...NAV_SECTIONS.flatMap((s) => s.items),
  ...UTILITY_ITEMS,
  ...DEV_ITEMS,
];

export function isNavActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(item.to + "/");
}
