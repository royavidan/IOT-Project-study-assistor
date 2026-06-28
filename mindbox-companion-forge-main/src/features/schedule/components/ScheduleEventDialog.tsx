import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
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
import type { ScheduleCategory, ScheduleEvent, ScheduleKind } from "@/features/schedule/schedule";
import { COURSE_COLORS, DAY_LABELS_FULL, MEETING_TYPES } from "@/features/schedule/schedule";
import type { ScheduleEventInput } from "@/features/schedule/queries";

const EXAM_COLOR = "#f43f5e";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate?: string;
  editing?: ScheduleEvent | null;
  onSubmit: (input: ScheduleEventInput) => void;
  busy?: boolean;
  error?: string | null;
};

const defaultForm = (date?: string): ScheduleEventInput => ({
  title: "",
  courseCode: "",
  location: "",
  color: COURSE_COLORS[0].value,
  category: "class",
  subtype: "lecture",
  kind: "weekly",
  dayOfWeek: date ? new Date(`${date}T12:00:00`).getDay() : 1,
  eventDate: date ?? null,
  startTime: "09:00",
  endTime: "10:30",
  notes: "",
});

export function ScheduleEventDialog({
  open,
  onOpenChange,
  initialDate,
  editing,
  onSubmit,
  busy,
  error,
}: Props) {
  const [form, setForm] = useState<ScheduleEventInput>(() => defaultForm(initialDate));

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        title: editing.title,
        courseCode: editing.courseCode ?? "",
        location: editing.location ?? "",
        color: editing.color,
        category: editing.category,
        subtype: editing.subtype ?? "lecture",
        kind: editing.kind,
        dayOfWeek: editing.dayOfWeek,
        eventDate: editing.eventDate,
        startTime: editing.startTime,
        endTime: editing.endTime,
        notes: editing.notes ?? "",
      });
      return;
    }
    setForm(defaultForm(initialDate));
  }, [open, editing, initialDate]);

  const setKind = (kind: ScheduleKind) => {
    setForm((f) => ({
      ...f,
      kind,
      dayOfWeek:
        kind === "weekly"
          ? (f.dayOfWeek ?? (initialDate ? new Date(`${initialDate}T12:00:00`).getDay() : 1))
          : null,
      eventDate: kind === "once" ? (f.eventDate ?? initialDate ?? null) : null,
    }));
  };

  const setCategory = (category: ScheduleCategory) => {
    setForm((f) => ({
      ...f,
      category,
      // Exams are one-off, dated, and red by default.
      kind: category === "exam" ? "once" : f.kind,
      color: category === "exam" ? EXAM_COLOR : f.color,
      subtype: category === "exam" ? null : (f.subtype ?? "lecture"),
      eventDate: category === "exam" ? (f.eventDate ?? initialDate ?? null) : f.eventDate,
    }));
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit event" : "Add to schedule"}
      description="Track lectures, labs, tutorials, and exams. Repeating courses show every week on your calendar."
      className="sm:max-w-lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => onSubmit(form)}>
            {busy ? "Saving…" : editing ? "Save changes" : "Add to calendar"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 py-2">
        <div className="grid gap-2">
          <Label htmlFor="sched-title">Name</Label>
          <Input
            id="sched-title"
            placeholder="Algorithms lecture"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="sched-category">Type</Label>
            <Select
              value={form.category ?? "class"}
              onValueChange={(v) => setCategory(v as ScheduleCategory)}
            >
              <SelectTrigger id="sched-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="class">Class</SelectItem>
                <SelectItem value="exam">Exam</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.category === "class" && (
            <div className="grid gap-2">
              <Label htmlFor="sched-subtype">Meeting</Label>
              <Select
                value={(form.subtype as string) ?? "lecture"}
                onValueChange={(v) => setForm((f) => ({ ...f, subtype: v }))}
              >
                <SelectTrigger id="sched-subtype">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEETING_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="sched-code">Course code</Label>
            <Input
              id="sched-code"
              placeholder="CS301"
              value={form.courseCode ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, courseCode: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sched-location">Location</Label>
            <Input
              id="sched-location"
              placeholder="Room 204"
              value={form.location ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
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
                onClick={() => setForm((f) => ({ ...f, color: c.value }))}
              />
            ))}
          </div>
        </div>

        {form.category === "exam" ? (
          <div className="grid gap-2">
            <Label htmlFor="sched-date">Exam date</Label>
            <Input
              id="sched-date"
              type="date"
              value={form.eventDate ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, eventDate: e.target.value || null }))}
            />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="sched-kind">Repeats</Label>
              <Select value={form.kind} onValueChange={(v) => setKind(v as ScheduleKind)}>
                <SelectTrigger id="sched-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Every week</SelectItem>
                  <SelectItem value="once">One time only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.kind === "weekly" ? (
              <div className="grid gap-2">
                <Label htmlFor="sched-dow">Day</Label>
                <Select
                  value={String(form.dayOfWeek ?? 1)}
                  onValueChange={(v) => setForm((f) => ({ ...f, dayOfWeek: Number(v) }))}
                >
                  <SelectTrigger id="sched-dow">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DAY_LABELS_FULL.map((label, index) => (
                      <SelectItem key={label} value={String(index)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="sched-date">Date</Label>
                <Input
                  id="sched-date"
                  type="date"
                  value={form.eventDate ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, eventDate: e.target.value || null }))}
                />
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="sched-start">Starts</Label>
            <Input
              id="sched-start"
              type="time"
              value={form.startTime}
              onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sched-end">Ends</Label>
            <Input
              id="sched-end"
              type="time"
              value={form.endTime}
              onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="sched-notes">Notes</Label>
          <Textarea
            id="sched-notes"
            placeholder="Bring calculator, online link, etc."
            rows={3}
            value={form.notes ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </ResponsiveModal>
  );
}
