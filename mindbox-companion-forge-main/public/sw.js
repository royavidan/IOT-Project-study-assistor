// MindBox service worker — deliberately conservative.
//
// The live site runs the Vite **dev** server, so we must NEVER cache app code or
// data (stale modules / stale sessions would break it). We precache only the
// static brand assets + an offline page, serve those cache-first, and otherwise
// always go to the network — falling back to the offline page only when a
// navigation truly can't reach the server. This is enough to make the app
// installable (manifest + SW + offline navigation handler) with zero staleness.

const CACHE = "mindbox-static-v1";
const PRECACHE = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // leave Supabase/cross-origin alone

  // Navigations: network-first, offline page as the last resort.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }

  // Everything else: serve only our precached static assets from cache; all
  // other requests pass straight through to the network (never cached → never
  // stale, safe in front of a dev server).
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
