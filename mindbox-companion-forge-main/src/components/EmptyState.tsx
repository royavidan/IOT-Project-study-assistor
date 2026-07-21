import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center",
        className,
      )}
    >
      {icon && <div className="mb-3 text-muted-foreground">{icon}</div>}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-3 py-10 text-sm text-muted-foreground"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-sync pulse-sync" />
      {label}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger-muted/40 p-4 text-sm">
      <p className="font-medium text-danger">{title}</p>
      {description && <p className="mt-1 text-foreground/80">{description}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 inline-flex items-center rounded-md border border-danger/40 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10"
        >
          Try again
        </button>
      )}
    </div>
  );
}
