// Discovery: an agent reads a page of an unknown app and learns where the lists, ids, next page and totals are. Read-only; the key is a handle.
import test from "node:test";
import assert from "node:assert/strict";
import { KEY_A } from "../fixtures/crm.ts";
import { world } from "../fixtures/crm-world.ts";

const code = (c: string) => (e: unknown) => {
  assert.equal((e as { error?: { code?: string } }).error?.code, c, JSON.stringify(e));
  return true;
};
const A = { vaultHandle: "#Ledger_Key", style: "header" as const, header: "X-Api-Token" };
const B = { vaultHandle: "#Orbit_Key", style: "bearer" as const };

test("sample reads a page of an unknown app: list, id, date, types, total and a cursor hint", async () => {
  const w = world();
  const s = await w.k.hs["sync_specs.sample"](w.ctx, { auth: A, domain: "crm-a.test", path: "/api/v2/people", query: { per_page: "2" } });
  assert.equal(s.ok, true);
  const list = s.shape!.lists[0]!;
  assert.deepEqual([list.itemsAt, list.count, list.idAt, list.updatedAtGuess], ["/data", 2, "/id", "/modified"]);
  const type = (p: string) => list.fields.find((f) => f.path === p)?.type;
  assert.deepEqual([type("/attributes/email"), type("/attributes/phone"), type("/modified"), type("/attributes/full_name"), type("/org_id")], ["email", "phone", "date", "text", "text"]);
  assert.deepEqual(s.shape!.totals, [{ pointer: "/meta/total", value: 5 }]);
  assert.deepEqual(s.estimate, { count: 5, source: "/meta/total" });
  assert.equal(s.items!.length, 2);
});

test("sample sees a Link header and a top-level shape it has not met before", async () => {
  const w = world();
  const s = await w.k.hs["sync_specs.sample"](w.ctx, { auth: B, domain: "crm-b.test", path: "/v1/objects/jobs", query: { limit: "2" } });
  assert.equal(s.nextLink, "https://crm-b.test/v1/objects/jobs?limit=2&after=2");
  assert.equal(s.shape!.lists[0]!.itemsAt, "/items");
  assert.equal(s.shape!.lists[0]!.idAt, "/uid");
  assert.equal(s.shape!.lists[0]!.fields.find((f) => f.path === "/props/opened")!.type, "date");
  const next = await w.k.hs["sync_specs.sample"](w.ctx, { auth: B, domain: "crm-b.test", path: "/", url: s.nextLink! });
  assert.deepEqual(next.shape!.lists[0]!.count, 1);
});

test("sample reads a field-metadata endpoint so choices come from the app", async () => {
  const w = world();
  const f = await w.k.hs["sync_specs.sample"](w.ctx, { auth: A, domain: "crm-a.test", path: "/api/v2/fields/people" });
  assert.match(f.preview!, /"key":"status"/);
  assert.match(f.preview!, /"value":"client"/);
  const schema = await w.k.hs["sync_specs.sample"](w.ctx, { auth: B, domain: "crm-b.test", path: "/v1/schema/jobs" });
  assert.match(schema.preview!, /"options":\["install","repair"\]/);
});

test("sample says what went wrong in plain words", async () => {
  const w = world();
  const bad = await w.k.hs["sync_specs.sample"](w.ctx, { auth: { ...A, vaultHandle: "#Orbit_Key" }, domain: "crm-a.test", path: "/api/v2/people" });
  assert.deepEqual([bad.ok, bad.status], [false, 401]);
  assert.match(bad.reason!, /refused the key/);
  const none = await w.k.hs["sync_specs.sample"](w.ctx, { auth: A, domain: "crm-a.test", path: "/api/v2/nothing" });
  assert.match(none.reason!, /answered 404/);
});

test("survey looks at several paths at once and keeps it short", async () => {
  const w = world();
  const r = await w.k.hs["sync_specs.survey"](w.ctx, { auth: A, domain: "crm-a.test", paths: ["/api/v2/people?per_page=2", "/api/v2/organizations", "/api/v2/deals", "/api/v2/fields/people"] });
  assert.deepEqual(r.results.map((x) => [x.path, x.status]), [["/api/v2/people?per_page=2", 200], ["/api/v2/organizations", 200], ["/api/v2/deals", 404], ["/api/v2/fields/people", 200]]);
  assert.deepEqual(r.results[0]!.lists[0], { itemsAt: "/data", count: 2, idAt: "/id", fields: 9 });
  assert.equal(r.results[0]!.total, 5);
  assert.match(r.results[2]!.reason!, /404/);
});

test("discovery only ever sends GET, and refuses a key value or another host", async () => {
  const w = world();
  await w.k.hs["sync_specs.sample"](w.ctx, { auth: A, domain: "crm-a.test", path: "/api/v2/people" });
  await w.k.hs["sync_specs.survey"](w.ctx, { auth: B, domain: "crm-b.test", paths: ["/v1/objects/jobs"] });
  assert.ok(w.c.state.requests.length >= 2 && w.c.state.requests.every((r) => r.method === "GET"));
  await assert.rejects(w.k.hs["sync_specs.sample"](w.ctx, { auth: { ...A, vaultHandle: KEY_A }, domain: "crm-a.test", path: "/x" }), code("validation.bad_input"));
  await assert.rejects(w.k.hs["sync_specs.sample"](w.ctx, { auth: A, domain: "crm-a.test", path: "/x", url: "https://evil.test/x" }), code("validation.bad_input"));
  await assert.rejects(w.k.hs["sync_specs.sample"](w.ctx, { auth: A, domain: "crm-a.test", path: "people" }), code("validation.bad_input"));
  await assert.rejects(w.k.hs["sync_specs.survey"](w.ctx, { auth: A, domain: "crm-a.test", paths: [] }), code("validation.bad_input"));
});
