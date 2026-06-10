import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * A tap-friendly "?" info hint. Uses a Popover (opens on click/tap) instead of a
 * hover Tooltip, so the explanation is reachable on touch devices too — phones
 * can't hover. Self-contained: no TooltipProvider needed.
 */
export function InfoHint({
  children,
  label = "More information",
  className,
  side = "top",
  align = "start",
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn("text-muted-foreground transition-colors hover:text-foreground", className)}
        >
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        className="max-w-xs text-left text-sm text-muted-foreground"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
