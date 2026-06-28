import { CalendarPlus, FileUp, GraduationCap, Plus } from "lucide-react";

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
}: {
  onAddEvent: () => void;
  onAddCourse: () => void;
  onImport: () => void;
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
