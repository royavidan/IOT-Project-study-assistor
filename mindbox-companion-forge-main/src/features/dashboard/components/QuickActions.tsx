import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  CalendarDays,
  Cpu,
  FlaskConical,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";

interface QuickAction {
  to: string;
  label: string;
  icon: LucideIcon;
}

/** Thumb-friendly one-tap shortcuts. The 4th adapts to whether a device is paired. */
export function QuickActions({ hasDevice }: { hasDevice: boolean }) {
  const actions: QuickAction[] = [
    { to: "/courses", label: "Add course", icon: GraduationCap },
    { to: "/assignments", label: "Assignment", icon: BookOpen },
    { to: "/calendar", label: "Calendar", icon: CalendarDays },
    hasDevice
      ? { to: "/simulator", label: "Log session", icon: FlaskConical }
      : { to: "/device", label: "Connect", icon: Cpu },
  ];

  return (
    <div className="mb-6 grid grid-cols-4 gap-2">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.to}
            to={a.to}
            className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card p-3 text-center transition-colors hover:border-primary/40 hover:bg-muted/40"
          >
            <Icon className="h-5 w-5 text-primary" aria-hidden />
            <span className="text-[11px] font-medium leading-tight text-foreground">{a.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
