// Marks this module as server-only. The TanStack Start Vite plugin will fail
// the build if a client bundle ever imports it, keeping the service-role key
// off the browser. (Empty at runtime — it's a build-time guard.)
import "@tanstack/react-start/server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCookies, setCookie, setResponseHeader } from "@tanstack/react-start/server";

import { getServerConfig } from "../config.server";
import type { Database } from "./types";

/**
 * Request-scoped Supabase client bound to the incoming request's cookies. Use
 * this for anything that must respect the logged-in user + Row-Level Security
 * during SSR and server functions. Must be called within a server request
 * context (it reads/writes cookies via TanStack Start).
 */
export function getSupabaseServerClient(): SupabaseClient<Database> {
  const { supabaseUrl, supabaseAnonKey } = getServerConfig();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_ANON_KEY in the server environment.");
  }

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return Object.entries(getCookies()).map(([name, value]) => ({
          name,
          value,
        }));
      },
      setAll(cookiesToSet, responseHeaders) {
        for (const { name, value, options } of cookiesToSet) {
          setCookie(name, value, options as Parameters<typeof setCookie>[2]);
        }
        // Headers Supabase asks us to set (e.g. Cache-Control) so that
        // responses carrying refreshed auth cookies are never cached.
        for (const [name, value] of Object.entries(responseHeaders)) {
          setResponseHeader(name as Parameters<typeof setResponseHeader>[0], value);
        }
      },
    },
  });
}

/**
 * Service-role Supabase client. It BYPASSES Row-Level Security and has full
 * admin access, so it is SERVER-ONLY. Never import this into client code or
 * expose the service-role key to the browser. Intended for privileged writes
 * such as the device ingestion endpoint (Step 3).
 */
export function getSupabaseAdminClient(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error(
      "getSupabaseAdminClient() must never run in the browser — it uses the service-role key.",
    );
  }

  const { supabaseUrl, supabaseServiceRoleKey } = getServerConfig();

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the server environment.");
  }

  return createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
