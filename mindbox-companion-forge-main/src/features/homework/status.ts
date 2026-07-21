import { CheckCircle, Clock, GraduationCap } from "lucide-react";

import type { HomeworkStatus } from "@/lib/types";

export const STATUS_ORDER: HomeworkStatus[] = ["pending", "submitted", "graded"];

export const STATUS_META: Record<
  HomeworkStatus,
  { label: string; icon: typeof Clock; badge: string; dot: string }
> = {
  pending: {
    label: "Pending",
    icon: Clock,
    badge: "bg-warning-muted text-warning-foreground",
    dot: "bg-warning",
  },
  submitted: {
    label: "Submitted",
    icon: CheckCircle,
    badge: "bg-info/10 text-info",
    dot: "bg-info",
  },
  graded: {
    label: "Graded",
    icon: GraduationCap,
    badge: "bg-success/10 text-success",
    dot: "bg-success",
  },
};
