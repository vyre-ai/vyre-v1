// @ts-check
// Phone access (DESIGN-computers, "Phone access through vyre.run"): a person claims <name>.vyre.run once; their box keeps its outbound link to this relay; the relay answers
// https://<name>.vyre.run with a small static shell (relay/client/shell) that the phone's browser runs. The shell dials /v1/device itself and speaks Noise IK to the box key
// the person's own link carried in its fragment, so this Worker routes bytes and never opens a frame. It holds a name, a route id and a nickname, nothing else.
//
// Pieces here:
//   HostSlot      one Durable Object per name (`hn:<name>`): the route that holds it, the box's nickname, and a tombstone once released (only the same route can take it back).
//   hostControl   what a box's control socket may say about its name: host.claim, host.release, host.status. Called from RouteRelay.onTicket.
//   onHost        the gateway: the shell for a claimed name, "is asleep" when its box is offline, the old redirect for a name nobody claimed here.
//   onPublic      `/p/*` of a claimed name, the one thing that is not the shell: visitors with no session reach the Space's forms and sites through the box's control socket, in an opaque origin.
// No dependencies; WebCrypto and the runtime only.

export const PHONE = Object.freeze({
  /** a name: letters, digits and single dashes, starting with a letter (the same shape names.vyre.run holds) */
  nameRe: /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/,
  /** characters of the nickname shown on the asleep page */
  labelMax: 40,
  /** claims one route may make in a day (a typo and a retry, not a name hunt) */
  claimsPerDay: 10,
  /** the answer to a claim is cached nowhere; the names directory is asked once per new name */
  zone: "vyre.run",
});

/**
 * The public path of a claimed name: `/p/*` reaches the Space's own route over the box's control socket, for a visitor with no session (a form, a site). It shares an origin with the phone app, so nothing
 * that identifies a person crosses, and the page gets an opaque origin: requests keep only the headers in REQUEST_KEEP (no Cookie, no Authorization), responses keep only those in RESPONSE_KEEP (no
 * Set-Cookie, nothing the browser applies to the whole origin), and every answer carries the sandbox policy below, without allow-same-origin.
 */
export const PUBLIC = Object.freeze({
  /** a request body, whole */
  maxBody: 8 << 20,
  /** a response body, whole */
  maxResponse: 32 << 20,
  /** bytes of body in one control-socket message; base64 of this stays under the relay's frame limit */
  chunk: 384 << 10,
  perMinute: 600,
  ipPerMinute: 120,
  concurrent: 32,
  timeoutMs: 30_000,
  sandbox: "sandbox allow-scripts allow-forms allow-popups allow-downloads",
});
const REQUEST_KEEP = new Set(["accept", "accept-language", "content-type", "if-modified-since", "if-none-match", "range", "user-agent", "x-file-name"]);
const RESPONSE_KEEP = new Set(["accept-ranges", "cache-control", "content-disposition", "content-encoding", "content-language", "content-length", "content-range", "content-security-policy", "content-type", "etag", "expires", "last-modified", "retry-after", "vary"]);

/** Hosts that are infrastructure, never a person's phone address. The names directory refuses most of these too; this is the gateway's own fence. */
/** The labels the deploy fenced from the zone's own records (edge.mjs writes them to the FENCE_HOSTS secret): every host that exists, whatever the static list says. @param {any} env */
export function fenceOf(env) {
  const raw = typeof env.FENCE_HOSTS === "string" ? env.FENCE_HOSTS : "";
  return new Set(raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
}

export const INFRA = Object.freeze(new Set([
  "names", "app", "api", "www", "relay", "acme", "mail", "docs", "status", "web", "reports", "escrow", "edge", "vyre", "phone", "setup",
  // the hosts that exist in the zone today and are not Workers; a claim also checks live DNS (dnsTaken), so a host added later is fenced too
  "dl", "prototype", "tracker", "tess", "updates", "freemanwine", "vyreqa-lab7",
]));

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

/** A nickname safe to show: no control characters, no bidi marks, trimmed. @param {unknown} s */
export function cleanLabel(s) {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, PHONE.labelMax);
}

/** @param {string} s */
const esc = s => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);

/**
 * What the Worker does with this request's host:
 *  - `{ name }`: a phone address, `<name>.vyre.run`, one label of a usable shape that is not infrastructure;
 *  - `{ pass: true }`: any other host under the zone that reached the wildcard route (a download bucket, a site, a tunnel) and belongs to its own origin;
 *  - null: the relay itself, or a host outside the zone.
 * A staging Worker names one host and one name (STAGE_HOST, STAGE_NAME) so the whole path runs without a wildcard record.
 * @param {URL} url @param {any} env @returns {{ name: string } | { pass: true } | null}
 */
export function gatewayOf(url, env) {
  const host = url.hostname.toLowerCase();
  if (env.STAGE_HOST && env.STAGE_NAME) {
    // the staging host is also the relay's own address: its sockets and health check are the relay's, everything else is the one name's
    if (url.pathname === "/health" || url.pathname.startsWith("/v1/")) return null;
    return host === String(env.STAGE_HOST).toLowerCase() && PHONE.nameRe.test(String(env.STAGE_NAME)) ? { name: String(env.STAGE_NAME) } : null;
  }
  const zone = String(env.HOST_ZONE || PHONE.zone).toLowerCase();
  if (!host.endsWith(`.${zone}`) || host === String(env.RELAY_HOST || `relay.${zone}`).toLowerCase()) return null;
  const label = host.slice(0, -(zone.length + 1));
  return PHONE.nameRe.test(label) && !INFRA.has(label) && !fenceOf(env).has(label) ? { name: label } : { pass: true };
}

/** @param {any} env @param {string} name */
const slotOf = (env, name) => env.HOSTS.get(env.HOSTS.idFromName(`hn:${name}`));

/**
 * One name. Keys: `h` = { route, label, at, released? }. Requests run one at a time, so a check and a write cannot interleave.
 * A released name is a tombstone: the route that held it can take it again, nobody else, ever.
 */
export class HostSlot {
  /** @param {any} ctx @param {any} env */
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);
    const cur = (await this.ctx.storage.get("h")) || null;
    if (request.method === "GET" && url.pathname === "/info") {
      return json(200, cur ? { route: cur.route, label: cur.label, released: Boolean(cur.released) } : {});
    }
    let body;
    try { body = await request.json(); } catch { return json(400, { error: "bad request" }); }
    const route = String(body && body.route || "");
    if (request.method === "PUT" && url.pathname === "/claim") {
      if (cur && cur.route !== route) return json(200, { status: "taken" });
      await this.ctx.storage.put("h", { route, label: cleanLabel(body.label), at: cur ? cur.at : Date.now() });
      return json(200, { status: "claimed" });
    }
    if (request.method === "POST" && url.pathname === "/release") {
      if (!cur || cur.route !== route) return json(200, { status: "none" });
      await this.ctx.storage.put("h", { ...cur, released: Date.now() });
      return json(200, { status: "released" });
    }
    return json(404, { error: "not found" });
  }
}

/** Is the name free at the names directory? Fails closed: a directory that does not answer is "unavailable". @param {any} env @param {string} name */
async function nameStatus(env, name) {
  const f = typeof env.NAMES_FETCH === "function" ? env.NAMES_FETCH : globalThis.fetch.bind(globalThis);
  try {
    const r = await f(`${String(env.NAMES_ORIGIN || "https://names.vyre.run").replace(/\/+$/, "")}/v1/names/check?name=${encodeURIComponent(name)}`, { headers: { accept: "application/json" } });
    const j = /** @type {any} */ (await r.json());
    const s = r.ok && j && j.data && typeof j.data.status === "string" ? j.data.status : "";
    return ["ok", "taken", "reserved", "invalid"].includes(s) ? s : "unavailable";
  } catch { return "unavailable"; }
}

/**
 * Does <name>.vyre.run already have a record of its own that is not the phone wildcard? A proxied wildcard makes Cloudflare answer an A query for every name (with the zone's proxy addresses, the same
 * ones any proxied host gets), so "has an answer" says nothing. What does differ is a host that is not proxied (a server with its own address): its answer is not what a name nobody holds gets, which a
 * random label asked at the same moment shows. A proxied host that exists is fenced by INFRA instead; a host added to the zone later has to be added there.
 * Fails closed: no answer is "unavailable".
 * @param {any} env @param {string} name
 */
async function dnsTaken(env, name) {
  const f = typeof env.DOH_FETCH === "function" ? env.DOH_FETCH : globalThis.fetch.bind(globalThis);
  const zone = String(env.HOST_ZONE || PHONE.zone);
  const control = `zz-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  /** @param {string} label */
  const answers = async label => {
    const r = await f(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(`${label}.${zone}`)}&type=A`, { headers: { accept: "application/dns-json" } });
    const j = /** @type {any} */ (await r.json());
    if (!r.ok || !j || typeof j.Status !== "number") throw new Error("no answer");
    return (j.Status === 0 && Array.isArray(j.Answer) ? j.Answer : []).map((/** @type {any} */ a) => `${a.type}:${a.data}`).sort().join(",");
  };
  try {
    const [mine, none] = await Promise.all([answers(name), answers(control)]);
    return mine === none ? "ok" : "taken";
  } catch { return "unavailable"; }
}

const day = () => Math.floor(Date.now() / 86_400_000);

/**
 * What a box says over its authenticated control socket about its phone address. `relay` is the RouteRelay object (its own storage keeps the one name this route holds).
 * The box hears back `{ t: "host", op, status, name?, label? }`.
 * @param {any} relay @param {any} ws @param {any} m
 */
export async function hostControl(relay, ws, m) {
  const { env } = relay;
  const route = String(relay.role(ws).route || "");
  const reply = (op, status, extra = {}) => relay.json(ws, { t: "host", op, status, ...extra });
  const op = String(m.t).slice("host.".length);
  if (!env.HOSTS) return reply(op, "unavailable");
  const mine = (await relay.ctx.storage.get("host")) || null;
  if (op === "status") {
    if (!mine) return reply(op, "none");
    const info = await (await slotOf(env, mine.name).fetch("https://host/info")).json();
    return reply(op, info.route === route && !info.released ? "claimed" : "none", { name: mine.name, label: info.label || mine.label || "" });
  }
  if (op === "release") {
    if (!mine) return reply(op, "none");
    const out = /** @type {any} */ (await (await slotOf(env, mine.name).fetch("https://host/release", { method: "POST", body: JSON.stringify({ route }) })).json());
    await relay.ctx.storage.delete("host");
    return reply(op, out.status, { name: mine.name });
  }
  if (op !== "claim") return;
  const name = String(m.name || "").toLowerCase();
  if (!PHONE.nameRe.test(name) || INFRA.has(name)) return reply(op, "invalid", { name });
  if (fenceOf(env).has(name)) return reply(op, "reserved", { name });
  if (mine && mine.name !== name) return reply(op, "has_name", { name: mine.name });
  const label = cleanLabel(m.label);
  const key = `hostClaims:${day()}`;
  const used = Number(await relay.ctx.storage.get(key)) || 0;
  if (used >= PHONE.claimsPerDay) return reply(op, "limited", { name });
  await relay.ctx.storage.put(key, used + 1);
  const slot = slotOf(env, name);
  const info = /** @type {any} */ (await (await slot.fetch("https://host/info")).json());
  if (info.route && info.route !== route) return reply(op, "taken", { name });
  if (!info.route) {
    const s = await nameStatus(env, name);
    if (s !== "ok") return reply(op, s, { name });
    const d = await dnsTaken(env, name);
    if (d !== "ok") return reply(op, d, { name });
  }
  const out = /** @type {any} */ (await (await slot.fetch("https://host/claim", { method: "PUT", body: JSON.stringify({ route, label }) })).json());
  if (out.status !== "claimed") return reply(op, out.status, { name });
  await relay.ctx.storage.put("host", { name, label });
  return reply(op, "claimed", { name, label });
}

const SHELL_HEADERS = (relayWss) => ({
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": `default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${relayWss}; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
});

const PAGE_STYLE = "html{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:Canvas;color:CanvasText}main{max-width:26rem;padding:2rem 1.25rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:.25rem 0;opacity:.75}";

/** @param {string} label @param {string} name */
function asleepPage(label, name) {
  const who = esc(label || name);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="20"><title>${who} is asleep</title><style>${PAGE_STYLE}</style><body><main><h1>${who} is asleep</h1><p>Wake the computer and this page opens by itself.</p></main></body></html>`;
}

/** @param {string} label @param {string} name */
function shellPage(label, name) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(label || name)}</title><style>${PAGE_STYLE}</style><body><main id="m"><h1>${esc(label || name)}</h1><p id="s">Opening</p></main><script src="/__vyre/boot.js"></script></body></html>`;
}

/** The request as the box may see it: what the visitor asked and the few headers a page needs. @param {Request} request @param {URL} url */
export function publicHead(request, url) {
  /** @type {Record<string, string>} */
  const headers = {};
  for (const [k, v] of request.headers) if (REQUEST_KEEP.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
  return { method: request.method, path: `${url.pathname}${url.search}`, ip: request.headers.get("cf-connecting-ip") || "", headers };
}

/** The headers a `/p/` answer leaves the relay with, whatever the box said. A redirect stays under `/p/` or leaves the host; it never lands on the app. @param {Headers} from @param {URL} url */
export function publicHeaders(from, url) {
  const h = new Headers();
  for (const [k, v] of from) if (RESPONSE_KEEP.has(k.toLowerCase())) h.append(k, v);
  const location = from.get("location");
  if (location) {
    let to = null;
    try { to = new URL(location, url); } catch { /* not an address */ }
    if (to && (to.origin !== url.origin || to.pathname.startsWith("/p/"))) h.set("location", to.href);
  }
  // a second policy only narrows: whatever the page sent, this one still applies
  h.append("content-security-policy", PUBLIC.sandbox);
  h.set("access-control-allow-origin", "*");
  h.set("x-content-type-options", "nosniff");
  h.set("x-robots-tag", "noindex");
  h.set("referrer-policy", "no-referrer");
  return h;
}

/** A page the relay itself answers on `/p/`, under the same policy as any other. @param {number} status @param {string} title @param {string} text @param {URL} url @param {Record<string, string>} [extra] */
function publicPage(status, title, text, url, extra = {}) {
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PAGE_STYLE}</style><body><main><h1>${esc(title)}</h1><p>${esc(text)}</p></main></body></html>`;
  return new Response(body, { status, headers: publicHeaders(new Headers({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...extra }), url) });
}

/** Names or `name/site` pairs the operator took down (the P_BLOCKED secret, comma separated): the kill switch. @param {any} env @param {string} name @param {string} site */
export function publicBlocked(env, name, site) {
  const raw = typeof env.P_BLOCKED === "string" ? env.P_BLOCKED : "";
  const list = raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(name) || (site !== "" && list.includes(`${name}/${site.toLowerCase()}`));
}

/**
 * `<name>.vyre.run/p/*`: GET, HEAD and POST go to the Space over its control socket, OPTIONS is answered here. The hostname and status are logged; no path below the site, no query, no body.
 * @param {Request} request @param {any} env @param {string} name @param {{ route: string, label?: string }} info @param {() => Promise<boolean>} online
 */
async function onPublic(request, env, name, info, online) {
  const url = new URL(request.url);
  const site = url.pathname.split("/")[2] || "";
  const done = (/** @type {Response} */ res) => { console.log(JSON.stringify({ p: url.hostname, site, status: res.status })); return res; };
  if (publicBlocked(env, name, site)) return done(publicPage(451, "This page is not available", "It was taken down.", url));
  if (request.method === "OPTIONS") {
    const h = publicHeaders(new Headers({ "cache-control": "no-store" }), url);
    h.set("access-control-allow-methods", "GET, HEAD, POST, OPTIONS");
    h.set("access-control-allow-headers", "content-type, x-file-name");
    h.set("access-control-max-age", "600");
    return new Response(null, { status: 204, headers: h });
  }
  if (!["GET", "HEAD", "POST"].includes(request.method)) return done(new Response(null, { status: 405, headers: publicHeaders(new Headers({ allow: "GET, HEAD, POST, OPTIONS" }), url) }));
  if (Number(request.headers.get("content-length") || 0) > PUBLIC.maxBody) return done(new Response(null, { status: 413, headers: publicHeaders(new Headers(), url) }));
  const body = request.method === "POST" ? new Uint8Array(await request.arrayBuffer()) : new Uint8Array(0);
  if (body.length > PUBLIC.maxBody) return done(new Response(null, { status: 413, headers: publicHeaders(new Headers(), url) }));
  const asleep = () => publicPage(503, `${info.label || name} is offline`, "This page lives on a computer that is off or not connected. Try again soon.", url, { "retry-after": "20" });
  if (!(await online())) return done(asleep());
  let res;
  try {
    res = await env.ROUTES.get(env.ROUTES.idFromName(info.route)).fetch("https://route/p", { method: "POST", headers: { "x-vyre-p": JSON.stringify(publicHead(request, url)) }, body });
  } catch { return done(asleep()); }
  if (res.status === 599) return done(asleep());
  return done(new Response(request.method === "HEAD" ? null : res.body, { status: res.status, headers: publicHeaders(res.headers, url) }));
}

/** Names seen unclaimed a moment ago, per isolate, so the hosts under the wildcard that are not phone names cost one lookup a minute, not one per request. */
const NEGATIVE_MS = 10_000;
const negative = new Map();
/** @param {string} host @param {boolean} [set] */
function unclaimed(host, set = false) {
  const now = Date.now();
  if (set) { if (negative.size > 512) negative.clear(); negative.set(host, now + NEGATIVE_MS); return true; }
  const until = negative.get(host);
  return until !== undefined && until > now;
}
/** Forget a cached "unclaimed" (a claim just made; tests). @param {string} [host] */
export function forgetUnclaimed(host) { host === undefined ? negative.clear() : negative.delete(host); }

/** The request to the origin of its own host. A staging Worker has no origin behind its host, and an origin that answers with a Cloudflare error is a name nobody holds. @param {Request} request @param {any} env */
export async function passthrough(request, env) {
  if (env.STAGE_HOST) return new Response(null, { status: 404 });
  try {
    const res = await (typeof env.ORIGIN_FETCH === "function" ? env.ORIGIN_FETCH : globalThis.fetch.bind(globalThis))(request);
    return res.status >= 520 ? new Response(null, { status: 404 }) : res;
  } catch { return new Response(null, { status: 404 }); }
}

/**
 * The gateway for `<name>.vyre.run`.
 *  - a name nobody claimed here: the request goes on to the host's own origin, untouched (see passthrough);
 *  - `/__vyre/info.json`: { name, label, route, relay, online } for the shell;
 *  - `/__vyre/*`: the shell's static files (env.ASSETS), the service worker allowed to scope the whole origin;
 *  - any other GET: the shell page, or "<nickname> is asleep" (503) when the box is offline. After the first visit the service worker answers navigations itself.
 * @param {Request} request @param {any} env @param {string} name
 */
export async function onHost(request, env, name) {
  const url = new URL(request.url);
  // Not ours unless a route holds this name: anything else under the wildcard (a download bucket, a site, a tunnel) goes to its own origin untouched, and an error anywhere here does the same.
  let info = /** @type {any} */ ({});
  try {
    if (env.HOSTS && !unclaimed(url.hostname)) {
      info = await (await slotOf(env, name).fetch("https://host/info")).json();
      if (!info.route || info.released) unclaimed(url.hostname, true);
    }
  } catch { return passthrough(request, env); }
  if (!info.route || info.released) return passthrough(request, env);
  const relayWss = String(env.RELAY_PUBLIC_URL || "wss://relay.vyre.run");
  const online = async () => {
    try { return Boolean(((await (await env.ROUTES.get(env.ROUTES.idFromName(info.route)).fetch("https://route/online")).json())).online); } catch { return false; }
  };
  if (url.pathname === "/p" || url.pathname.startsWith("/p/")) return onPublic(request, env, name, info, online);
  if (url.pathname === "/__vyre/info.json") return json(200, { name, label: info.label || "", route: info.route, relay: relayWss, online: await online() });
  if (url.pathname.startsWith("/__vyre/")) {
    if (!env.ASSETS || (request.method !== "GET" && request.method !== "HEAD")) return new Response(null, { status: 404, headers: { "x-vyre-gateway": "no-assets" } });
    const res = await env.ASSETS.fetch(new Request(new URL(url.pathname, "https://assets.invalid"), { method: request.method }));
    if (res.status !== 200) return new Response(null, { status: 404, headers: { "x-vyre-gateway": `asset-${res.status}` } });
    const headers = new Headers(res.headers);
    headers.set("cache-control", "no-cache");
    headers.set("x-content-type-options", "nosniff");
    if (url.pathname === "/__vyre/sw.js") { headers.set("service-worker-allowed", "/"); headers.set("content-type", "text/javascript; charset=utf-8"); }
    return new Response(res.body, { status: 200, headers });
  }
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  const headers = SHELL_HEADERS(relayWss);
  if (!(await online())) return new Response(request.method === "HEAD" ? null : asleepPage(info.label, name), { status: 503, headers: { ...headers, "retry-after": "20" } });
  return new Response(request.method === "HEAD" ? null : shellPage(info.label, name), { status: 200, headers });
}
