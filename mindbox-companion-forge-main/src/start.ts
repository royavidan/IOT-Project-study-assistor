import { createMiddleware, createStart } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware({ type: "request" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

// The installed @tanstack/react-start no longer ships createCsrfMiddleware, so
// this hand-rolled request middleware preserves the original guarantee: every
// server-fn call must come from our own origin. Cross-site POSTs (the CSRF
// vector) are rejected before any handler runs. NOTE: the installed runtime
// does NOT pass `serverFnMeta` to request middlewares (verified in
// start-server-core's createStartHandler), so the guard applies to ALL
// non-GET/HEAD requests reaching the Start handler — safe here because SSR
// navigations are GETs and /ingest/* + /jobs/* are routed BEFORE this handler
// in src/server.ts.
const csrfMiddleware = createMiddleware({ type: "request" }).server(async ({ next, request }) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const host = new URL(request.url).host;
    const origin = request.headers.get("origin");
    const secFetchSite = request.headers.get("sec-fetch-site");
    const crossSite =
      origin != null
        ? originHost(origin) !== host
        : secFetchSite != null && secFetchSite !== "same-origin" && secFetchSite !== "none";
    if (crossSite) {
      return new Response(JSON.stringify({ error: "Cross-site request blocked." }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
  }
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, errorMiddleware],
}));
