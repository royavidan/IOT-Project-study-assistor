import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ModeConfig } from "@/features/planner/planner";

/** A selectable strategy-mode card used in the generate sheet. */
export function ModeCard({
  config,
  selected,
  onSelect,
}: {
  config: ModeConfig;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border hover:border-primary/50",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{config.label}</span>
        <span
          className={cn(
            "grid h-5 w-5 place-items-center rounded-full border",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/40",
          )}
        >
          {selected && <Check className="h-3.5 w-3.5" />}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{config.blurb}</p>
      <p className="mt-2 text-xs font-medium text-muted-foreground">
        {config.workBlockMin}m focus · {config.breakMin}m break · up to{" "}
        {Math.round(config.dailyCapMin / 60)}h/day
      </p>
    </button>
  );
}
