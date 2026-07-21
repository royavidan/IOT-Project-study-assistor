// Vertex AI / Gemini access for the `generate` Edge Function.
//
// The Google credential NEVER leaves the server: it lives only as a Supabase
// secret and is exchanged here for a short-lived access token. Callers (the
// app, via src/lib/ai/client.ts) only ever see { text }.
//
// Credential precedence (first present wins):
//   1. GCP_ADC       — authorized_user ADC JSON (client_id/secret + refresh_token).
//                      Produced by `gcloud auth application-default login`.
//   2. GCP_SA_KEY    — a service-account JSON (RS256 JWT → access token).
//   3. GEMINI_API_KEY— Google AI Studio key (Gemini Developer API, no Vertex).
//
// Optional: GCP_PROJECT (falls back to the credential's project), GCP_LOCATION
// (defaults to us-central1).

// deno-lint-ignore-file no-explicit-any

interface AdcCredential {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  quota_project_id?: string;
  type?: string;
}

interface SaCredential {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

export interface GenerateArgs {
  prompt: string;
  system?: string;
  /** OpenAPI-subset responseSchema for structured JSON output (optional). */
  schema?: unknown;
  model?: string;
  temperature?: number;
}

/** No credential secret is configured — the feature is unavailable, not broken. */
export class VertexUnconfiguredError extends Error {
  constructor() {
    super("No GCP/Gemini credential configured (set GCP_ADC, GCP_SA_KEY, or GEMINI_API_KEY).");
    this.name = "VertexUnconfiguredError";
  }
}

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_LOCATION = "us-central1";
const TOKEN_URI = "https://oauth2.googleapis.com/token";

// In-memory access-token cache (per warm function instance). Refreshed 60s
// before expiry so a request never rides an about-to-expire token.
let cachedToken: { token: string; expMs: number } | null = null;
const nowMs = () => Date.now();

function tokenStillFresh(): string | null {
  if (cachedToken && cachedToken.expMs - 60_000 > nowMs()) return cachedToken.token;
  return null;
}

// ---- 1. ADC (authorized_user) refresh-token grant --------------------------
async function getAdcAccessToken(adc: AdcCredential): Promise<string> {
  const fresh = tokenStillFresh();
  if (fresh) return fresh;

  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: adc.client_id,
      client_secret: adc.client_secret,
      refresh_token: adc.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`ADC token exchange failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  cachedToken = { token: data.access_token, expMs: nowMs() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

// ---- 2. Service account: sign an RS256 JWT, exchange for an access token ----
function pemToPkcs8(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getSaAccessToken(sa: SaCredential): Promise<string> {
  const fresh = tokenStillFresh();
  if (fresh) return fresh;

  const iat = Math.floor(nowMs() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: sa.token_uri ?? TOKEN_URI,
    iat,
    exp: iat + 3600,
  };
  const enc = (o: unknown) => base64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc(claim)}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)),
  );
  const jwt = `${unsigned}.${base64url(sig)}`;

  const res = await fetch(sa.token_uri ?? TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`SA token exchange failed: HTTP ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  cachedToken = { token: data.access_token, expMs: nowMs() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

// ---- request body + response parsing (shared by Vertex and Gemini API) -----
function buildBody(args: GenerateArgs): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    temperature: args.temperature ?? 0.3,
  };
  if (args.schema) generationConfig.responseSchema = args.schema;

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: args.prompt }] }],
    generationConfig,
  };
  if (args.system) body.systemInstruction = { parts: [{ text: args.system }] };
  return body;
}

function extractText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.map((p: any) => p?.text ?? "").join("");
  return "";
}

/**
 * One structured-output call. Picks the auth path by precedence, exchanges the
 * secret for a bearer token (ADC/SA) or uses the API key, POSTs to the model's
 * :generateContent endpoint, and returns the raw response text.
 */
export async function generateContent(args: GenerateArgs): Promise<string> {
  const model = args.model ?? DEFAULT_MODEL;
  const location = Deno.env.get("GCP_LOCATION") ?? DEFAULT_LOCATION;

  const adcRaw = Deno.env.get("GCP_ADC");
  const saRaw = Deno.env.get("GCP_SA_KEY");
  const apiKey = Deno.env.get("GEMINI_API_KEY");

  let url: string;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (adcRaw) {
    const adc = JSON.parse(adcRaw) as AdcCredential;
    const project = Deno.env.get("GCP_PROJECT") || adc.quota_project_id;
    if (!project) throw new Error("GCP_PROJECT not set and GCP_ADC has no quota_project_id.");
    const token = await getAdcAccessToken(adc);
    url =
      `https://${location}-aiplatform.googleapis.com/v1/projects/${project}` +
      `/locations/${location}/publishers/google/models/${model}:generateContent`;
    headers.Authorization = `Bearer ${token}`;
  } else if (saRaw) {
    const sa = JSON.parse(saRaw) as SaCredential;
    const project = Deno.env.get("GCP_PROJECT") || sa.project_id;
    if (!project) throw new Error("GCP_PROJECT not set and GCP_SA_KEY has no project_id.");
    const token = await getSaAccessToken(sa);
    url =
      `https://${location}-aiplatform.googleapis.com/v1/projects/${project}` +
      `/locations/${location}/publishers/google/models/${model}:generateContent`;
    headers.Authorization = `Bearer ${token}`;
  } else if (apiKey) {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  } else {
    throw new VertexUnconfiguredError();
  }

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(buildBody(args)) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`generateContent upstream error: HTTP ${res.status} ${text.slice(0, 500)}`);
  }
  return extractText(await res.json());
}
