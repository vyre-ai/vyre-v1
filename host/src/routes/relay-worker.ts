// A Space first reached through the relay (<name>.vyre.run, the phone shell registers a worker at /__vyre/sw.js with scope /) and later moved to its own domain on the same name (the installer run
// again, the DNS record pointed at the box) leaves that worker in every browser that opened it through the relay: the worker keeps carrying the page's requests to the relay. The browser asks
// for the worker's script from the network on its own (a worker update check goes round the worker), and this server used to have no answer, so the old worker stayed. Now it answers with a
// worker that retires itself: it takes over, removes its registration and sends the open pages to the address again, which this server then answers directly. No store caching, so the next check asks again.
import type http from "node:http";

export const RELAY_WORKER_PATH = "/__vyre/sw.js";

export const RETIRING_WORKER = `// Vyre: this address is a Space server of its own now, not the relay. This worker removes itself.
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    await self.registration.unregister();
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of open) { try { await c.navigate(c.url); } catch (e) { /* a page that cannot be navigated reloads itself at its next start */ } }
  })());
});
self.addEventListener("fetch", () => { /* no respondWith: every request goes to the network */ });
`;

export function createRelayWorkerRoute(): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  return {
    handle(req, res) {
      const method = (req.method ?? "GET").toUpperCase();
      if ((method !== "GET" && method !== "HEAD") || (req.url ?? "").split("?")[0] !== RELAY_WORKER_PATH) return false;
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        "service-worker-allowed": "/",
        "x-content-type-options": "nosniff",
      });
      res.end(method === "HEAD" ? undefined : RETIRING_WORKER);
      return true;
    },
  };
}
