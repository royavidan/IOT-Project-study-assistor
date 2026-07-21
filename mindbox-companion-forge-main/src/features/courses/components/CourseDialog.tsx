import { useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";

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
import { Textarea } from "@/components/ui/textarea";
import { COURSE_COLORS } from "@/features/schedule/schedule";
import type { Course } from "@/features/courses/courses";
import type { CourseInput } from "@/features/courses/queries";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Course | null;
  onSubmit: (input: CourseInput) => void;
  busy?: boolean;
  error?: string | null;
};

interface FormState {
  code: string;
  name: string;
  color: string;
  instructor: string;
  credits: string;
  targetGrade: string;
  notes: string;
}

const emptyForm = (): FormState => ({
  code: "",
  name: "",
  color: COURSE_COLORS[0].value,
  instructor: "",
  credits: "",
  targetGrade: "",
  notes: "",
});

function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isNaN(n) ? null : n;
}

export function CourseDialog({ open, onOpenChange, editing, onSubmit, busy, error }: Props) {
  const [form, setForm] = useState<FormState>(() => emptyForm());

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        code: editing.code,
        name: editing.name,
        color: editing.color,
        instructor: editing.instructor ?? "",
        credits: editing.credits == null ? "" : String(editing.credits),
        targetGrade: editing.targetGrade == null ? "" : String(editing.targetGrade),
        notes: editing.notes ?? "",
      });
      return;
    }
    setForm(emptyForm());
  }, [open, editing]);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const handleSubmit = () => {
    onSubmit({
      code: form.code,
      name: form.name,
      color: form.color,
      instructor: form.instructor.trim() || null,
      credits: parseOptionalNumber(form.credits),
      targetGrade: parseOptionalNumber(form.targetGrade),
      notes: form.notes.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit course" : "Add course"}</DialogTitle>
          <DialogDescription>
            Give the course a code that matches its calendar events and homework, so everything
            rolls up together.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
            <div className="grid gap-2">
              <Label htmlFor="course-code">Code</Label>
              <Input
                id="course-code"
                placeholder="CS101"
                value={form.code}
                onChange={(e) => set({ code: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="course-name">Name</Label>
              <Input
                id="course-name"
                placeholder="Intro to Computer Science"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {COURSE_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-label={c.label}
                  className={`h-8 w-8 rounded-full border-2 transition-transform ${
                    form.color === c.value
                      ? "scale-110 border-foreground"
                      : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: c.value }}
                  onClick={() => set({ color: c.value })}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="course-instructor">Instructor (optional)</Label>
            <Input
              id="course-instructor"
              placeholder="Dr. Levi"
              value={form.instructor}
              onChange={(e) => set({ instructor: e.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="course-credits">Credits (optional)</Label>
              <Input
                id="course-credits"
                type="number"
                min={0}
                step={0.5}
                placeholder="3"
                value={form.credits}
                onChange={(e) => set({ credits: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="course-target">Target grade (optional)</Label>
              <Input
                id="course-target"
                type="number"
                min={0}
                max={100}
                placeholder="90"
                value={form.targetGrade}
                onChange={(e) => set({ targetGrade: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="course-notes">Notes (optional)</Label>
            <Textarea
              id="course-notes"
              placeholder="Anything to remember about this course…"
              rows={2}
              value={form.notes}
              onChange={(e) => set({ notes: e.target.value })}
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={busy}>
            <GraduationCap className="mr-2 h-4 w-4" />
            {editing ? "Save course" : "Add course"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
