// Supabase Edge Function: `generate`
//
// The single server-side entry point for LLM calls. The app (src/lib/ai/client.ts)
// POSTs { prompt, system, schema, model, temperature } with the public anon key;
// this function unwraps it and calls the Vertex/Gemini helper — which exchanges
// the Supabase-stored Google credential for a short-lived token. Google auth
// never touches the client.
//
// Deploy:  supabase functions deploy generate
// Secrets: see ../ADC.md (GCP_ADC / GCP_PROJECT / GCP_LOCATION, or GEMINI_API_KEY).

import { generateContent, VertexUnconfiguredError } from "../_shared/vertex.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface GeneratePayload {
  prompt?: string;
  system?: string;
  schema?: unknown;
  model?: string;
  temperature?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: GeneratePayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!payload?.prompt || typeof payload.prompt !== "string") {
    return json({ error: "`prompt` (string) is required" }, 400);
  }

  try {
    const text = await generateContent({
      prompt: payload.prompt,
      system: payload.system,
      schema: payload.schema,
      model: payload.model,
      temperature: payload.temperature,
    });
    return json({ text });
  } catch (err) {
    // No credential configured → 501 + code so the app degrades to its
    // deterministic fallback and shows "AI unavailable" (not "failed").
    if (err instanceof VertexUnconfiguredError) {
      return json({ error: err.message, code: "unavailable" }, 501);
    }
    return json({ error: (err as Error)?.message ?? "generation failed" }, 500);
  }
});
