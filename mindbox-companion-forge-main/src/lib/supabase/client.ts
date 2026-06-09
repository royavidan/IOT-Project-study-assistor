import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "./types";

let browserClient: SupabaseClient<Database> | undefined;

/**
 * Supabase client for use in the browser. It uses the public anon key, so every
 * read/write is governed by Row-Level Security. Returns a singleton to avoid
 * spawning multiple GoTrue (auth) instances across re-renders.
 */
export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (browserClient) return browserClient;

  const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
  const anonKey: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them to your .env file (see .env.example).",
    );
  }

  browserClient = createBrowserClient<Database>(url, anonKey);
  return browserClient;
}
