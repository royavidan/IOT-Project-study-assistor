import { useState } from "react";
import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MeetingCounts } from "@/features/courses/courses";
import type { WatchedCounts } from "@/features/courses/queries";

type SubtypeKey = "lectures" | "tutorials" | "labs";

const ROWS: { key: SubtypeKey; label: string; plannedKey: keyof MeetingCounts }[] = [
  { key: "lectures", label: "Lectures", plannedKey: "lecture" },
  { key: "tutorials", label: "Tutorials", plannedKey: "tutorial" },
  { key: "labs", label: "Labs", plannedKey: "lab" },
];

export function WatchedMeetingsCard({
  watched,
  planned,
  plannedFromTerm,
  onSave,
  saving,
}: {
  watched: WatchedCounts;
  planned: MeetingCounts;
  /** True when the denominator comes from the semester term (vs weekly templates). */
  plannedFromTerm: boolean;
  onSave: (watched: WatchedCounts) => void;
  saving?: boolean;
}) {
  const [draft, setDraft] = useState<WatchedCounts>(watched);

  const visible = ROWS.filter((r) => planned[r.plannedKey] > 0 || watched[r.key] > 0);
  if (visible.length === 0) return null;

  const dirty =
    draft.lectures !== watched.lectures ||
    draft.tutorials !== watched.tutorials ||
    draft.labs !== watched.labs;

  const setCount = (key: SubtypeKey, next: number, max: number) =>
    setDraft((d) => ({ ...d, [key]: Math.max(0, max > 0 ? Math.min(max, next) : next) }));

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div>
          <p className="text-sm font-semibold">Watched</p>
          <p className="text-xs text-muted-foreground">
            What you've actually done vs the planned {plannedFromTerm ? "semester" : "weekly"}{" "}
            schedule.
          </p>
        </div>

        <ul className="space-y-2">
          {visible.map((r) => {
            const max = planned[r.plannedKey];
            const value = draft[r.key];
            return (
              <li key={r.key} className="flex items-center justify-between gap-3">
                <span className="text-sm">{r.label}</span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={value <= 0}
                    onClick={() => setCount(r.key, value - 1, max)}
                    aria-label={`One fewer ${r.label} watched`}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="w-14 text-center text-sm font-medium tabular-nums">
                    {value}
                    <span className="text-muted-foreground"> / {max}</span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={max > 0 && value >= max}
                    onClick={() => setCount(r.key, value + 1, max)}
                    aria-label={`One more ${r.label} watched`}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        <div className={cn("flex justify-end", !dirty && "opacity-0")} aria-hidden={!dirty}>
          <Button type="button" size="sm" disabled={!dirty || saving} onClick={() => onSave(draft)}>
            {saving ? "Saving…" : "Save watched"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
