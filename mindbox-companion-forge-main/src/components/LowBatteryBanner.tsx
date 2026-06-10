import { Battery } from "lucide-react";

import { cn } from "@/lib/utils";
import { BATTERY_TRACKING_ENABLED } from "@/lib/feature-flags";

export function LowBatteryBanner({ battery, className }: { battery: number; className?: string }) {
  if (!BATTERY_TRACKING_ENABLED || battery <= 0 || battery >= 15) return null;

  return (
    <div
      role="alert"
      className={cn(
        "mb-4 rounded-lg border border-danger/30 bg-danger-muted/40 px-4 py-3 text-sm text-danger",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <Battery className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">Low battery ({battery}%)</p>
          <p className="mt-0.5 text-danger/90">
            Charge your MindBox soon. Below 5% the device saves data and enters deep sleep to
            prevent loss.
          </p>
        </div>
      </div>
    </div>
  );
}
