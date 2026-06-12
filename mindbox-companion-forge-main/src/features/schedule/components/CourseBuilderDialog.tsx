import { useEffect, useState } from "react";
import { CalendarPlus, Plus, Trash2 } from "lucide-react";

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
import {
  buildCourseEvents,
  COURSE_COLORS,
  DAY_LABELS_FULL,
  MEETING_TYPES,
  validateScheduleTimes,
  type CourseExamDraft,
  type CourseMeetingDraft,
  type MeetingType,
} from "@/features/schedule/schedule";
import type { ScheduleEventInput } from "@/features/schedule/queries";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate?: string;
  onSubmit: (events: ScheduleEventInput[]) => void;
  busy?: boolean;
  error?: string | null;
};

function defaultMeeting(date?: string): CourseMeetingDraft {
  return {
    subtype: "lecture",
    dayOfWeek: date ? new Date(`${date}T12:00:00`).getDay() : 1,
    startTime: "09:00",
    endTime: "10:30",
    location: "",
  };
}

function defaultExam(date?: string): CourseExamDraft {
  return { title: "Final", eventDate: date ?? "", startTime: "09:00", endTime: "11:00" };
}

export function CourseBuilderDialog({
  open,
  onOpenChange,
  initialDate,
  onSubmit,
  busy,
  error,
}: Props) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [color, setColor] = useState<string>(COURSE_COLORS[0].value);
  const [notes, setNotes] = useState("");
  const [meetings, setMeetings] = useState<CourseMeetingDraft[]>([defaultMeeting(initialDate)]);
  const [exams, setExams] = useState<CourseExamDraft[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  // Reset to a fresh course each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName("");
    setCode("");
    setColor(COURSE_COLORS[0].value);
    setNotes("");
    setMeetings([defaultMeeting(initialDate)]);
    setExams([]);
    setLocalError(null);
  }, [open, initialDate]);

  const updateMeeting = (i: number, patch: Partial<CourseMeetingDraft>) =>
    setMeetings((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const updateExam = (i: number, patch: Partial<CourseExamDraft>) =>
    setExams((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  const submit = () => {
    setLocalError(null);
    if (!name.trim()) {
      setLocalError("Enter a course name.");
      return;
    }
    if (meetings.length === 0 && exams.length === 0) {
      setLocalError("Add at least one meeting or exam.");
      return;
    }
    for (const m of meetings) {
      const timeError = validateScheduleTimes(m.startTime, m.endTime);
      if (timeError) {
        setLocalError(`Meeting times: ${timeError}`);
        return;
      }
    }
    for (const ex of exams) {
      if (!ex.eventDate) {
        setLocalError("Pick a date for each exam.");
        return;
      }
      const timeError = validateScheduleTimes(ex.startTime, ex.endTime);
      if (timeError) {
        setLocalError(`Exam times: ${timeError}`);
        return;
      }
    }

    onSubmit(buildCourseEvents({ name, courseCode: code, color, notes, meetings, exams }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a course</DialogTitle>
          <DialogDescription>
            Set it up once — add every lecture, tutorial, and lab, plus exam dates. They&apos;ll all
            land on your calendar together.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          {/* Course basics */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="course-name">Course name</Label>
              <Input
                id="course-name"
                placeholder="Algorithms"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="course-code">Course code</Label>
              <Input
                id="course-code"
                placeholder="CS301"
                value={code}
                onChange={(e) => setCode(e.target.value)}
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
                    color === c.value
                      ? "scale-110 border-foreground"
                      : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: c.value }}
                  onClick={() => setColor(c.value)}
                />
              ))}
            </div>
          </div>

          {/* Meetings */}
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label>Meetings</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setMeetings((prev) => [...prev, defaultMeeting(initialDate)])}
              >
                <Plus className="h-4 w-4" /> Add meeting
              </Button>
            </div>

            {meetings.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No meetings — add lectures, tutorials, or labs above.
              </p>
            )}

            {meetings.map((m, i) => (
              <div key={i} className="rounded-lg border border-border p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label>Type</Label>
                    <Select
                      value={m.subtype}
                      onValueChange={(v) => updateMeeting(i, { subtype: v as MeetingType })}
                    >
                      <SelectTrigger>
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
                  <div className="grid gap-1.5">
                    <Label>Day</Label>
                    <Select
                      value={String(m.dayOfWeek)}
                      onValueChange={(v) => updateMeeting(i, { dayOfWeek: Number(v) })}
                    >
                      <SelectTrigger>
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
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end">
                  <div className="grid gap-1.5">
                    <Label>Starts</Label>
                    <Input
                      type="time"
                      value={m.startTime}
                      onChange={(e) => updateMeeting(i, { startTime: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Ends</Label>
                    <Input
                      type="time"
                      value={m.endTime}
                      onChange={(e) => updateMeeting(i, { endTime: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Location</Label>
                    <Input
                      placeholder="Room 204"
                      value={m.location}
                      onChange={(e) => updateMeeting(i, { location: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-danger"
                    aria-label="Remove meeting"
                    onClick={() => setMeetings((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Exams */}
          <div className="grid gap-3">
            <div className="flex items-center justify-between">
              <Label>Exams (optional)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setExams((prev) => [...prev, defaultExam(initialDate)])}
              >
                <Plus className="h-4 w-4" /> Add exam
              </Button>
            </div>

            {exams.map((ex, i) => (
              <div key={i} className="rounded-lg border border-border p-3">
                <div className="grid gap-3 sm:grid-cols-[1.2fr_1fr_auto] sm:items-end">
                  <div className="grid gap-1.5">
                    <Label>Name</Label>
                    <Input
                      placeholder="Final"
                      value={ex.title}
                      onChange={(e) => updateExam(i, { title: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={ex.eventDate}
                      onChange={(e) => updateExam(i, { eventDate: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-danger"
                    aria-label="Remove exam"
                    onClick={() => setExams((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label>Starts</Label>
                    <Input
                      type="time"
                      value={ex.startTime}
                      onChange={(e) => updateExam(i, { startTime: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Ends</Label>
                    <Input
                      type="time"
                      value={ex.endTime}
                      onChange={(e) => updateExam(i, { endTime: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="course-notes">Notes (optional)</Label>
            <Textarea
              id="course-notes"
              placeholder="Applies to every meeting and exam — e.g. online link, instructor."
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {(localError || error) && <p className="text-sm text-danger">{localError ?? error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={submit}>
            <CalendarPlus className="h-4 w-4" />
            {busy ? "Adding…" : "Add course"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
