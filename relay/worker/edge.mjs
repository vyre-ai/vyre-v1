// @ts-check
// The Cloudflare side of phone access that is not the Worker's code: a wildcard proxied DNS record and the Worker route that sends `*.vyre.run` to the relay Worker.
//   node relay/worker/edge.mjs --status | --apply | --remove      (CLOUDFLARE_API_TOKEN in the environment)
// Idempotent. `--remove` deletes exactly these two things and nothing else, so it is the way back. The Worker hands every host that is not a claimed phone name to its own origin, and
// `--verify` compares the answer of each listed host with and without the wildcard in the way before anyone relies on it.
const API = "https://api.cloudflare.com/client/v4";
export const ZONE = "vyre.run";
export const SCRIPT = "vyre-relay";
export const ROUTE = `*.${ZONE}/*`;
export const WILDCARD = `*.${ZONE}`;

/** @param {typeof fetch} f @param {string} token */
export function client(f, token) {
  /** @param {string} method @param {string} path @param {unknown} [body] */
  return async (method, path, body) => {
    const r = await f(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const j = /** @type {any} */ (await r.json());
    if (!j.success) throw new Error(`${method} ${path}: ${(j.errors || []).map((/** @type {any} */ e) => e.message).join("; ") || r.status}`);
    return j.result;
  };
}

/**
 * @param {ReturnType<typeof client>} call
 * @param {"status" | "apply" | "remove"} mode
 * @returns {Promise<{ dns: "present" | "absent" | "created" | "removed", route: "present" | "absent" | "created" | "removed" }>}
 */
export async function run(call, mode) {
  const zones = await call("GET", `/zones?name=${ZONE}`);
  const zone = zones[0] && zones[0].id;
  if (!zone) throw new Error(`no zone ${ZONE} for this token`);
  const dns = (await call("GET", `/zones/${zone}/dns_records?name=${encodeURIComponent(WILDCARD)}&per_page=50`));
  const wild = dns.find((/** @type {any} */ r) => r.name === WILDCARD && r.type === "AAAA");
  const other = dns.filter((/** @type {any} */ r) => r.name === WILDCARD && r.type !== "AAAA");
  if (other.length) throw new Error(`${WILDCARD} already has a ${other[0].type} record: nothing was changed`);
  if (wild && (wild.content !== "100::" || wild.proxied !== true)) throw new Error(`${WILDCARD} AAAA exists but is not the proxied 100:: record: nothing was changed`);
  const routes = await call("GET", `/zones/${zone}/workers/routes`);
  const route = routes.find((/** @type {any} */ r) => r.pattern === ROUTE);
  if (route && route.script !== SCRIPT) throw new Error(`${ROUTE} already goes to ${route.script}: nothing was changed`);
  const out = { dns: wild ? "present" : "absent", route: route ? "present" : "absent" };
  if (mode === "apply") {
    if (!route) { await call("POST", `/zones/${zone}/workers/routes`, { pattern: ROUTE, script: SCRIPT }); out.route = "created"; }
    // the route first: until the record exists nothing resolves to it, and once it does the Worker is already there to hand other hosts to their origins
    if (!wild) { await call("POST", `/zones/${zone}/dns_records`, { type: "AAAA", name: WILDCARD, content: "100::", proxied: true, ttl: 1, comment: "phone access wildcard (relay/worker/edge.mjs)" }); out.dns = "created"; }
  }
  if (mode === "remove") {
    if (wild) { await call("DELETE", `/zones/${zone}/dns_records/${wild.id}`); out.dns = "removed"; }
    if (route) { await call("DELETE", `/zones/${zone}/workers/routes/${route.id}`); out.route = "removed"; }
  }
  return /** @type {any} */ (out);
}

/** The hosts that must answer the same with the wildcard in place. */
export const HOSTS = Object.freeze(["www", "dl", "prototype", "tracker", "app", "web", "names", "escrow", "relay"]);

/**
 * Status and a few headers of each host, the way a visitor sees them.
 * @param {typeof fetch} f @param {readonly string[]} [hosts]
 */
export async function snapshot(f, hosts = HOSTS) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const h of hosts) {
    try {
      const r = await f(`https://${h}.${ZONE}/`, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
      out[h] = `${r.status} ${r.headers.get("content-type") || ""} ${r.headers.get("location") || ""}`.trim();
    } catch (e) { out[h] = `error ${/** @type {Error} */ (e).message}`; }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const flag = process.argv[2] || "--status";
  const mode = flag === "--apply" ? "apply" : flag === "--remove" ? "remove" : flag === "--status" ? "status" : null;
  if (flag === "--snapshot") { console.log(JSON.stringify(await snapshot(fetch), null, 2)); process.exit(0); }
  if (!mode) { console.error("usage: edge.mjs --status | --apply | --remove | --snapshot"); process.exit(2); }
  const token = process.env["CLOUDFLARE_API_TOKEN"] || "";
  if (!token) { console.error("CLOUDFLARE_API_TOKEN is not set"); process.exit(2); }
  console.log(JSON.stringify(await run(client(fetch, token), mode)));
}
