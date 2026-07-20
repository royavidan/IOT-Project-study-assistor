// Remote commands (site -> box): the /device page enqueues rows into
// device_commands; the box receives ONE per config poll and acks it on the
// next poll (see migration 0024 for the lifecycle). Worst-case latency is one
// 60s poll — the UI says so.
//
// Ownership model (matches pairing.functions.ts): requireUser() via the
// RLS-scoped client, then the admin client AFTER an explicit owner check.
// The browser reads command state through a SELECT-only RLS policy.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase/server";
import { sanitizeCommandText } from "./command-encode";

const sendCommandInput = z
  .object({
    deviceId: z.string().min(1),
    type: z.enum(["start", "end", "ring", "message"]),
    /** Session length for `start`. */
    durationMin: z.number().int().min(5).max(120).optional(),
    /** Message body for `message` (sanitized + byte-capped before storage). */
    text: z.string().trim().min(1).max(80).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "start" && v.durationMin == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["durationMin"],
        message: "Pick a session length.",
      });
    }
    if (v.type === "message" && !v.text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["text"],
        message: "Write a message to send.",
      });
    }
  });

/** Backpressure: if the box hasn't picked up this many, something is off. */
const MAX_PENDING_COMMANDS = 5;

/** Mirrors the serve-side expiry (ingest.server.ts): older pending rows are dead. */
const COMMAND_EXPIRY_MS = 10 * 60_000;

async function requireUser() {
  const {
    data: { user },
    error,
  } = await getSupabaseServerClient().auth.getUser();
  if (error) throw new Error(`Unable to verify session: ${error.message}`);
  if (!user) throw new Error("You must be signed in to control your MindBox.");
  return user;
}

export const sendDeviceCommand = createServerFn({ method: "POST" })
  .inputValidator(sendCommandInput)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const admin = getSupabaseAdminClient();

    const { data: device, error: devError } = await admin
      .from("devices")
      .select("id")
      .eq("id", data.deviceId)
      .eq("owner_user_id", user.id)
      .maybeSingle();
    if (devError) throw new Error(`Could not verify your device: ${devError.message}`);
    if (!device) throw new Error("That MindBox isn't linked to your account.");

    const { count, error: countError } = await admin
      .from("device_commands")
      .select("id", { count: "exact", head: true })
      .eq("device_id", data.deviceId)
      .is("delivered_at", null)
      .gt("created_at", new Date(Date.now() - COMMAND_EXPIRY_MS).toISOString());
    if (countError) throw new Error(`Could not check the queue: ${countError.message}`);
    if ((count ?? 0) >= MAX_PENDING_COMMANDS) {
      throw new Error(
        "Your MindBox hasn't picked up earlier commands yet — is it online? Try again in a minute.",
      );
    }

    const text = data.type === "message" ? sanitizeCommandText(data.text ?? "") : null;
    if (data.type === "message" && !text) {
      throw new Error("Message is empty after removing unsupported characters.");
    }

    const { data: row, error: insertError } = await admin
      .from("device_commands")
      .insert({
        device_id: data.deviceId,
        user_id: user.id,
        type: data.type,
        arg: data.type === "start" ? (data.durationMin ?? null) : null,
        text,
      })
      .select("id")
      .single();
    if (insertError) throw new Error(`Failed to queue the command: ${insertError.message}`);

    return { ok: true as const, id: Number((row as { id: number }).id) };
  });
