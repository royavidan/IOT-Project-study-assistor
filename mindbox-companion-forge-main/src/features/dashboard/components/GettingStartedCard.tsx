import { Link } from "@tanstack/react-router";
import { Check, ChevronRight } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { completedStepCount, type OnboardingStep } from "@/features/dashboard/today";
import { cn } from "@/lib/utils";

/**
 * First-run getting-started checklist — shown instead of empty device/session
 * widgets until the user pairs a device or logs a session. Each step's done-ness
 * comes from real data; the first incomplete step is the primary call-to-action.
 */
export function GettingStartedCard({ steps }: { steps: OnboardingStep[] }) {
  const done = completedStepCount(steps);
  const pct = Math.round((done / steps.length) * 100);
  const nextStep = steps.find((s) => !s.done);

  return (
    <Card className="mb-6">
      <CardHeader className="gap-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Get set up</CardTitle>
          <span className="text-xs font-medium text-muted-foreground">
            {done} of {steps.length}
          </span>
        </div>
        <Progress value={pct} className="h-1.5" />
      </CardHeader>
      <CardContent className="space-y-1.5">
        {steps.map((step) => {
          const isNext = step.key === nextStep?.key;
          return (
            <Link
              key={step.key}
              to={step.href}
              className={cn(
                "flex items-center gap-3 rounded-lg p-2.5 transition-colors",
                step.done ? "opacity-70" : "hover:bg-muted/50",
                isNext && "bg-primary/5 ring-1 ring-primary/20",
              )}
            >
              <span
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs",
                  step.done
                    ? "border-success/30 bg-success/10 text-success"
                    : "border-border text-muted-foreground",
                )}
                aria-hidden
              >
                {step.done ? <Check className="h-3.5 w-3.5" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-sm font-medium",
                    step.done && "text-muted-foreground line-through",
                  )}
                >
                  {step.label}
                </span>
                {!step.done && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {step.description}
                  </span>
                )}
              </span>
              {isNext ? (
                <Button size="sm" className="pointer-events-none shrink-0">
                  {step.cta}
                </Button>
              ) : (
                !step.done && (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )
              )}
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
