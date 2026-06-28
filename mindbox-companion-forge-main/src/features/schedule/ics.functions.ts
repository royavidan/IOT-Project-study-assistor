import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { normalizeIcsUrl, parseIcs, type ParsedIcs } from "@/features/schedule/ics";

async function requireUser() {
  const supabase = getSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw new Error(`Unable to verify session: ${error.message}`);
  if (!user) throw new Error("You must be signed in.");
  return { user, supabase };
}

async function fetchIcs(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "text/calendar, text/plain, */*" } });
  } catch {
    throw new Error("Could not reach that calendar link.");
  }
  if (!res.ok) throw new Error(`Could not fetch the calendar (HTTP ${res.status}).`);
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error("That link did not return a calendar (.ics) file.");
  }
  return text;
}

function hostFrom(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "Imported calendar";
  }
}

async function persistParsed(
  supabase: SupabaseClient<Database>,
  userId: string,
  importId: string,
  parsed: ParsedIcs,
): Promise<void> {
  if (parsed.courses.length > 0) {
    const courseRows = parsed.courses.map((c) => ({
      user_id: userId,
      code: c.code,
      name: c.name,
      color: c.color,
      ics_import_id: importId,
    }));
    const { error } = await supabase
      .from("courses")
      .upsert(courseRows, { onConflict: "user_id,code" });
    if (error) throw new Error(`Could not save courses: ${error.message}`);
  }

  const eventRows = parsed.events.map((e) => ({
    user_id: userId,
    title: e.title,
    course_code: e.courseCode,
    location: e.location,
    color: e.color,
    category: e.category,
    subtype: e.category === "exam" ? null : e.subtype,
    kind: e.kind,
    day_of_week: e.kind === "weekly" ? e.dayOfWeek : null,
    event_date: e.kind === "once" ? e.eventDate : null,
    start_time: e.startTime,
    end_time: e.endTime,
    notes: e.notes,
    ics_import_id: importId,
  }));
  if (eventRows.length > 0) {
    const { error } = await supabase.from("schedule_events").insert(eventRows);
    if (error) throw new Error(`Could not save schedule: ${error.message}`);
  }
}

function summarize(parsed: ParsedIcs, importId: string) {
  const exams = parsed.events.filter((e) => e.category === "exam").length;
  return {
    importId,
    courses: parsed.courses.length,
    classes: parsed.events.length - exams,
    exams,
  };
}

const importInput = z.object({
  name: z.string().trim().max(120).optional(),
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("url"), url: z.string().trim().min(1) }),
    z.object({ type: z.literal("file"), text: z.string().min(1).max(2_000_000) }),
  ]),
});

export const importIcsFn = createServerFn({ method: "POST" })
  .validator(importInput)
  .handler(async ({ data }) => {
    const { user, supabase } = await requireUser();

    let text: string;
    let sourceType: "url" | "file";
    let sourceUrl: string | null = null;
    if (data.source.type === "url") {
      sourceType = "url";
      sourceUrl = normalizeIcsUrl(data.source.url);
      text = await fetchIcs(sourceUrl);
    } else {
      sourceType = "file";
      text = data.source.text;
    }

    const parsed = parseIcs(text);
    if (parsed.events.length === 0) {
      throw new Error("No classes or exams were found in that calendar.");
    }

    const name =
      data.name?.trim() ||
      parsed.name?.trim() ||
      (sourceUrl ? hostFrom(sourceUrl) : "Imported calendar");

    const { data: imp, error: impError } = await supabase
      .from("ics_imports")
      .insert({
        user_id: user.id,
        name,
        source_type: sourceType,
        source_url: sourceUrl,
        event_count: parsed.events.length,
        last_synced_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (impError || !imp) throw new Error(impError?.message ?? "Could not create the import.");

    await persistParsed(supabase, user.id, imp.id as string, parsed);
    return summarize(parsed, imp.id as string);
  });

const syncInput = z.object({ importId: z.string().uuid() });

export const syncIcsImportFn = createServerFn({ method: "POST" })
  .validator(syncInput)
  .handler(async ({ data }) => {
    const { user, supabase } = await requireUser();

    const { data: imp, error: loadError } = await supabase
      .from("ics_imports")
      .select("id, source_type, source_url")
      .eq("id", data.importId)
      .single();
    if (loadError || !imp) throw new Error(loadError?.message ?? "Import not found.");
    if (imp.source_type !== "url" || !imp.source_url) {
      throw new Error("This calendar was uploaded as a file — re-import it to update.");
    }
    const importId = imp.id as string;

    const text = await fetchIcs(imp.source_url as string);
    const parsed = parseIcs(text);

    // Replace exactly this import's events; manual + other imports are untouched.
    const { error: delError } = await supabase
      .from("schedule_events")
      .delete()
      .eq("ics_import_id", importId);
    if (delError) throw new Error(`Could not refresh schedule: ${delError.message}`);

    await persistParsed(supabase, user.id, importId, parsed);

    await supabase
      .from("ics_imports")
      .update({ event_count: parsed.events.length, last_synced_at: new Date().toISOString() })
      .eq("id", importId);

    return summarize(parsed, importId);
  });
