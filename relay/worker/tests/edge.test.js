// @ts-check
import test from "node:test";
import assert from "node:assert/strict";
import { client, run, snapshot, fencedLabels, FENCE_SECRET, ROUTE, SCRIPT, WILDCARD } from "../edge.mjs";

/** A fake Cloudflare API over a zone with some records and routes. */
function cf(o = {}) {
  const state = { secrets: /** @type {any[]} */ ([]), dns: [...(o.dns || [])], routes: [...(o.routes || [])], calls: /** @type {string[]} */ ([]) };
  const f = /** @type {typeof fetch} */ (async (url, init) => {
    const u = new URL(String(url)); const method = (init && init.method) || "GET"; const p = u.pathname.replace("/client/v4", "");
    state.calls.push(`${method} ${p}`);
    const ok = (/** @type {unknown} */ result) => new Response(JSON.stringify({ success: true, result }));
    if (p === "/zones") return ok([{ id: "z1", account: { id: "acc1" } }]);
    if (p === "/accounts/acc1/workers/scripts/vyre-relay/secrets" && method === "PUT") { state.secrets.push(JSON.parse(String(init && init.body))); return ok({}); }
    if (p === "/zones/z1/dns_records" && method === "GET") return ok(u.searchParams.has("name") ? state.dns.filter(r => r.name === u.searchParams.get("name")) : state.dns);
    if (p === "/zones/z1/dns_records" && method === "POST") { const b = JSON.parse(String(init && init.body)); state.dns.push({ id: `d${state.dns.length}`, ...b }); return ok(b); }
    if (p.startsWith("/zones/z1/dns_records/") && method === "DELETE") { state.dns = state.dns.filter(r => r.id !== p.split("/").pop()); return ok({}); }
    if (p === "/zones/z1/workers/routes" && method === "GET") return ok(state.routes);
    if (p === "/zones/z1/workers/routes" && method === "POST") { const b = JSON.parse(String(init && init.body)); state.routes.push({ id: `r${state.routes.length}`, ...b }); return ok(b); }
    if (p.startsWith("/zones/z1/workers/routes/") && method === "DELETE") { state.routes = state.routes.filter(r => r.id !== p.split("/").pop()); return ok({}); }
    return new Response(JSON.stringify({ success: false, errors: [{ message: `unexpected ${method} ${p}` }] }));
  });
  return { state, call: client(f, "t") };
}

test("apply adds the route and the proxied wildcard record, a second apply changes nothing, remove takes exactly those two away", async () => {
  const keep = { id: "k1", name: "www.vyre.run", type: "CNAME", content: "vyre-site.pages.dev", proxied: true };
  const other = { id: "ro", pattern: "vyre.run/api/updates", script: "vyre-updates" };
  const { state, call } = cf({ dns: [keep], routes: [other] });
  assert.deepEqual(await run(call, "status"), { dns: "absent", route: "absent" });
  assert.deepEqual(await run(call, "apply"), { dns: "created", route: "created", fenced: 1 });
  assert.deepEqual(state.routes.map(r => [r.pattern, r.script]), [[other.pattern, other.script], [ROUTE, SCRIPT]]);
  assert.deepEqual(state.dns.find(r => r.name === WILDCARD), { id: "d1", type: "AAAA", name: WILDCARD, content: "100::", proxied: true, ttl: 1, comment: "phone access wildcard (relay/worker/edge.mjs)" });
  assert.ok(state.calls.indexOf("POST /zones/z1/workers/routes") < state.calls.indexOf("POST /zones/z1/dns_records"), "the route is in place before anything resolves to it");
  assert.deepEqual(await run(call, "apply"), { dns: "present", route: "present", fenced: 1 });
  assert.deepEqual(await run(call, "remove"), { dns: "removed", route: "removed" });
  assert.deepEqual(state.dns, [keep]);
  assert.deepEqual(state.routes, [other]);
});

test("a conflicting record or route stops it before anything is written", async () => {
  for (const o of [{ dns: [{ id: "a", name: WILDCARD, type: "A", content: "1.2.3.4" }] }, { dns: [{ id: "a", name: WILDCARD, type: "AAAA", content: "2001:db8::1", proxied: true }] }, { routes: [{ id: "r", pattern: ROUTE, script: "someone-else" }] }]) {
    const { state, call } = cf(o);
    await assert.rejects(run(call, "apply"), /nothing was changed/);
    assert.deepEqual(state.calls.filter(c => c.startsWith("POST") || c.startsWith("DELETE")), []);
  }
});

test("the snapshot reads each host the way a visitor does and names a host that fails", async () => {
  const f = /** @type {typeof fetch} */ (async url => String(url).includes("//dl.") ? Promise.reject(new Error("refused")) : new Response("x", { status: 200, headers: { "content-type": "text/html" } }));
  assert.deepEqual(await snapshot(f, ["www", "dl"]), { www: "200 text/html", dl: "error refused" });
});

test("apply fences every label the zone already has a record for, so a new proxied host is fenced by running it again", async () => {
  const { state, call } = cf({ dns: [
    { id: "1", name: "www.vyre.run", type: "CNAME", content: "x" }, { id: "2", name: "dl.vyre.run", type: "CNAME", content: "y" }, { id: "3", name: "app.vyre.run", type: "AAAA", content: "100::" },
    { id: "4", name: "vyre.run", type: "MX", content: "m" }, { id: "5", name: "vyre.run", type: "CNAME", content: "apex" }, { id: "6", name: "a.b.vyre.run", type: "A", content: "1" }, { id: "7", name: "cf2024-1._domainkey.vyre.run", type: "TXT", content: "k" },
  ] });
  assert.deepEqual(await fencedLabels(call, "z1"), ["app", "dl", "www"], "single labels with an address record; no apex, no deeper name, no TXT");
  await run(call, "apply");
  assert.deepEqual(state.secrets, [{ name: FENCE_SECRET, text: "app,dl,www", type: "secret_text" }]);
  // the owner adds a proxied host; the next apply fences it, and the wildcard record the first apply made is not a host
  state.dns.push({ id: "8", name: "status.vyre.run", type: "AAAA", content: "100::" });
  await run(call, "apply");
  assert.equal(state.secrets[1].text, "app,dl,status,www");
  const status = await run(call, "status");
  assert.equal(status.fenced, undefined, "status writes nothing");
  assert.equal(state.secrets.length, 2);
});
