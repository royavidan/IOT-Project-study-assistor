import { CalendarPlus, FileUp, GraduationCap, Plus, Sparkles, Trash2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Mobile-only floating action button to add an event or a course. Sits above
 * the app's bottom navigation (which clears the `pb-24` content padding). */
export function CalendarFab({
  onAddEvent,
  onAddCourse,
  onImport,
  onPlanWeek,
  onClearPlan,
}: {
  onAddEvent: () => void;
  onAddCourse: () => void;
  onImport: () => void;
  /** Optional — omit to hide the "Auto-plan study time" entry. */
  onPlanWeek?: () => void;
  /** Optional — omit to hide "Clear auto-plan" (show only when a plan exists). */
  onClearPlan?: () => void;
}) {
  return (
    <div className="fixed bottom-24 right-4 z-30 lg:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label="Add to calendar"
            className="grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95"
          >
            <Plus className="h-6 w-6" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" sideOffset={8} className="w-48">
          <DropdownMenuItem onSelect={onAddEvent}>
            <CalendarPlus className="mr-2 h-4 w-4" />
            Add event
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onAddCourse}>
            <GraduationCap className="mr-2 h-4 w-4" />
            Add course
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onImport}>
            <FileUp className="mr-2 h-4 w-4" />
            Import calendar
          </DropdownMenuItem>
          {onPlanWeek && (
            <DropdownMenuItem onSelect={onPlanWeek}>
              <Sparkles className="mr-2 h-4 w-4" />
              Auto-plan study time
            </DropdownMenuItem>
          )}
          {onClearPlan && (
            <DropdownMenuItem onSelect={onClearPlan}>
              <Trash2 className="mr-2 h-4 w-4" />
              Clear auto-plan
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
