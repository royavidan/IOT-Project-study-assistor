import { cn } from "@/lib/utils";
import type { DeviceState } from "@/lib/types";

const map: Record<DeviceState, { label: string; cls: string; dot: string; pulse?: boolean }> = {
  work: { label: "Working", cls: "bg-work-muted text-work", dot: "bg-work" },
  break: { label: "On Break", cls: "bg-break-muted text-break", dot: "bg-break" },
  sync: { label: "Syncing", cls: "bg-sync-muted text-sync", dot: "bg-sync", pulse: true },
  warning: {
    label: "Wi-Fi Issue",
    cls: "bg-warning-muted text-warning-foreground",
    dot: "bg-warning",
  },
  danger: { label: "Sensor Fault", cls: "bg-danger-muted text-danger", dot: "bg-danger" },
  idle: { label: "Idle", cls: "bg-muted text-muted-foreground", dot: "bg-neutral" },
};

export function StateBadge({
  state,
  className,
  battery,
}: {
  state: DeviceState;
  className?: string;
  /** When set with `warning` state, distinguishes low battery from Wi-Fi issues. */
  battery?: number;
}) {
  const s = map[state];
  const label =
    state === "warning" && battery != null && battery > 0 && battery < 15 ? "Low Battery" : s.label;

  return (
    <span
      role="status"
      aria-label={`Device state: ${label}`}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
        s.cls,
        className,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", s.dot, s.pulse && "pulse-sync")} />
      {label}
    </span>
  );
}
