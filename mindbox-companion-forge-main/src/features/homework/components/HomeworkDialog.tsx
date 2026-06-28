import { useEffect, useState } from "react";
import { Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import type { Course } from "@/features/courses/courses";
import type { HomeworkAssignment, HomeworkStatus } from "@/lib/types";
import type { HomeworkInput, HomeworkUpdateInput } from "@/lib/queries/homework";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: HomeworkAssignment | null;
  /** The user's courses, to populate the course picker. */
  courses?: Course[];
  /** Preselect this course code when creating a new assignment. */
  defaultCourseCode?: string;
  onSubmit: (input: HomeworkInput | HomeworkUpdateInput, file?: File) => void;
  busy?: boolean;
  error?: string | null;
};

const NO_COURSE = "__none__";

const defaultForm = (): HomeworkUpdateInput => ({
  title: "",
  courseCode: "",
  description: "",
  dueDate: new Date().toISOString().split("T")[0],
  status: "pending",
  progressPct: null,
  grade: null,
  weight: null,
  notes: "",
});

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? null : n;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// Number inputs hijack the mouse wheel (scrolling changes the value). Blur on
// wheel so scrolling the dialog never nudges grade/weight — the reported UX bug.
const blurOnWheel = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur();

export function HomeworkDialog({
  open,
  onOpenChange,
  editing,
  courses = [],
  defaultCourseCode,
  onSubmit,
  busy,
  error,
}: Props) {
  const [form, setForm] = useState<HomeworkUpdateInput>(() => defaultForm());
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>("");

  useEffect(() => {
    if (!open) {
      setFile(null);
      setFileName("");
      return;
    }
    if (editing) {
      setForm({
        title: editing.title,
        courseCode: editing.courseCode ?? "",
        description: editing.description ?? "",
        dueDate: editing.dueDate,
        status: editing.status,
        progressPct: editing.progressPct,
        grade: editing.grade,
        weight: editing.weight,
        notes: editing.notes ?? "",
      });
      setFileName(editing.fileName ?? "");
      return;
    }
    setForm({ ...defaultForm(), courseCode: defaultCourseCode ?? "" });
  }, [open, editing, defaultCourseCode]);

  // Back-compat: if the homework's saved code isn't one of the user's courses,
  // keep showing it as an option so editing an old row never silently clears it.
  const currentCode = form.courseCode?.trim() || "";
  const codeInList = courses.some((c) => c.code === currentCode);
  const courseValue = currentCode ? currentCode : NO_COURSE;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setFileName(selectedFile.name);
    }
  };

  const handleSubmit = () => {
    onSubmit(form, file || undefined);
    setFile(null);
    setFileName("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit assignment" : "Add assignment"}</DialogTitle>
          <DialogDescription>
            Upload homework assignments with due dates and track submission status.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="hw-title">Title</Label>
            <Input
              id="hw-title"
              placeholder="Chapter 5 exercises"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="hw-course">Course</Label>
              <Select
                value={courseValue}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, courseCode: v === NO_COURSE ? null : v }))
                }
              >
                <SelectTrigger id="hw-course">
                  <SelectValue placeholder="No course" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_COURSE}>No course</SelectItem>
                  {courses.map((c) => (
                    <SelectItem key={c.id} value={c.code}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                  {currentCode && !codeInList && (
                    <SelectItem value={currentCode}>{currentCode} (not in courses)</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="hw-due">Due date</Label>
              <Input
                id="hw-due"
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="hw-status">Status</Label>
            <Select
              value={form.status ?? "pending"}
              onValueChange={(v) => setForm((f) => ({ ...f, status: v as HomeworkStatus }))}
            >
              <SelectTrigger id="hw-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="graded">Graded</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="hw-weight">Weight (points of final grade)</Label>
              <Input
                id="hw-weight"
                type="number"
                min={0}
                max={100}
                step={0.5}
                onWheel={blurOnWheel}
                placeholder="e.g. 5"
                value={form.weight == null ? "" : String(form.weight)}
                onChange={(e) =>
                  setForm((f) => ({ ...f, weight: parseOptionalNumber(e.target.value) }))
                }
              />
            </div>
            {form.status === "graded" && (
              <div className="grid gap-2">
                <Label htmlFor="hw-grade">Grade</Label>
                <Input
                  id="hw-grade"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  onWheel={blurOnWheel}
                  placeholder="e.g. 92"
                  value={form.grade == null ? "" : String(form.grade)}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, grade: parseOptionalNumber(e.target.value) }))
                  }
                />
              </div>
            )}
          </div>

          {form.status === "graded" && form.weight != null && form.grade != null ? (
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Counts as{" "}
              <span className="font-semibold text-foreground">
                {round1((form.grade / 100) * form.weight)} / {round1(form.weight)}
              </span>{" "}
              points of the final grade.
            </p>
          ) : (
            form.status === "graded" &&
            form.weight == null && (
              <p className="text-xs text-muted-foreground">
                Add a weight to count this grade toward the course final.
              </p>
            )
          )}

          {form.status !== "graded" && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>Progress</Label>
                {form.progressPct == null ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={() => setForm((f) => ({ ...f, progressPct: 50 }))}
                  >
                    Set manually
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:underline"
                    onClick={() => setForm((f) => ({ ...f, progressPct: null }))}
                  >
                    Track by status
                  </button>
                )}
              </div>
              {form.progressPct == null ? (
                <p className="text-xs text-muted-foreground">
                  Tracking by status — blank counts as 0% until submitted.
                </p>
              ) : (
                <div className="flex items-center gap-3">
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[form.progressPct]}
                    onValueChange={(v) => setForm((f) => ({ ...f, progressPct: v[0] }))}
                    className="flex-1"
                    aria-label="Progress"
                  />
                  <span className="w-10 text-right text-sm tabular-nums">{form.progressPct}%</span>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="hw-description">Description</Label>
            <Textarea
              id="hw-description"
              placeholder="Assignment details..."
              value={form.description ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value || null }))}
              rows={3}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="hw-notes">Notes</Label>
            <Textarea
              id="hw-notes"
              placeholder="Additional notes..."
              value={form.notes ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || null }))}
              rows={2}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="hw-file">Upload file (max 25 MB)</Label>
            <div className="flex gap-2">
              <Input
                id="hw-file"
                type="file"
                onChange={handleFileChange}
                disabled={busy}
                className="cursor-pointer"
              />
              {fileName && (
                <button
                  onClick={() => {
                    setFile(null);
                    setFileName("");
                  }}
                  className="rounded p-2 hover:bg-destructive/10"
                  aria-label="Remove file"
                >
                  <X className="h-4 w-4 text-destructive" />
                </button>
              )}
            </div>
            {fileName && <p className="text-xs text-muted-foreground">Selected: {fileName}</p>}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            <Upload className="mr-2 h-4 w-4" />
            {editing ? "Update" : "Add"} assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
