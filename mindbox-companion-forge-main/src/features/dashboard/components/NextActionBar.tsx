import { Link } from "@tanstack/react-router";
import { BookOpen, GraduationCap, Play, type LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { countdownLabel, type UpcomingExam } from "@/features/schedule/schedule";
import type { NextAction } from "@/features/dashboard/today";

interface ActionView {
  icon: LucideIcon;
  title: string;
  detail: string;
  to: string;
  cta: string;
}

function homeworkView(hw: { title: string }, overdue: boolean, daysUntil: number): ActionView {
  return {
    icon: BookOpen,
    title: hw.title,
    detail: overdue
      ? `Overdue by ${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? "" : "s"}`
      : daysUntil <= 0
        ? "Due today"
        : `Due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`,
    to: "/assignments",
    cta: "Open",
  };
}

function examView(exam: UpcomingExam): ActionView {
  return {
    icon: GraduationCap,
    title: `Study for ${exam.event.title}`,
    detail: `Exam ${countdownLabel(exam.dateKey)}`,
    to: "/calendar",
    cta: "View",
  };
}

const SESSION_VIEW: ActionView = {
  icon: Play,
  title: "Start a focus session",
  detail: "Begin on your MindBox — controls live on the device.",
  to: "/device",
  cta: "Set up",
};

function toView(action: NextAction): ActionView {
  switch (action.kind) {
    case "homework":
      return homeworkView(action.hw, action.overdue, action.daysUntil);
    case "exam":
      return examView(action.exam);
    case "session":
      return SESSION_VIEW;
  }
}

/** The one dominant "do this next" call-to-action, thumb-zone friendly. */
export function NextActionBar({ action }: { action: NextAction }) {
  const view = toView(action);
  const Icon = view.icon;
  return (
    <Card className="mb-6 border-primary/20 bg-primary/5">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-primary">Next up</p>
            <p className="truncate text-sm font-semibold">{view.title}</p>
            <p className="truncate text-xs text-muted-foreground">{view.detail}</p>
          </div>
        </div>
        <Button size="sm" asChild className="shrink-0">
          <Link to={view.to}>{view.cta}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
