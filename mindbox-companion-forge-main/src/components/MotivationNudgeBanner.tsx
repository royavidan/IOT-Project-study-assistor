import { Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MotivationNudgeBanner({
  message,
  onDismiss,
  onEnableNotifications,
  notificationsEnabled,
  className,
}: {
  message: string;
  onDismiss: () => void;
  onEnableNotifications?: () => void;
  notificationsEnabled: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn("mb-4 rounded-lg border border-info/25 bg-info/5 px-4 py-3 text-sm", className)}
    >
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">Motivation nudge</p>
          <p className="mt-0.5 text-muted-foreground">{message}</p>
          {!notificationsEnabled && onEnableNotifications && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="mt-1 h-auto p-0 text-info"
              onClick={() => void onEnableNotifications()}
            >
              Enable browser notifications
            </Button>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss nudge"
          onClick={onDismiss}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
