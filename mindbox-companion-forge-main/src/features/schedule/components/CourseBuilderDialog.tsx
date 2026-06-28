import { useEffect, useState } from "react";
import { CalendarPlus, ChevronDown, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  meetingTypeLabel,
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
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add a course"
      description="Add every lecture, tutorial, and lab, plus exam dates — they all land on your calendar together."
      className="sm:max-w-2xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={submit}>
            <CalendarPlus className="h-4 w-4" />
            {busy ? "Adding…" : "Add course"}
          </Button>
        </>
      }
    >
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
            <Collapsible key={i} defaultOpen className="rounded-lg border border-border">
              <div className="flex items-center gap-2 p-3">
                <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                  <span className="truncate text-sm font-medium">
                    {meetingTypeLabel(m.subtype)} · {DAY_LABELS_FULL[m.dayOfWeek]}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {m.startTime}–{m.endTime}
                  </span>
                </CollapsibleTrigger>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-danger"
                  aria-label="Remove meeting"
                  onClick={() => setMeetings((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <CollapsibleContent className="space-y-3 border-t border-border p-3">
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
                <div className="grid gap-3 sm:grid-cols-2">
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
                </div>
                <div className="grid gap-1.5">
                  <Label>Location</Label>
                  <Input
                    placeholder="Room 204"
                    value={m.location}
                    onChange={(e) => updateMeeting(i, { location: e.target.value })}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
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
            <Collapsible key={i} defaultOpen className="rounded-lg border border-border">
              <div className="flex items-center gap-2 p-3">
                <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
                  <span className="truncate text-sm font-medium">{ex.title.trim() || "Exam"}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {ex.eventDate || "no date"}
                  </span>
                </CollapsibleTrigger>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-danger"
                  aria-label="Remove exam"
                  onClick={() => setExams((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <CollapsibleContent className="space-y-3 border-t border-border p-3">
                <div className="grid gap-3 sm:grid-cols-2">
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
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
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
              </CollapsibleContent>
            </Collapsible>
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
    </ResponsiveModal>
  );
}
