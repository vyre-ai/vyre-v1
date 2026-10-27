// Service worker: keeps the last known shell available offline while allowing a connected browser to receive updates.
// Navigations are network-first; hashed Expo assets are cache-first. Never intercepts the API or live sync connection.
const CACHE = "vyre-shell-v2";
const PLACES = ["home", "chat", "files", "records", "mail", "calendar", "tasks", "sites", "forms", "campaigns", "automations", "agents", "vault", "settings"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await fetch("/", { cache: "reload" });
    if (!shell.ok) throw new Error(`Vyre shell fetch failed: ${shell.status}`);
    const html = await shell.clone().text();
    const urls = new Set(["/", ...PLACES.map((p) => "/" + p)]);
    for (const m of html.matchAll(/(?:src|href)="(\/_expo\/[^"]+|\/[^"]+\.(?:js|css|json|woff2?|png|svg|ico))"/g)) urls.add(m[1]);
    const cache = await caches.open(CACHE);
    await cache.put("/", shell);
    await Promise.all([...urls].filter((u) => u !== "/").map(async (u) => {
      try {
        const res = await fetch(u, { cache: "reload" });
        if (res.ok) await cache.put(u, res);
      } catch { /* a route or optional asset can be fetched on demand later */ }
    }));
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
    if (req.mode === "navigate") {
      try {
        const fresh = await fetch(req);
        if (fresh.ok) await cache.put("/", fresh.clone());
        return fresh;
      } catch {
        const shell = await cache.match(req, { ignoreSearch: true }) ?? await cache.match("/");
        if (shell) return shell;
        return Response.error();
      }
    }
    const hit = await cache.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && (url.pathname.startsWith("/_expo/") || url.pathname.startsWith("/icons/") || url.pathname === "/manifest.json")) await cache.put(req, res.clone());
      return res;
    } catch {
      return Response.error();
    }
  })());
});
// Cache name is bumped when the precache/update contract changes.
