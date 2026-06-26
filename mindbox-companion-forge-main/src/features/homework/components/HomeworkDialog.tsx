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
import { Textarea } from "@/components/ui/textarea";
import type { HomeworkAssignment, HomeworkStatus } from "@/lib/types";
import type { HomeworkInput, HomeworkUpdateInput } from "@/lib/queries/homework";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: HomeworkAssignment | null;
  onSubmit: (input: HomeworkInput | HomeworkUpdateInput, file?: File) => void;
  busy?: boolean;
  error?: string | null;
};

const defaultForm = (): HomeworkInput => ({
  title: "",
  courseCode: "",
  description: "",
  dueDate: new Date().toISOString().split("T")[0],
  status: "pending",
  notes: "",
});

export function HomeworkDialog({ open, onOpenChange, editing, onSubmit, busy, error }: Props) {
  const [form, setForm] = useState<HomeworkInput>(() => defaultForm());
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
        notes: editing.notes ?? "",
      });
      setFileName(editing.fileName ?? "");
      return;
    }
    setForm(defaultForm());
  }, [open, editing]);

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
              <Input
                id="hw-course"
                placeholder="CS101"
                value={form.courseCode ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, courseCode: e.target.value || null }))}
              />
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
            {fileName && (
              <p className="text-xs text-muted-foreground">
                Selected: {fileName}
              </p>
            )}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
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
