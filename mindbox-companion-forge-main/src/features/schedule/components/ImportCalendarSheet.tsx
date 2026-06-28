import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { CalendarPlus, FileUp, Link2, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useIcsActions, useIcsImports, type IcsImport } from "@/features/schedule/ics-queries";

type Mode = "url" | "file";

interface ImportResult {
  courses: number;
  classes: number;
  exams: number;
}

export function ImportCalendarSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const importsQuery = useIcsImports();
  const { importCalendar, sync, remove } = useIcsActions();

  const [mode, setMode] = useState<Mode>("url");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setUrl("");
    setName("");
    setFile(null);
  };

  const submit = async () => {
    setError(null);
    setResult(null);
    try {
      if (mode === "url") {
        if (!url.trim()) {
          setError("Paste your calendar's .ics link.");
          return;
        }
        const res = await importCalendar.mutateAsync({
          name: name.trim() || undefined,
          source: { type: "url", url: url.trim() },
        });
        setResult(res);
      } else {
        if (!file) {
          setError("Choose an .ics file to import.");
          return;
        }
        const text = await file.text();
        const res = await importCalendar.mutateAsync({
          name: name.trim() || undefined,
          source: { type: "file", text },
        });
        setResult(res);
      }
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import that calendar.");
    }
  };

  const imports = importsQuery.data ?? [];

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Import calendar"
      description="Build your schedule from a university .ics link or file — classes, exams, and courses."
      className="sm:max-w-lg"
    >
      <div className="space-y-5 py-2">
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(v) => v && setMode(v as Mode)}
          variant="outline"
          className="grid w-full grid-cols-2"
        >
          <ToggleGroupItem value="url" className="min-h-10">
            <Link2 className="mr-1.5 h-4 w-4" />
            Link
          </ToggleGroupItem>
          <ToggleGroupItem value="file" className="min-h-10">
            <FileUp className="mr-1.5 h-4 w-4" />
            Upload file
          </ToggleGroupItem>
        </ToggleGroup>

        {mode === "url" ? (
          <div className="grid gap-2">
            <Label htmlFor="ics-url">Calendar link (.ics / webcal)</Label>
            <Input
              id="ics-url"
              placeholder="https://files.cheesefork.cf/…/spring-2026.ics"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              dir="ltr"
            />
            <p className="text-xs text-muted-foreground">
              A link can refresh itself — it re-syncs automatically about once a day.
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="ics-file">Calendar file</Label>
            <Input
              id="ics-file"
              type="file"
              accept=".ics,text/calendar"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="cursor-pointer"
            />
            <p className="text-xs text-muted-foreground">
              A file is a one-off — to update it later, import a fresh file.
            </p>
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor="ics-name">Name (optional)</Label>
          <Input
            id="ics-name"
            placeholder="Spring 2026"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        {result && (
          <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
            Added {result.courses} course{result.courses === 1 ? "" : "s"} · {result.classes} class
            {result.classes === 1 ? "" : "es"} · {result.exams} exam{result.exams === 1 ? "" : "s"}.
          </p>
        )}

        <Button
          onClick={() => void submit()}
          disabled={importCalendar.isPending}
          className="w-full"
        >
          <CalendarPlus className="h-4 w-4" />
          {importCalendar.isPending ? "Importing…" : "Import"}
        </Button>

        <Separator />

        <div className="space-y-2">
          <p className="text-sm font-semibold">Imported calendars</p>
          {imports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calendars imported yet.</p>
          ) : (
            <ul className="space-y-2">
              {imports.map((imp) => (
                <ImportRow
                  key={imp.id}
                  imp={imp}
                  onSync={() => sync.mutate(imp.id)}
                  onDelete={() => remove.mutate(imp.id)}
                  syncing={sync.isPending && sync.variables === imp.id}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </ResponsiveModal>
  );
}

function ImportRow({
  imp,
  onSync,
  onDelete,
  syncing,
}: {
  imp: IcsImport;
  onSync: () => void;
  onDelete: () => void;
  syncing?: boolean;
}) {
  const synced = imp.lastSyncedAt
    ? `synced ${formatDistanceToNow(new Date(imp.lastSyncedAt), { addSuffix: true })}`
    : "not synced yet";

  return (
    <li className="flex items-center gap-2 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{imp.name}</p>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            {imp.sourceType === "url" ? "Link" : "File"}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {imp.eventCount} item{imp.eventCount === 1 ? "" : "s"} · {synced}
        </p>
      </div>

      {imp.sourceType === "url" && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={onSync}
          disabled={syncing}
          aria-label="Update now"
        >
          <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
        </Button>
      )}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 text-danger"
            aria-label="Delete calendar"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this calendar?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the courses, classes, and exams this calendar added — about{" "}
              {imp.eventCount} item{imp.eventCount === 1 ? "" : "s"} in all. Homework you logged and
              events you added yourself are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Delete schedule</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
