// Thin generic LLM wrapper: one structured-output call with a validation
// ladder (JSON.parse → Zod → one corrective retry → typed error). Shared by
// the LLM planner, the check-in replanner and the load-review narrative, so
// every feature gets the same malformed-output handling.
//
// Backend: routes through the Supabase `generate` Edge Function
// (src/lib/ai/client.ts → supabase/functions/generate), which exchanges the
// Google credential (a Supabase secret) for a short-lived token via Vertex/ADC.
// No Google credential ever lives in this app's env — only the public Supabase
// URL + anon key, used to reach the function. Server-only so it never bundles
// to the client.

import "@tanstack/react-start/server-only";

import type { z } from "zod";

import { AiRequestError, generate } from "@/lib/ai/client";

/** The model every MindBox LLM feature uses. */
export const GEMINI_MODEL = "gemini-2.5-flash";

/** The model's output failed validation twice — callers fall back gracefully. */
export class LlmOutputError extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = "LlmOutputError";
    this.raw = raw;
  }
}

/** The AI backend isn't configured/reachable — the feature is unavailable, not broken. */
export class LlmUnavailableError extends Error {
  constructor() {
    super("The AI service (Supabase `generate` function) is not configured or reachable.");
    this.name = "LlmUnavailableError";
  }
}

export interface GenerateStructuredArgs<T> {
  system: string;
  user: string;
  /** Gemini/Vertex responseSchema (OpenAPI subset — see llm/schema.ts). */
  responseSchema: unknown;
  /** Our re-validation of the same contract. (Input type left free so
   *  schemas with `.default()` fields — input ≠ output — still fit.) */
  zodSchema: z.ZodType<T, z.ZodTypeDef, unknown>;
  temperature?: number;
}

/**
 * One structured LLM call. Validation ladder:
 *  1. JSON.parse the response text.
 *  2. zodSchema.safeParse.
 *  3. On failure: ONE retry that shows the model its own output + the error
 *     and asks for corrected JSON only.
 *  4. Second failure → LlmOutputError (callers degrade to their fallback).
 *
 * Throws LlmUnavailableError when the Edge Function isn't deployed / has no
 * credential, so callers can distinguish "unavailable" from a real failure.
 */
export async function generateStructured<T>(args: GenerateStructuredArgs<T>): Promise<T> {
  const firstText = await callModel(args.system, args.user, args.responseSchema, args.temperature);

  const attempt = tryParse(firstText, args.zodSchema);
  if (attempt.ok) return attempt.value;

  // One corrective retry: the model sees its own invalid output + the error.
  const retryUser =
    `${args.user}\n\n---\n` +
    `Your previous response failed validation: ${attempt.error}\n` +
    `Previous response:\n${firstText || "(empty response)"}\n\n` +
    "Return the corrected JSON only, conforming exactly to the schema.";
  const secondText = await callModel(args.system, retryUser, args.responseSchema, args.temperature);

  const retry = tryParse(secondText, args.zodSchema);
  if (retry.ok) return retry.value;

  throw new LlmOutputError(`Model output failed validation twice: ${retry.error}`, secondText);
}

/** One call to the `generate` Edge Function; maps not-configured/not-deployed
 *  transport errors to LlmUnavailableError so callers degrade gracefully. */
async function callModel(
  system: string,
  prompt: string,
  schema: unknown,
  temperature?: number,
): Promise<string> {
  try {
    return await generate({
      system,
      prompt,
      schema,
      model: GEMINI_MODEL,
      temperature: temperature ?? 0.3,
    });
  } catch (err) {
    if (
      err instanceof AiRequestError &&
      (err.status === 404 || err.status === 501 || err.code === "unavailable" || err.code === "unconfigured")
    ) {
      throw new LlmUnavailableError();
    }
    throw err; // genuine failure — callers still fall back; UX shows "failed"
  }
}

function tryParse<T>(
  text: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): { ok: true; value: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "response is not valid JSON" };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, error: issues || "schema mismatch" };
  }
  return { ok: true, value: parsed.data };
}
