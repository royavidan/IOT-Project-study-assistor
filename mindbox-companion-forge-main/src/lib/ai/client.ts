// Thin client for the `generate` Supabase Edge Function.
//
// Isomorphic (works from the SSR server and, if ever needed, the browser): it
// only uses the PUBLIC Supabase URL + anon key, never the Google credential —
// that lives as a Supabase secret and is only ever seen by the Edge Function
// (supabase/functions/generate). See supabase/ADC.md.

export interface GenerateArgs {
  prompt: string;
  system?: string;
  /** OpenAPI-subset responseSchema for structured JSON output (optional). */
  schema?: unknown;
  model?: string;
  temperature?: number;
}

/** Transport/HTTP failure calling the Edge Function (carries the status/code). */
export class AiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "AiRequestError";
    this.status = status;
    this.code = code;
  }
}

function resolveSupabase(): { url: string; anonKey: string } {
  // Prefer Vite public env (inlined at build, present in dev on both sides);
  // fall back to process.env for the Node/SSR runtime.
  const meta = ((import.meta as unknown as { env?: Record<string, string> }).env ?? {}) as Record<
    string,
    string | undefined
  >;
  const proc = ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env ?? {}) as Record<string, string | undefined>;

  const url = meta.VITE_SUPABASE_URL ?? proc.SUPABASE_URL ?? proc.VITE_SUPABASE_URL;
  const anonKey =
    meta.VITE_SUPABASE_ANON_KEY ?? proc.SUPABASE_ANON_KEY ?? proc.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new AiRequestError("Supabase URL / anon key not configured.", 0, "unconfigured");
  }
  return { url, anonKey };
}

/**
 * Call the `generate` Edge Function and return the model's raw response text.
 * Throws {@link AiRequestError} on transport/HTTP failure (status + code) so
 * callers can distinguish "unavailable" (not deployed / no credential) from a
 * genuine failure.
 */
export async function generate(args: GenerateArgs): Promise<string> {
  const { url, anonKey } = resolveSupabase();
  const endpoint = `${url.replace(/\/+$/, "")}/functions/v1/generate`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({
        prompt: args.prompt,
        system: args.system,
        schema: args.schema,
        model: args.model,
        temperature: args.temperature,
      }),
    });
  } catch (err) {
    throw new AiRequestError(`generate: network error: ${(err as Error).message}`, 0, "network");
  }

  if (!res.ok) {
    let code: string | undefined;
    let message = `generate: HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body?.code) code = body.code;
      if (body?.error) message = `generate: ${body.error}`;
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new AiRequestError(message, res.status, code);
  }

  const data = (await res.json().catch(() => ({}))) as { text?: string };
  return typeof data.text === "string" ? data.text : "";
}
