// SyncSpec: parse, validate against real pages, compile, apply. Two made-up CRMs (fixtures/crm.ts) with different shapes; nothing here is specific to either.
import test from "node:test";
import assert from "node:assert/strict";
import { KEY_A, KEY_B, ledgerSpec, orbitSpec } from "../fixtures/crm.ts";
import { KEYS, world } from "../fixtures/crm-world.ts";
import { executeAction } from "../handlers/runtime.ts";
import { compileSpec, nextLink, parseSpec, readPage } from "../syncspec.ts";
import type { SyncSpec } from "../syncspec.ts";
import type { ConnectionDb, ConnectorDef } from "../projections.ts";

const code = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c, JSON.stringify(e));
  return true;
};
type World = ReturnType<typeof world>;
const validate = (w: World, spec: unknown) => w.k.hs["sync_specs.validate"](w.ctx, { spec });
const mutate = (spec: Record<string, any>, fn: (s: Record<string, any>) => void): Record<string, any> => { const s = JSON.parse(JSON.stringify(spec)); fn(s); return s; };

test("parse refuses a key value where a Vault handle belongs, and styles it cannot use", () => {
  const bad = parseSpec(mutate(ledgerSpec(), (s) => { s["auth"]["vaultHandle"] = "sk_live_abcdef"; }));
  assert.equal(bad.spec, undefined);
  assert.match(bad.problems.map((p) => p.message).join(" "), /Vault handle/);
  assert.match(parseSpec(mutate(ledgerSpec(), (s) => { s["auth"]["style"] = "query"; })).problems[0]!.message, /address/);
  assert.match(parseSpec(mutate(ledgerSpec(), (s) => { s["auth"]["style"] = "oauth"; })).problems[0]!.message, /OAuth/);
  assert.ok(parseSpec(ledgerSpec()).spec);
});

test("parse refuses a write the docs were not cited for", () => {
  const r = parseSpec(mutate(ledgerSpec(), (s) => { delete s["objects"][1]["update"]["evidence"]; }));
  assert.match(r.problems.map((p) => p.message).join(" "), /evidence/);
  const noId = parseSpec(mutate(ledgerSpec(), (s) => { s["objects"][1]["update"]["path"] = "/api/v2/people"; }));
  assert.match(noId.problems.map((p) => p.message).join(" "), /\{id\}/);
});

test("nextLink reads rel=next out of a Link header", () => {
  assert.equal(nextLink('<https://a.test/x?after=2>; rel="next", <https://a.test/x>; rel="first"'), "https://a.test/x?after=2");
  assert.equal(nextLink('<https://a.test/x>; rel="first"'), undefined);
});

test("validate proves both CRMs on a real sampled page, second page included", async () => {
  const w = world();
  const a = await validate(w, ledgerSpec());
  assert.deepEqual(a.problems.filter((p) => p.level === "error"), []);
  assert.equal(a.ok, true);
  assert.deepEqual(a.objects.map((o) => [o.remote, o.items, o.hasNext]), [["organizations", 2, false], ["people", 2, true]]);
  const b = await validate(w, orbitSpec());
  assert.equal(b.ok, true, JSON.stringify(b.problems));
  assert.deepEqual(b.objects.map((o) => [o.remote, o.items, o.hasNext, o.fieldsFound]), [["matters", 2, true, 4]]);
  const paths = w.c.state.requests.map((r) => `${r.host}${r.path}`);
  assert.ok(paths.filter((p) => p === "crm-b.test/v1/objects/matters").length >= 2, "the link page was fetched");
});

test("validate names what is wrong against the real page", async () => {
  const w = world();
  const wrongPath = await validate(w, mutate(ledgerSpec(), (s) => { s["objects"][1]["list"]["path"] = "/api/v2/persons"; }));
  assert.equal(wrongPath.ok, false);
  assert.match(wrongPath.problems[0]!.message, /404/);
  const noList = await validate(w, mutate(ledgerSpec(), (s) => { s["objects"][1]["itemsAt"] = "/rows"; }));
  assert.match(noList.problems.map((p) => p.message).join(" "), /no list at \/rows/);
  const noField = await validate(w, mutate(ledgerSpec(), (s) => { s["objects"][1]["fields"][1]["path"] = "/attributes/mail"; s["mapping"][1]["fields"][1]["path"] = "/attributes/mail"; }));
  assert.match(noField.problems.map((p) => p.message).join(" "), /\/attributes\/mail is not in any of the 2 sampled records/);
  const badId = await validate(w, mutate(ledgerSpec(), (s) => { s["objects"][1]["id"] = "/uuid"; }));
  assert.match(badId.problems.map((p) => p.message).join(" "), /no id at \/uuid/);
  const stuck = await validate(w, mutate(ledgerSpec(), (s) => { s["objects"][1]["list"]["cursor"]["param"] = "nothing"; }));
  assert.match(stuck.problems.map((p) => p.message).join(" "), /repeats the first/);
  const noTarget = await validate(w, mutate(ledgerSpec(), (s) => { s["mapping"].shift(); }));
  assert.match(noTarget.problems.map((p) => p.message).join(" "), /Organization points at organizations/);
  w.k.vault["#Ledger_Key"] = "wrong"; KEYS["#Ledger_Key"] = "wrong";
  try { assert.match((await validate(w, ledgerSpec())).problems[0]!.message, /refused the key \(401\)/); } finally { KEYS["#Ledger_Key"] = KEY_A; }
});

test("validate warns, never fails, on values that do not fit and on sensitive fields", async () => {
  const w = world();
  w.c.state.people[0]!.attributes.tier = "platinum";
  const r = await validate(w, mutate(ledgerSpec(), (s) => { s["objects"][1]["fields"][5]["label"] = "Date of birth"; }));
  assert.equal(r.ok, true);
  assert.match(r.problems.map((p) => p.message).join(" "), /do not fit choice or its choices/);
  assert.match(r.problems.map((p) => p.message).join(" "), /Date of birth looks sensitive/);
});

test("compile: actions by the spec's own shapes, writes only where cited, deletes off by default", () => {
  const ledger = compileSpec(parseSpec(ledgerSpec()).spec!);
  const names = ledger.connector.actions.map((a) => a.name);
  assert.deepEqual(names, ["list_organizations", "list_organizations_after", "list_people", "list_people_after", "update_people"]);
  assert.equal(ledger.connector.actions.find((a) => a.name === "update_people")!.write, true);
  assert.equal(ledger.connector.actions.some((a) => /delete|create/.test(a.name)), false);
  const people = ledger.types.find((t) => t.remote === "people")!;
  assert.equal(people.fields.find((f) => f.key === "org")!.dir, "pull", "a relation is pulled only");
  assert.equal(people.fields.find((f) => f.key === "org")!.relation, "organizations");
  assert.deepEqual(people.defs.find((d) => d.key === "stage")!.options, { stages: [{ key: "lead", title: "Lead" }, { key: "client", title: "Client" }, { key: "closed", title: "Closed" }] });
  assert.equal(people.statusField, "stage");
  assert.equal(people.titleField, "name");
  assert.deepEqual(people.relations, [{ field: "org", title: "Organization", to: "org", inverse: "persons", inverseTitle: "Persons" }]);
  assert.deepEqual(ledger.connector.actions.find((a) => a.name === "list_people")!.query, { modified_after: "2026-01-01T00:00:00Z", per_page: "2", page: "1" });
  // backfill now drops the first-pull filter
  const spec = parseSpec(ledgerSpec()).spec!;
  const full = compileSpec({ ...spec, plan: { ...spec.plan, backfill: "now" } });
  assert.deepEqual(full.connector.actions.find((a) => a.name === "list_people")!.query, { per_page: "2", page: "1" });
  // a mapped field with no documented update is pulled only
  const noUpdate = parseSpec(mutate(ledgerSpec(), (s) => { delete s["objects"][1]["update"]; })).spec!;
  assert.ok(compileSpec(noUpdate).types.find((t) => t.remote === "people")!.fields.every((f) => f.dir === "pull" || f.dir === "off"));
});

test("a list action reads both shapes: page numbers and Link headers", async () => {
  const w = world();
  const run = async (def: ConnectorDef, action: string, input: unknown, secret: string) => {
    const conn = { connection_id: "con_x", connector: def.key, title: "x", owner_kind: "space", owner_id: "space", state: "active", paused_by: null, paused_from: null, scopes: "[]", secrets: "{}", last_sync_at: null, created_at: 0 } as ConnectionDb;
    void conn;
    return executeAction(w.k.deps, w.ctx, def, action, {
      input, secrets: { Key: secret }, persist: false,
      http: async (url, init) => {
        const r = w.c.handle({ method: init?.method ?? "GET", url, headers: init?.headers ?? {}, ...(init?.body ? { body: JSON.parse(init.body) } : {}) });
        return { status: r.status, text: async () => JSON.stringify(r.body ?? null), ...(r.headers?.["link"] ? { link: r.headers["link"] } : {}) };
      },
    });
  };
  const ledger = compileSpec(parseSpec(ledgerSpec()).spec!).connector;
  const p1 = (await run(ledger, "list_people", {}, KEY_A)).output as { rows: { id: string; data: Record<string, unknown>; updatedAt?: string }[]; next?: string };
  assert.deepEqual(p1.rows.map((r) => r.id), ["101", "102"]);
  assert.equal(p1.next, "2");
  assert.equal(p1.rows[0]!.data["/attributes/full_name"], "Ada Stone");
  assert.equal(p1.rows[0]!.data["/org_id"], "o1");
  assert.equal(p1.rows[0]!.updatedAt, "2026-10-01T10:00:00Z");
  const p2 = (await run(ledger, "list_people_after", { after: "2" }, KEY_A)).output as typeof p1;
  assert.deepEqual(p2.rows.map((r) => r.id), ["104", "105"]);
  const p3 = (await run(ledger, "list_people_after", { after: "3" }, KEY_A)).output as typeof p1;
  assert.deepEqual([p3.rows.length, p3.next], [0, undefined]);

  const orbit = compileSpec(parseSpec(orbitSpec()).spec!).connector;
  const m1 = (await run(orbit, "list_matters", {}, KEY_B)).output as typeof p1;
  assert.deepEqual(m1.rows.map((r) => r.id), ["m-1", "m-2"]);
  assert.match(m1.next!, /^https:\/\/crm-b\.test\/v1\/objects\/matters\?limit=2&after=2$/);
  assert.equal(m1.rows[0]!.data["/props/amount"], 12000);
  const m2 = (await run(orbit, "list_matters_after", { after: m1.next }, KEY_B)).output as typeof p1;
  assert.deepEqual([m2.rows.map((r) => r.id), m2.next], [["m-3"], undefined]);
  // a link to another host is refused by the connector's own domain list
  await assert.rejects(run(orbit, "list_matters_after", { after: "https://evil.test/steal" }, KEY_B), code("permission.no_grant"));
  // an update nests flat values back into the item's own shape
  const sent: unknown[] = [];
  await executeAction(w.k.deps, w.ctx, orbit, "update_matters", { input: { id: "m-1", properties: { "/props/title": "New", "/props/amount": 1 } }, secrets: { Key: KEY_B }, persist: false, http: async (_u, init) => { sent.push(JSON.parse(init!.body!)); return { status: 200, text: async () => "{}" }; } });
  assert.deepEqual(sent, [{ props: { title: "New", amount: 1 } }]);
});

test("apply: connector with its own tests, a connection with the handle only, record types with stages and a relation, bindings, first pulls", async () => {
  const w = world();
  const out = await w.k.hs["sync_specs.apply"](w.ctx, { spec: ledgerSpec(), idempotencyKey: "k1" });
  assert.equal(out.connector, "crm_ledger");
  assert.equal(out.version, "1.0.0");
  assert.deepEqual(out.types.map((t) => t.type), ["org", "person"], "a type others point at is pulled first");
  assert.ok(out.types.every((t) => t.runId));
  const row = w.k.tx.get<{ state: string; version: string; def: string }>("SELECT state, version, def FROM cn_connectors WHERE key = 'crm_ledger'")!;
  assert.deepEqual([row.state, row.version], ["live", "1.0.0"]);
  assert.equal((JSON.parse(row.def) as ConnectorDef).tests!.length, 2);
  const conn = w.k.tx.get<{ secrets: string; state: string }>("SELECT secrets, state FROM cn_connections WHERE connector = 'crm_ledger'")!;
  assert.deepEqual(JSON.parse(conn.secrets), { Key: "#Ledger_Key" });
  assert.equal(conn.state, "active");
  // schema: types first, relation after both exist, stages from the pipeline
  const applies = w.calls.filter((c) => c.cap === "schema.apply");
  assert.deepEqual(applies.map((c) => c.input.ops.map((o: any) => o.op)), [["type.create", "type.create"], ["relation.add"]]);
  const person = applies[0]!.input.ops.find((o: any) => o.type === "person");
  assert.equal(person.def.statusField, "stage");
  assert.equal(person.def.fields.find((f: any) => f.key === "stage").type, "status");
  assert.equal(person.def.fields.some((f: any) => f.key === "org"), false, "the relation is made by relation.add");
  assert.deepEqual(applies[1]!.input.ops[0], { op: "relation.add", type: "person", field: "org", def: { to: "org", inverse: "persons", title: "Organization", inverseTitle: "Persons" } });
  // bindings
  const bound = (await w.k.hs["sync_types.get"](w.ctx, { type: "person" })).syncedType;
  assert.equal(bound.remote, "people");
  assert.deepEqual(bound.match, ["email"]);
  assert.equal(bound.conflict, "newest");
  assert.equal(bound.deletes, "off");
  assert.equal(bound.fields.find((f) => f.key === "org")!.relation, "org");
  assert.deepEqual(w.calls.filter((c) => c.cap === "runs.start").length, 2);
  // the spec is kept, with the handle and no key
  const stored = (await w.k.hs["sync_specs.get"](w.ctx, { type: "person" }));
  assert.equal(stored.spec.auth.vaultHandle, "#Ledger_Key");
  const dump = JSON.stringify(w.k.tx.all("SELECT * FROM cn_sync_specs")) + JSON.stringify(w.k.tx.all("SELECT * FROM cn_connectors")) + JSON.stringify(w.calls) + JSON.stringify(w.k.events);
  assert.equal(dump.includes(KEY_A), false);
  assert.equal(dump.includes("ada@example.test"), false, "no app data is copied into the connector or its tests");
});

test("apply refuses a spec that does not hold up against the app, and writes nothing", async () => {
  const w = world();
  await assert.rejects(w.k.hs["sync_specs.apply"](w.ctx, { spec: mutate(ledgerSpec(), (s) => { s["objects"][1]["itemsAt"] = "/rows"; }), idempotencyKey: "k2" }), code("validation.precondition_failed"));
  assert.equal(w.k.tx.get("SELECT 1 AS x FROM cn_connectors WHERE key = 'crm_ledger'"), undefined);
  assert.equal(w.calls.filter((c) => c.cap === "schema.apply").length, 0);
});

test("apply again with the same document keeps the version; a changed one is a new version; an existing type only gains fields", async () => {
  const w = world();
  await w.k.hs["sync_specs.apply"](w.ctx, { spec: ledgerSpec(), idempotencyKey: "k3" });
  const again = await w.k.hs["sync_specs.apply"](w.ctx, { spec: ledgerSpec(), idempotencyKey: "k4" });
  assert.equal(again.version, "1.0.0");
  const more = mutate(ledgerSpec(), (s) => {
    s["objects"][1]["fields"].push({ path: "/attributes/nick", label: "Nickname", type: "text" });
    s["mapping"][1]["fields"].push({ path: "/attributes/nick", field: "nickname", direction: "pull" });
  });
  w.c.state.people.forEach((p) => { (p.attributes as Record<string, string>)["nick"] = "n"; });
  const third = await w.k.hs["sync_specs.apply"](w.ctx, { spec: more, idempotencyKey: "k5" });
  assert.notEqual(third.version, "1.0.0");
  const adds = w.calls.filter((c) => c.cap === "schema.apply").flatMap((c) => c.input.ops).filter((o: any) => o.op === "field.add");
  assert.deepEqual(adds.map((o: any) => `${o.type}.${o.field}`), ["person.nickname"]);
  assert.equal((await w.k.hs["sync_types.get"](w.ctx, { type: "person" })).syncedType.fields.some((f) => f.key === "nickname"), true);
});

test("the Orbit spec: a custom object, Link pagination and a backfill that drops the filter", async () => {
  const w = world();
  const out = await w.k.hs["sync_specs.apply"](w.ctx, { spec: orbitSpec(), idempotencyKey: "k6" });
  assert.deepEqual(out.types.map((t) => t.type), ["matter"]);
  const b = (await w.k.hs["sync_types.get"](w.ctx, { type: "matter" })).syncedType;
  assert.deepEqual(b.fields.map((f) => [f.key, f.dir]), [["title", "both"], ["kind", "both"], ["amount", "both"], ["opened", "pull"]]);
  const bf = await w.k.hs["sync_specs.backfill"](w.ctx, { type: "matter", idempotencyKey: "bf1" } as never);
  assert.ok(bf.runId);
});

test("preview shows the types, three real records and writes nothing", async () => {
  const w = world();
  const p = await w.k.hs["sync_specs.preview"](w.ctx, { spec: ledgerSpec() });
  assert.equal(p.ok, true);
  assert.deepEqual(p.types.map((t) => [t.type, t.isNew]), [["org", true], ["person", true]]);
  assert.equal(p.samples.filter((s) => s.type === "person").length, 2);
  assert.equal(p.samples.find((s) => s.type === "person")!.fields.find((f) => f.key === "name")!.value, "Ada Stone");
  assert.match(p.summary, /Would make 2 record types and bring in Organizations, 5 Persons\. People changed since the start of 2026\. Nothing is written to Ledger\./);
  assert.equal(w.calls.length, 1, "only schema.describe was called");
  assert.equal(w.k.tx.get("SELECT 1 AS x FROM cn_connectors WHERE key = 'crm_ledger'"), undefined);
  assert.ok(w.c.state.requests.every((r) => r.method === "GET"));
});

test("a next-page address inside the answer works like a Link header (cursor kind link with next)", () => {
  const body = { contacts: [{ id: "a" }, { id: "b" }], meta: { total: 9, nextPageUrl: "https://crm-c.test/contacts?after=b" } };
  const o = { itemsAt: "/contacts", id: "/id" };
  assert.equal(readPage(body, undefined, o, { kind: "link", next: "/meta/nextPageUrl" }, undefined)!.next, "https://crm-c.test/contacts?after=b");
  assert.equal(readPage({ ...body, meta: { nextPageUrl: null } }, undefined, o, { kind: "link", next: "/meta/nextPageUrl" }, undefined)!.next, undefined, "the last page has none");
  assert.equal(readPage(body, '<https://crm-c.test/h?p=2>; rel="next"', o, { kind: "link" }, undefined)!.next, "https://crm-c.test/h?p=2", "without a pointer it is the header");
});

test("apply checks the record types first: what the schema refuses stops everything before a connector is made", async () => {
  const w = world();
  const inner = w.ctx.call;
  const ctx = { ...w.ctx, call: async (cap: string, input: unknown) => (cap === "schema.diff" ? { previewToken: "t", items: [], problems: [{ itemKey: "type.create:person", message: "You may not change record types." }] } : inner(cap, input)) };
  await assert.rejects(w.k.hs["sync_specs.apply"](ctx, { spec: ledgerSpec(), idempotencyKey: "k9" }), (e: any) => { assert.equal(e.error.code, "validation.precondition_failed"); assert.match(e.error.message, /You may not change record types\./); return true; });
  assert.equal(w.k.tx.get("SELECT 1 AS x FROM cn_connectors WHERE key = 'crm_ledger'"), undefined);
  assert.equal(w.k.tx.get("SELECT 1 AS x FROM cn_connections"), undefined);
  assert.equal(w.calls.filter((c) => c.cap === "schema.apply").length, 0);
});
