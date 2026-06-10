import { useState } from "react";
import { CalendarClock, Plus, Repeat, Trash2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dateKeyDaysAgo } from "@/lib/dates";
import { useExternalLoadActions, useExternalLoads } from "@/lib/queries/external-load";

/**
 * Manage "general load" — lectures, labs, anything outside MindBox sessions.
 * Entries feed the Recovery balance estimate (study + commitments) on Insights.
 * Adds/removes persist immediately (own rows, RLS-protected).
 */
export function ExternalLoadCard() {
  const { data, isLoading } = useExternalLoads();
  const { add, remove } = useExternalLoadActions();

  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"weekly" | "dated">("weekly");
  const [hours, setHours] = useState("2");
  const [date, setDate] = useState(() => dateKeyDaysAgo(0));
  const [error, setError] = useState<string | null>(null);

  const onAdd = () => {
    setError(null);
    add.mutate(
      {
        label,
        kind,
        hours: Number.parseFloat(hours) || 0,
        date: kind === "dated" ? date : null,
      },
      {
        onSuccess: () => {
          setLabel("");
          setHours("2");
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Could not add commitment."),
      },
    );
  };

  const entries = data ?? [];

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">Other commitments</CardTitle>
        <CardDescription>
          Add non-MindBox load like lectures or labs. It factors into your Recovery balance on
          Insights (study + commitments), so the estimate reflects your real week.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid w-full gap-1.5 sm:w-auto sm:flex-1">
            <Label htmlFor="xl-label">Label</Label>
            <Input
              id="xl-label"
              placeholder="Lectures"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="xl-kind">Repeats</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as "weekly" | "dated")}>
              <SelectTrigger id="xl-kind" className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Every week</SelectItem>
                <SelectItem value="dated">Specific date</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "dated" && (
            <div className="grid gap-1.5">
              <Label htmlFor="xl-date">Date</Label>
              <Input
                id="xl-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-[150px]"
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="xl-hours">Hours{kind === "weekly" ? "/week" : ""}</Label>
            <Input
              id="xl-hours"
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="w-[110px]"
            />
          </div>
          <Button type="button" onClick={onAdd} disabled={add.isPending}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No commitments added yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  {e.kind === "weekly" ? (
                    <Repeat className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <CalendarClock
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                  <span className="truncate font-medium">{e.label}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {e.kind === "weekly" ? `${e.hours}h/week` : `${e.hours}h · ${e.date}`}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(e.id)}
                  aria-label={`Remove ${e.label}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
