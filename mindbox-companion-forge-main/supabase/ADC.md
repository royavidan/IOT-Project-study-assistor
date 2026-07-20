# LLM (`generate` Edge Function) — setup

The app's AI features (Smart study planner, check-in replan, load-review narrative)
call one Supabase Edge Function, **`generate`**, which talks to Google's model for
us. The Google credential lives **only** as a Supabase secret — it never ships to
the app or the browser.

```
app (src/lib/ai/client.ts)                      Supabase Edge Function
  ── POST /functions/v1/generate ─────────────▶  generate/index.ts
      { prompt, system, schema, model }              └─ _shared/vertex.ts
      Authorization: Bearer <anon key>                    ├─ GCP_ADC  → refresh-token → Vertex :generateContent
  ◀── { text } ───────────────────────────────       ├─ GCP_SA_KEY → RS256 JWT   → Vertex :generateContent
                                                       └─ GEMINI_API_KEY → Gemini Developer API
```

Credential **precedence** (first present wins, see `_shared/vertex.ts`):
`GCP_ADC` → `GCP_SA_KEY` → `GEMINI_API_KEY`.

---

## One-time setup

### 0. Supabase CLI (this repo isn't linked yet)

```bash
# from mindbox-companion-forge-main/
bunx supabase login                       # opens a browser; paste the access token
bunx supabase link --project-ref <PROJECT_REF>   # ref is in your Supabase dashboard URL
```

### 1. Produce Application Default Credentials (YOU must do this — interactive Google login)

```bash
# authorized_user ADC → ~/.config/gcloud/application_default_credentials.json
gcloud auth application-default login
gcloud auth application-default set-quota-project <GCP_PROJECT_ID>
# make sure the Vertex AI API is enabled on that project:
gcloud services enable aiplatform.googleapis.com --project <GCP_PROJECT_ID>
```

### 2. Store the credential as Supabase secrets (values never committed)

```bash
bunx supabase secrets set GCP_ADC="$(cat ~/.config/gcloud/application_default_credentials.json)"
bunx supabase secrets set GCP_PROJECT=<GCP_PROJECT_ID>     # optional; else quota_project_id in GCP_ADC
bunx supabase secrets set GCP_LOCATION=us-central1        # optional; defaults to us-central1
```

Alternatives (skip step 1 if you use one of these):
- **Service account:** `bunx supabase secrets set GCP_SA_KEY="$(cat sa-key.json)"`
- **Plain Gemini key:** `bunx supabase secrets set GEMINI_API_KEY=<aistudio key>` (no Vertex, no gcloud)

### 3. Deploy the function

```bash
bunx supabase functions deploy generate
```

`generate` requires a JWT by default — the app already sends the public anon key,
so no config change is needed.

---

## Verify it's live

```bash
bunx supabase secrets list        # should list GCP_ADC (+ GCP_PROJECT / GCP_LOCATION)

# smoke test (uses your project URL + anon key):
curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/generate" \
  -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Return {\"ok\":true} as JSON.","system":"You output only JSON."}'
# → {"text":"{\"ok\":true}"}   (a non-error text proves the token exchange works)
```

In the app, generating a **"Smart (AI)"** plan on `/calendar` end-to-end proves it.

## Notes

- ADC is tied to **your** Google account's refresh token. If you revoke it or
  switch accounts, re-run step 1 and re-set `GCP_ADC`.
- The repo never holds the credential — `supabase/.env.example` documents only the
  secret **names**; real values live in Supabase's secret store.
- No credential set → `generate` returns `501 {code:"unavailable"}`, and the app
  silently falls back to the deterministic planner (feature shows as "unavailable",
  not "failed").
