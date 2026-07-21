import { useMemo, useState } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { STATUS_META, STATUS_ORDER } from "@/features/homework/status";
import type { HomeworkAssignment, HomeworkStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { HomeworkBoardCard } from "./HomeworkBoardCard";

interface Props {
  assignments: HomeworkAssignment[];
  onMove: (id: string, status: HomeworkStatus) => void;
  onEdit: (homework: HomeworkAssignment) => void;
  onDelete: (id: string) => void;
  hideCourse?: boolean;
}

function byDueDate(a: HomeworkAssignment, b: HomeworkAssignment): number {
  return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
}

function Column({
  status,
  items,
  onMove,
  onEdit,
  onDelete,
  hideCourse,
}: {
  status: HomeworkStatus;
  items: HomeworkAssignment[];
  onMove: Props["onMove"];
  onEdit: Props["onEdit"];
  onDelete: Props["onDelete"];
  hideCourse?: boolean;
}) {
  const meta = STATUS_META[status];
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <div className="mb-3 flex items-center gap-2">
        <span className={cn("h-2.5 w-2.5 rounded-full", meta.dot)} aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
        <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {items.length}
        </span>
      </div>
      <div className="space-y-2.5">
        {items.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">Nothing here yet.</p>
        ) : (
          items.map((hw) => (
            <HomeworkBoardCard
              key={hw.id}
              homework={hw}
              onMove={onMove}
              onEdit={onEdit}
              onDelete={onDelete}
              hideCourse={hideCourse}
            />
          ))
        )}
      </div>
    </div>
  );
}

export function HomeworkBoard({ assignments, onMove, onEdit, onDelete, hideCourse }: Props) {
  const [mobileStatus, setMobileStatus] = useState<HomeworkStatus>("pending");

  const grouped = useMemo(() => {
    const map: Record<HomeworkStatus, HomeworkAssignment[]> = {
      pending: [],
      submitted: [],
      graded: [],
    };
    for (const hw of assignments) map[hw.status].push(hw);
    for (const status of STATUS_ORDER) map[status].sort(byDueDate);
    return map;
  }, [assignments]);

  return (
    <>
      {/* Desktop: three columns side by side. */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-3">
        {STATUS_ORDER.map((status) => (
          <Column
            key={status}
            status={status}
            items={grouped[status]}
            onMove={onMove}
            onEdit={onEdit}
            onDelete={onDelete}
            hideCourse={hideCourse}
          />
        ))}
      </div>

      {/* Mobile: one column at a time, switched by a segmented control. */}
      <div className="lg:hidden">
        <ToggleGroup
          type="single"
          value={mobileStatus}
          onValueChange={(v) => v && setMobileStatus(v as HomeworkStatus)}
          variant="outline"
          className="mb-4 grid w-full grid-cols-3"
        >
          {STATUS_ORDER.map((status) => (
            <ToggleGroupItem key={status} value={status} className="min-h-10 text-xs">
              {STATUS_META[status].label}
              <span className="ml-1 text-muted-foreground">({grouped[status].length})</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <Column
          status={mobileStatus}
          items={grouped[mobileStatus]}
          onMove={onMove}
          onEdit={onEdit}
          onDelete={onDelete}
          hideCourse={hideCourse}
        />
      </div>
    </>
  );
}
