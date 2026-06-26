import { formatDistanceToNow } from "date-fns";
import { Calendar, FileText, Trash2, Edit2, Download, CheckCircle, Clock, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { HomeworkAssignment } from "@/lib/types";
import { cn } from "@/lib/utils";

interface HomeworkCardProps {
  homework: HomeworkAssignment;
  onEdit: (homework: HomeworkAssignment) => void;
  onDelete: (id: string) => void;
  isDeleting?: boolean;
}

const statusConfig = {
  pending: {
    label: "Pending",
    icon: Clock,
    color: "bg-yellow-100 text-yellow-800 border-yellow-300",
  },
  submitted: {
    label: "Submitted",
    icon: CheckCircle,
    color: "bg-blue-100 text-blue-800 border-blue-300",
  },
  graded: {
    label: "Graded",
    icon: CheckCircle,
    color: "bg-green-100 text-green-800 border-green-300",
  },
};

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

function isOverdue(dueDate: string): boolean {
  return new Date(dueDate) < new Date() && new Date(dueDate).toDateString() !== new Date().toDateString();
}

export function HomeworkCard({
  homework,
  onEdit,
  onDelete,
  isDeleting,
}: HomeworkCardProps) {
  const StatusIcon = statusConfig[homework.status].icon;
  const isLate = isOverdue(homework.dueDate) && homework.status === "pending";

  return (
    <div
      className={cn(
        "rounded-lg border p-4 transition-colors",
        isLate ? "border-red-300 bg-red-50" : "border-border bg-card"
      )}
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">{homework.title}</h3>
            <Badge
              variant="outline"
              className={statusConfig[homework.status].color}
            >
              <StatusIcon className="mr-1 h-3 w-3" />
              {statusConfig[homework.status].label}
            </Badge>
          </div>
          {homework.courseCode && (
            <p className="text-sm text-muted-foreground">{homework.courseCode}</p>
          )}
        </div>
      </div>

      {homework.description && (
        <p className="mb-3 text-sm text-muted-foreground">{homework.description}</p>
      )}

      <div className="mb-3 flex flex-wrap gap-3 text-sm">
        <div className="flex items-center gap-1 text-muted-foreground">
          <Calendar className={cn("h-4 w-4", isLate && "text-red-500")} />
          <span className={isLate ? "text-red-500 font-medium" : ""}>
            Due {formatDistanceToNow(new Date(homework.dueDate), { addSuffix: true })}
          </span>
        </div>

        {homework.grade !== null && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span>Grade: {homework.grade}</span>
          </div>
        )}

        {homework.fileSizeBytes && (
          <div className="flex items-center gap-1 text-muted-foreground">
            <FileText className="h-4 w-4" />
            <span>{formatFileSize(homework.fileSizeBytes)}</span>
          </div>
        )}
      </div>

      {homework.notes && (
        <p className="mb-3 rounded bg-muted/50 p-2 text-xs text-muted-foreground italic">
          {homework.notes}
        </p>
      )}

      <div className="flex gap-2">
        {homework.fileUrl && (
          <Button
            size="sm"
            variant="outline"
            asChild
          >
            <a href={homework.fileUrl} target="_blank" rel="noopener noreferrer">
              <Download className="mr-1 h-3 w-3" />
              Download
            </a>
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onEdit(homework)}
        >
          <Edit2 className="mr-1 h-3 w-3" />
          Edit
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:bg-destructive/10"
          onClick={() => onDelete(homework.id)}
          disabled={isDeleting}
        >
          <Trash2 className="mr-1 h-3 w-3" />
          Delete
        </Button>
      </div>
    </div>
  );
}
