// Service worker: precaches the web bundle so a warm start needs no network (ARCH 7, speed b12).
// Cache-first for same-origin GET of built assets; navigations fall back to the cached shell. Never intercepts the sync connection.
const CACHE = "vyre-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const res = await fetch("/", { cache: "reload" });
    const html = await res.clone().text();
    const urls = new Set(["/"]);
    for (const m of html.matchAll(/(?:src|href)="(\/_expo\/[^"]+|\/[^"]+\.(?:js|css|woff2?|png|svg|ico))"/g)) urls.add(m[1]);
    const cache = await caches.open(CACHE);
    await cache.put("/", res);
    await Promise.all([...urls].filter((u) => u !== "/").map((u) => cache.add(u).catch(() => undefined)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/sync")) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: false }) ?? (req.mode === "navigate" ? await cache.match("/") : undefined);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && url.pathname.startsWith("/_expo/")) cache.put(req, res.clone());
    return res;
  })());
});
