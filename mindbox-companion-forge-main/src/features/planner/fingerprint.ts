// Plan staleness fingerprint. Hashes the schedule + homework facts an AI plan
// was generated from; when the current fingerprint differs from the stored
// `user_settings.last_plan_fingerprint`, the plan is stale ("your schedule
// changed — regenerate"). Planner-GENERATED study blocks are excluded — the
// commit itself writes those, and including them would mark every fresh plan
// stale immediately. Pure + deterministic (FNV-1a, no crypto dependency).

import type { HomeworkAssignment } from "@/lib/types";
import type { ScheduleEvent } from "@/features/schedule/schedule";

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in uint32 range.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Stable hash of everything a plan depends on. */
export function planFingerprint(events: ScheduleEvent[], homework: HomeworkAssignment[]): string {
  const lines: string[] = [];

  for (const e of events) {
    if (e.category === "study" && e.planGenerated) continue;
    lines.push(
      [
        "ev",
        e.id,
        e.category,
        e.kind,
        e.dayOfWeek ?? "",
        e.eventDate ?? "",
        e.startTime,
        e.endTime,
      ].join("|"),
    );
  }

  for (const hw of homework) {
    lines.push(
      ["hw", hw.id, hw.dueDate, hw.status, hw.progressPct ?? "", hw.estimatedMinutes ?? ""].join(
        "|",
      ),
    );
  }

  lines.sort();
  return fnv1a(lines.join("\n"));
}
