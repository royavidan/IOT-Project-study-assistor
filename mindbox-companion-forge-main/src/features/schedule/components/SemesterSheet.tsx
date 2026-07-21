import { useEffect, useRef, useState } from "react";
import { CalendarRange } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { useSaveSettings, useSettings } from "@/lib/queries/settings";

/** Semester term config (label + start/end). Lives behind a compact button +
 * sheet so it no longer dominates the calendar layout. Self-contained: reads
 * and writes user settings directly. */
export function SemesterSheet() {
  const settingsQuery = useSettings();
  const saveSettings = useSaveSettings();

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!settingsQuery.data || hydrated.current) return;
    hydrated.current = true;
    setLabel(settingsQuery.data.semesterLabel ?? "");
    setStart(settingsQuery.data.semesterStart ?? "");
    setEnd(settingsQuery.data.semesterEnd ?? "");
  }, [settingsQuery.data]);

  const semStart = settingsQuery.data?.semesterStart ?? null;
  const semEnd = settingsQuery.data?.semesterEnd ?? null;
  const active = Boolean(semStart || semEnd);

  const persist = (l: string | null, s: string | null, e: string | null) => {
    if (!settingsQuery.data) return;
    setSaved(false);
    setError(null);
    if (s && e && e < s) {
      setError("Semester end must be on or after the start date.");
      return;
    }
    saveSettings.mutate(
      { ...settingsQuery.data, semesterLabel: l, semesterStart: s, semesterEnd: e },
      {
        onSuccess: () => {
          setSaved(true);
          window.setTimeout(() => setSaved(false), 2500);
        },
        onError: (err) =>
          setError(
            err instanceof Error
              ? `${err.message} — make sure migration 0008 has been run in Supabase.`
              : "Could not save the semester.",
          ),
      },
    );
  };

  const save = () => persist(label.trim() || null, start || null, end || null);
  const clear = () => {
    setLabel("");
    setStart("");
    setEnd("");
    persist(null, null, null);
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <CalendarRange className="h-4 w-4" />
        {active ? settingsQuery.data?.semesterLabel || "Semester" : "Set semester"}
      </Button>

      <ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        title="Semester"
        description="Set your term so weekly classes only repeat between these dates. Leave both blank for no limit."
        footer={
          <div className="flex w-full flex-wrap items-center gap-3">
            <Button onClick={save} disabled={saveSettings.isPending}>
              {saveSettings.isPending ? "Saving…" : "Save semester"}
            </Button>
            {active && (
              <Button variant="ghost" onClick={clear} disabled={saveSettings.isPending}>
                Clear
              </Button>
            )}
            {saved && <span className="text-xs text-success">Saved.</span>}
          </div>
        }
      >
        <div className="grid gap-4 pb-2">
          <div className="grid gap-1.5">
            <Label htmlFor="sem-label">Label</Label>
            <Input
              id="sem-label"
              placeholder="Fall 2026"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="sem-start">Start</Label>
              <Input
                id="sem-start"
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sem-end">End</Label>
              <Input
                id="sem-end"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </ResponsiveModal>
    </>
  );
}
