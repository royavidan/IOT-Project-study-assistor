import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { BookOpen, GraduationCap } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { DEV_ITEMS, NAV_SECTIONS, UTILITY_ITEMS, type NavItem } from "@/lib/nav";

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();

  // ⌘K / Ctrl-K toggles the palette from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const go = (to: string) => {
    onOpenChange(false);
    // Cast: every `to` here is a real route; the literal keeps TanStack happy.
    void navigate({ to: to as "/" });
  };

  const groups: { label: string; items: NavItem[] }[] = [
    ...NAV_SECTIONS.map((s) => ({ label: s.label, items: s.items })),
    { label: "Account", items: UTILITY_ITEMS },
    ...(DEV_ITEMS.length ? [{ label: "Developer", items: DEV_ITEMS }] : []),
  ];

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages and actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g.label} heading={g.label}>
            {g.items.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.to}
                  value={`${item.label} ${item.keywords ?? ""}`}
                  onSelect={() => go(item.to)}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {item.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="new assignment add homework" onSelect={() => go("/assignments")}>
            <BookOpen className="mr-2 h-4 w-4" />
            New assignment
          </CommandItem>
          <CommandItem value="new course add course" onSelect={() => go("/courses")}>
            <GraduationCap className="mr-2 h-4 w-4" />
            New course
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
