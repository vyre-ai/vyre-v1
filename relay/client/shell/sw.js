// @ts-check
// The phone's service worker for <name>.vyre.run. It answers every same-origin request except the shell's own /__vyre/ files by asking the box over an end-to-end encrypted relay channel.
// Entry point of the bundle the deploy workflow builds (esbuild, iife) into shell-dist/__vyre/sw.js.
import { connect } from "../client.js";
import { createBridge } from "./bridge.js";
import { pins } from "./pins.js";
import { createLive } from "./live.js";
import { SHIM_SOURCE } from "./wsshim.js";

const sw = /** @type {any} */ (self);

/** @type {{ conn: any, key: string } | null} */
let live = null;
/** @type {{ name: string, label: string, route: string, relay: string } | null} */
let info = null;

async function readInfo() {
  const r = await fetch("/__vyre/info.json", { cache: "no-store" });
  if (!r.ok) throw new Error("no info");
  const j = await r.json();
  return { name: String(j.name), label: String(j.label || j.name), route: String(j.route), relay: String(j.relay) };
}

/** The connection to the box, made once per (route, box key). Null until the phone has a pin from the person's own link. */
async function box() {
  const i = (info = info || await readInfo().catch(() => null));
  if (!i) return null;
  const pin = await pins.get(i.name);
  if (!pin) return null;
  const key = `${i.relay}|${i.route}|${pin}`;
  if (live && live.key !== key) { live.conn.close(); live = null; }
  if (!live) live = { key, conn: connect({ relay: i.relay, route: i.route, box: pin, about: { kind: "web" } }) };
  return live.conn;
}

const pages = createLive({ conn: () => (live ? live.conn : null) });
const bridge = createBridge({ box, label: () => info ? info.label : "This computer" });

sw.addEventListener("install", () => { sw.skipWaiting(); });
sw.addEventListener("activate", (/** @type {any} */ e) => { e.waitUntil(sw.clients.claim()); });
sw.addEventListener("fetch", (/** @type {any} */ e) => {
  const url = new URL(e.request.url);
  if (url.origin !== sw.location.origin || url.pathname.startsWith("/__vyre/")) return;
  // the public path goes straight to the network: the relay sandboxes it, and a page there is never the app's
  if (url.pathname === "/p" || url.pathname.startsWith("/p/")) return;
  // the live-socket shim the pages this worker serves load first (bridge.js withShim)
  if (url.pathname === "/__vyre-ws.js") { e.respondWith(new Response(SHIM_SOURCE, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" } })); return; }
  e.respondWith((async () => (await bridge.handle(e.request)) || fetch(e.request))());
});
// A page's live sockets (relay/client/shell/wsshim.js) ride this worker's channel; a page that goes away closes them.
sw.addEventListener("message", (/** @type {any} */ e) => { if (e.data && e.data.vyreWs && e.source) { pages.message(e.source, e.data); void sw.clients.matchAll().then((/** @type {any[]} */ all) => pages.keep(all.map(c => c.id))); } });
// A changed name or a new link: forget what was read, so the next request asks again.
sw.addEventListener("message", (/** @type {any} */ e) => { if (e.data && e.data.t === "reset") { info = null; if (live) { live.conn.close(); live = null; } } });
