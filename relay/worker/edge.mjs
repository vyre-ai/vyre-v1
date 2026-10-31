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
/** The Worker secret that carries the fenced labels: every host the zone already has a record for, which a phone name must never take (relay/worker/phone.js, fenceOf). */
export const FENCE_SECRET = "FENCE_HOSTS";

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
 * The single labels the zone already has a record for (A, AAAA or CNAME), except the phone wildcard. A new proxied host is fenced by running this again, with no code change.
 * @param {ReturnType<typeof client>} call @param {string} zone
 */
export async function fencedLabels(call, zone) {
  /** @type {Set<string>} */
  const labels = new Set();
  for (let page = 1; page <= 50; page++) {
    const rows = await call("GET", `/zones/${zone}/dns_records?per_page=500&page=${page}`);
    for (const r of rows) {
      if (!["A", "AAAA", "CNAME"].includes(r.type) || r.name === WILDCARD) continue;
      const m = new RegExp(`^([a-z0-9-]+)\\.${ZONE.replace(/\./g, "\\.")}$`).exec(String(r.name).toLowerCase());
      if (m && m[1]) labels.add(m[1]);
    }
    if (rows.length < 500) break;
  }
  return [...labels].sort();
}

/**
 * @param {ReturnType<typeof client>} call
 * @param {"status" | "apply" | "remove"} mode
 * @returns {Promise<{ dns: "present" | "absent" | "created" | "removed", route: "present" | "absent" | "created" | "removed", fenced?: number }>}
 */
export async function run(call, mode) {
  const zones = await call("GET", `/zones?name=${ZONE}`);
  const zone = zones[0] && zones[0].id;
  const account = zones[0] && zones[0].account && zones[0].account.id;
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
  if (mode === "apply") {
    if (!account) throw new Error("the zone did not name its account");
    // after the route and the record: from here a name could resolve, and from here the Worker knows which hosts are not names
    const labels = await fencedLabels(call, zone);
    await call("PUT", `/accounts/${account}/workers/scripts/${SCRIPT}/secrets`, { name: FENCE_SECRET, text: labels.join(","), type: "secret_text" });
    out.fenced = labels.length;
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
