import { ShieldCheck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReviewerStudent } from "@/features/social/reviewer";

export function StudentScopePicker({
  students,
  value,
  onChange,
  isReviewerView,
  studentName,
}: {
  students: ReviewerStudent[];
  value: string;
  onChange: (next: "mine" | string) => void;
  isReviewerView?: boolean;
  studentName?: string;
}) {
  if (students.length === 0) return null;

  return (
    <Card className="mb-4 border-info/20 bg-info/5">
      <CardContent className="flex flex-wrap items-end gap-3 p-4">
        <div className="grid gap-1.5">
          <Label htmlFor="student-scope">Viewing</Label>
          <Select value={value} onValueChange={(v) => onChange(v as "mine" | string)}>
            <SelectTrigger id="student-scope" className="w-[220px]">
              <SelectValue placeholder="Select student" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">My sessions</SelectItem>
              {students.map((s) => (
                <SelectItem key={s.ownerUserId} value={s.ownerUserId}>
                  {s.displayName} (reviewer)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isReviewerView && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Read-only view for {studentName ?? "student"} — no edits or deletes.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
