import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getSupabaseServerClient } from "@/lib/supabase/server";

const deleteInput = z.object({
  sessionId: z.string().uuid("Invalid session id."),
});

async function requireUser() {
  const supabase = getSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw new Error(`Unable to verify session: ${error.message}`);
  if (!user) throw new Error("You must be signed in to delete a session.");
  return { user, supabase };
}

/** Delete a focus session owned by the signed-in user (RLS-enforced). */
export const deleteSession = createServerFn({ method: "POST" })
  .inputValidator(deleteInput)
  .handler(async ({ data }) => {
    const { user, supabase } = await requireUser();

    const { data: row, error: lookupError } = await supabase
      .from("sessions")
      .select("id")
      .eq("id", data.sessionId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (lookupError) throw new Error(`Could not look up session: ${lookupError.message}`);
    if (!row) throw new Error("Session not found or you don't have permission to delete it.");

    const { error: deleteError } = await supabase
      .from("sessions")
      .delete()
      .eq("id", data.sessionId)
      .eq("user_id", user.id);

    if (deleteError) throw new Error(`Failed to delete session: ${deleteError.message}`);

    return { ok: true as const, sessionId: data.sessionId };
  });
