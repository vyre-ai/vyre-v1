// The module loader: stub modules answer their examples, live modules use their own handlers, ctx.db cannot leave the module's tables, ctx.http cannot leave the connector's domains, bad boots are refused.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { AccessSnapshot, authorize } from "../../kernel/src/authorize/index.ts";
import { registry } from "../../generated/registry.ts";
import { routes } from "../../generated/routes.ts";
import { validateInput, validateOutput } from "../../generated/validators.ts";
import { createInvoke, indexCapabilities } from "../src/invoke.ts";
import { fileImporter, loadHost, readModuleList } from "../src/loader.ts";
import type { RegistryLike } from "../src/loader.ts";
import { checkSql, scopedDb } from "../src/ctx/db.ts";
import { guardedFetch, hostAllowed } from "../src/ctx/http.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const modulesJson = readModuleList(path.join(root, "host/modules.json"));
const reg = registry as unknown as RegistryLike;
const caps = registry.capabilities as unknown as CapabilityDef[];
const TRACE = "a".repeat(32);

test("boot: the real registry, host/modules.json, route table and every stub-impl load; stubs are listed", async () => {
  const h = await loadHost({ registry: reg, modulesJson, routes, importer: fileImporter(root) });
  const withCaps = new Set((registry.capabilities as unknown as { module: string }[]).map((c) => c.module));
  assert.equal(h.serving.size, withCaps.size, "every module with capabilities is served; kits have none");
  assert.ok(h.stubModules().length > 0 && h.stubModules().length <= h.serving.size);
  const r = routes[0]!;
  assert.equal(h.match(r.method, r.path)?.cap, r.cap);
  for (const c of caps.slice(0, 50)) assert.equal(typeof h.handler(c.name, c.v), "function", c.name);
});

test("a stub module answers its example through the invoke pipeline, and the answer validates", async () => {
  const h = await loadHost({ registry: reg, modulesJson, routes, importer: fileImporter(root) });
  const cap = caps.find((c) => (registry.modules.find((m) => m.id === (c as unknown as { module: string }).module)?.status === "stub") && c.resource.type === "space" && c.permission && c.examples.length && c.idempotency !== "key" && !c.gate && !c.caller)!;
  assert.ok(cap, "a stub capability bound to the Space exists");
  const snap = new AccessSnapshot();
  snap.putRole({ id: "member", clearance: 3, perms: [cap.permission!], name: "Member" });
  snap.putPrincipal({ id: "usr_dana", kind: "person", status: "active", name: "Dana" });
  snap.addPrincipalRole({ holder: "usr_dana", role: "member" });
  snap.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_dana", holds: 0 });
  const invoke = createInvoke({ caps: indexCapabilities(caps), validateInput, authorize: (r) => authorize(snap, r), handler: h.handler, services: h.services, commit: async (b) => b.events });
  const res = await invoke(cap.name, cap.examples[0]!.input, { space: "spc_1", principal: { kind: "person", id: "usr_dana" } });
  assert.equal(res.status, "ok");
  const out = (res as { output: unknown }).output;
  assert.deepEqual(validateOutput(cap.name, cap.v, out), []);
  assert.deepEqual(out, cap.examples[0]!.output, "the stub returns the first example output");
});

const tiny = (status: "stub" | "live"): { reg: RegistryLike; list: { modules: { id: string; owner: string; status: string }[] } } => ({
  reg: { modules: [{ id: "demo", owner: "L1", status }], capabilities: [{ name: "demo.hello", v: 1, module: "demo" }], connectors: [{ module: "demo", domains: ["api.demo.test"] }] },
  list: { modules: [{ id: "demo", owner: "L1", status: "stub" }] },
});

test("status picks the handlers: stub serves stub-impl, live serves impl", async () => {
  const asked: string[] = [];
  const importer = async (id: string, kind: "stub" | "live") => { asked.push(`${id}:${kind}`); return { "demo.hello": async () => ({ from: kind }) }; };
  for (const s of ["stub", "live"] as const) {
    const t = tiny(s);
    const h = await loadHost({ registry: t.reg, modulesJson: t.list, routes: [], importer });
    assert.deepEqual(await h.handler("demo.hello", 1)!({} as never, {}), { from: s });
    assert.equal(h.serving.get("demo"), s);
  }
  assert.deepEqual(asked, ["demo:stub", "demo:live"]);
});

test("boot is refused with every problem listed", async () => {
  const t = tiny("live");
  const cases: [string, Parameters<typeof loadHost>[0], RegExp][] = [
    ["missing handler", { registry: t.reg, modulesJson: t.list, routes: [], importer: async () => ({}) }, /no handler for demo\.hello/],
    ["not in modules.json", { registry: t.reg, modulesJson: { modules: [] }, routes: [], importer: async () => ({ "demo.hello": async () => 1 }) }, /not in host\/modules\.json/],
    ["owner mismatch", { registry: t.reg, modulesJson: { modules: [{ id: "demo", owner: "L2", status: "stub" }] }, routes: [], importer: async () => ({ "demo.hello": async () => 1 }) }, /owner L1/],
    ["listed without manifest", { registry: t.reg, modulesJson: { modules: [...t.list.modules, { id: "ghost", owner: "L1", status: "stub" }] }, routes: [], importer: async () => ({ "demo.hello": async () => 1 }) }, /ghost/],
    ["route to unknown cap", { registry: t.reg, modulesJson: t.list, routes: [{ method: "POST", path: "/x", cap: "no.such", v: 1, effects: "read" }], importer: async () => ({ "demo.hello": async () => 1 }) }, /unknown capability no\.such/],
    ["importer fails", { registry: t.reg, modulesJson: t.list, routes: [], importer: async () => { throw new Error("boom"); } }, /cannot load live handlers \(boom\)/],
  ];
  for (const [name, opts, re] of cases) await assert.rejects(loadHost(opts), re, name);
});

test("ctx.db: own tables only", () => {
  const ok = (sql: string) => assert.equal(checkSql("demo", sql).ok, true, sql);
  const no = (sql: string, why?: RegExp) => { const r = checkSql("demo", sql); assert.equal(r.ok, false, sql); if (why && !r.ok) assert.match(r.why, why); };
  ok("SELECT * FROM demo_items WHERE id = ?");
  ok('SELECT a.id FROM "demo_items" a JOIN demo_tags t ON t.item = a.id');
  ok("SELECT * FROM demo_a, demo_b WHERE demo_a.x = demo_b.x");
  ok("INSERT INTO demo_items (id) VALUES (?)");
  ok("UPDATE demo_items SET n = 1");
  ok("DELETE FROM demo_items WHERE id = ?;");
  ok("WITH t AS (SELECT id FROM demo_items) SELECT * FROM t");
  ok("WITH a AS (SELECT 1), b(x) AS (SELECT 2) SELECT * FROM a, b");
  ok("SELECT 'FROM other_things' AS s FROM demo_items -- FROM evil\n");
  ok("SELECT j.value FROM demo_items, json_each(demo_items.tags) j");
  ok("CREATE TABLE IF NOT EXISTS demo_new (id TEXT)");
  ok("CREATE INDEX demo_i ON demo_items (id)");
  ok("INSERT INTO demo_items (id) VALUES (1) ON CONFLICT(id) DO UPDATE SET n = 2");
  no("SELECT * FROM records_rows", /records_rows/);
  no("SELECT * FROM demo_items JOIN access_grants ON 1", /access_grants/);
  no("SELECT * FROM demo_items, access_grants", /access_grants/);
  no("SELECT * FROM demo_items WHERE id IN (SELECT id FROM access_grants)", /access_grants/);
  no("SELECT * FROM (SELECT * FROM access_grants)", /access_grants/);
  no("INSERT INTO access_grants VALUES (1)", /access_grants/);
  no("UPDATE access_grants SET x = 1", /access_grants/);
  no("DELETE FROM access_grants", /access_grants/);
  no("DROP TABLE access_grants", /access_grants/);
  no("ALTER TABLE demo_items RENAME TO access_stolen", /access_stolen/);
  no("CREATE INDEX x ON access_grants (id)");
  no("SELECT * FROM main.demo_items", /schema/);
  no("SELECT * FROM demo_items; DROP TABLE demo_items", /one statement/);
  no("ATTACH DATABASE 'x' AS y");
  no("PRAGMA table_info(access_grants)");
  no("SELECT * FROM sqlite_master");
  no("SELECT load_extension('x')");
  no("SELECT * FROM demoitems", /demo_/);
  no("EXPLAIN SELECT 1", /kind/);
  no("SELECT * FROM [access_grants]", /access_grants/);
  no("SELECT * FROM `access_grants`", /access_grants/);
});

test("ctx.db against SQLite: own table works, another module's table is refused before it runs", () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE demo_items (id TEXT, n INTEGER); CREATE TABLE access_grants (id TEXT); INSERT INTO access_grants VALUES ('secret')");
  const db = scopedDb("demo", { all: (s, ...a) => raw.prepare(s).all(...(a as never[])), run: (s, ...a) => ({ changes: Number(raw.prepare(s).run(...(a as never[])).changes) }) }, TRACE);
  assert.equal(db.run("INSERT INTO demo_items VALUES (?, ?)", "a", 1).changes, 1);
  assert.deepEqual(db.all("SELECT id, n FROM demo_items").map((r) => ({ ...(r as object) })), [{ id: "a", n: 1 }]);
  assert.throws(() => db.all("SELECT * FROM access_grants"), (e: unknown) => (e as { error: { code: string } }).error.code === "permission.no_grant");
  assert.throws(() => db.all("SELECT * FROM demo_items, access_grants"));
});

test("services: ctx.db is scoped to the capability's module, and refuses everything with no database", async () => {
  const t = tiny("live");
  const raw = new DatabaseSync(":memory:");
  raw.exec("CREATE TABLE other_t (id TEXT); CREATE TABLE demo_t (id TEXT)");
  const rawDb = { all: (s: string) => raw.prepare(s).all(), run: (s: string) => ({ changes: Number(raw.prepare(s).run().changes) }) };
  const importer = async () => ({ "demo.hello": async () => 1 });
  const cap = { name: "demo.hello", v: 1 } as unknown as CapabilityDef;
  const seed = { space: "s", principal: { kind: "person", id: "u" } } as const;
  const h = await loadHost({ registry: t.reg, modulesJson: t.list, routes: [], db: rawDb, importer });
  const svc = h.services(seed, cap);
  assert.deepEqual(svc.db!.all("SELECT * FROM demo_t"), []);
  assert.throws(() => svc.db!.all("SELECT * FROM other_t"), (e: unknown) => (e as { error: { code: string } }).error.code === "permission.no_grant");
  const bare = await loadHost({ registry: t.reg, modulesJson: t.list, routes: [], importer });
  assert.throws(() => bare.services(seed, cap).db!.all("SELECT 1"), (e: unknown) => (e as { error: { code: string } }).error.code === "internal.not_implemented");
});

test("ctx.http: https to the connector's domains only, redirects included", async () => {
  assert.equal(hostAllowed("api.demo.test", ["demo.test"]), true);
  assert.equal(hostAllowed("demo.test", ["demo.test"]), true);
  assert.equal(hostAllowed("evildemo.test", ["demo.test"]), false);
  assert.equal(hostAllowed("demo.test.evil.com", ["demo.test"]), false);
  const seen: string[] = [];
  const fakeFetch = async (url: string) => {
    seen.push(url);
    if (url.endsWith("/hop")) return { status: 302, headers: { get: () => "https://evil.example/x" }, text: async () => "" };
    if (url.endsWith("/in")) return { status: 302, headers: { get: () => "/ok" }, text: async () => "" };
    return { status: 200, headers: { get: () => null }, text: async () => "body" };
  };
  const f = guardedFetch(["demo.test"], TRACE, fakeFetch);
  assert.equal(await (await f("https://api.demo.test/ok")).text(), "body");
  assert.equal((await f("https://api.demo.test/in")).status, 200, "a redirect inside the list is followed");
  for (const bad of ["https://evil.example/", "http://api.demo.test/ok", "https://user:pw@api.demo.test/", "not a url", "https://demo.test.evil.com/"]) {
    await assert.rejects(f(bad), (e: unknown) => ["permission.no_grant", "validation.bad_input"].includes((e as { error: { code: string } }).error.code), bad);
  }
  await assert.rejects(f("https://api.demo.test/hop"), (e: unknown) => (e as { error: { code: string } }).error.code === "permission.no_grant");
  assert.ok(!seen.includes("https://evil.example/x"), "the redirect target was never fetched");
  await assert.rejects(guardedFetch([], TRACE, fakeFetch)("https://api.demo.test/ok"), "a module with no connector has no egress");
});

test("loader collects each module impl's hostSeams, and refuses two modules offering the same setter", async () => {
  const t = tiny("stub");
  const setGoogleHost = (): void => {};
  const importer = async () => ({ "demo.hello": async () => ({}) });
  const h = await loadHost({ registry: t.reg, modulesJson: t.list, routes: [], importer, seamImporter: async (id) => (id === "demo" ? { setGoogleHost } : undefined) });
  assert.equal(h.hostSeams.setGoogleHost, setGoogleHost);
  const none = await loadHost({ registry: t.reg, modulesJson: t.list, routes: [], importer });
  assert.deepEqual(none.hostSeams, {});
  const two: RegistryLike = { modules: [...t.reg.modules, { id: "demo2", owner: "L1", status: "stub" }], capabilities: [...t.reg.capabilities, { name: "demo2.hello", v: 1, module: "demo2" }] };
  await assert.rejects(
    () => loadHost({ registry: two, modulesJson: { modules: [...t.list.modules, { id: "demo2", owner: "L1", status: "stub" }] }, routes: [], importer: async (id) => ({ [`${id}.hello`]: async () => ({}) }), seamImporter: async () => ({ setGoogleHost }) }),
    /offers setGoogleHost, which another module already offers/,
  );
});
