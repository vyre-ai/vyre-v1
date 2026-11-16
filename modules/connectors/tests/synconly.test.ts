// A field that takes its value only when another pointer of the same row says so: one id pointer, three kinds of record whose ids share a number range, each row linked to the one right target and to nothing else.
import test from "node:test";
import assert from "node:assert/strict";
import { ledgerSpec } from "../fixtures/crm.ts";
import { world } from "../fixtures/crm-world.ts";
import { compileSpec, fieldOf, parseSpec, valueOfRemote, whenRemote } from "../syncspec.ts";
import type { SyncSpec } from "../syncspec.ts";
import { remoteStore } from "../../../host/src/daemon/syncengine.ts";

const mutate = (spec: Record<string, any>, fn: (s: Record<string, any>) => void): Record<string, any> => {
  const s = JSON.parse(JSON.stringify(spec));
  fn(s);
  return s;
};
/** people rows carry a kind and an id; three fields read the same id pointer, each only for one kind. */
const specWith = () =>
  mutate(ledgerSpec(), (s) => {
    const people = s["objects"][1];
    people["fields"] = people["fields"].filter((f: any) => f.path !== "/org_id");
    for (const [key, kind, to] of [
      ["matter_of", "prospect", "organizations"],
      ["contact_of", "contact", "organizations"],
      ["company_of", ["company", " Org "], "organizations"],
    ] as const)
      people["fields"].push({
        path: "/org_id",
        key,
        label: key,
        type: "relation",
        relationTo: to,
        onlyWhen: { path: "/kind", equals: kind },
      });
    people["fields"].push({ path: "/kind", label: "Kind", type: "text" });
    s["mapping"][1]["fields"] = s["mapping"][1]["fields"].filter((f: any) => f.path !== "/org_id");
    for (const key of ["matter_of", "contact_of", "company_of"])
      s["mapping"][1]["fields"].push({ path: "/org_id", field: key, direction: "pull" });
  });

test("onlyWhen: fields that share a path compile to their own keys, read-only, with a condition on the row", () => {
  const spec = parseSpec(specWith()).spec as SyncSpec;
  assert.ok(spec);
  assert.equal(fieldOf(spec.objects[1], { path: "/org_id", field: "contact_of" })!.key, "contact_of");
  const person = compileSpec(spec).types.find((t) => t.recordType === "person")!;
  const c = person.fields.filter((f) => f.remote.startsWith("=when:"));
  assert.deepEqual(
    c.map((f) => f.key),
    ["matter_of", "contact_of", "company_of"],
  );
  assert.ok(c.every((f) => f.dir === "pull" && f.relation === "organizations"));
  assert.notEqual(c[0]!.remote, c[1]!.remote);
  // the condition's pointer is read from the app even though it is only a condition
  const conn = compileSpec(spec).connector;
  const shape = conn.actions.find((a) => a.name === conn.objects!["people"]!.list)!.shape as { fields: string[] };
  assert.ok(shape.fields.includes("/kind") && shape.fields.includes("/org_id"));
});

test("a row takes the value only for its own kind: colliding ids, a changed kind, an unknown kind", () => {
  const remotes = {
    matter: whenRemote("/org_id", { path: "/kind", equals: "prospect" }),
    contact: whenRemote("/org_id", { path: "/kind", equals: "contact" }),
    company: whenRemote("/org_id", { path: "/kind", equals: ["company", " Org "] }),
  };
  const link = (row: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(remotes).map(([k, r]) => [k, valueOfRemote(row, r) ?? null]));
  assert.deepEqual(link({ "/org_id": "7", "/kind": "prospect" }), { matter: "7", contact: null, company: null });
  assert.deepEqual(
    link({ "/org_id": "7", "/kind": "Contact " }),
    { matter: null, contact: "7", company: null },
    "same id, other kind: no link to the first",
  );
  assert.deepEqual(link({ "/org_id": "7", "/kind": "ORG" }), { matter: null, contact: null, company: "7" });
  assert.deepEqual(
    link({ "/org_id": "7", "/kind": "event" }),
    { matter: null, contact: null, company: null },
    "an unknown kind links to nothing",
  );
  assert.deepEqual(link({ "/org_id": "7" }), { matter: null, contact: null, company: null }, "no kind: nothing");
  // the kind changes at the app: the link moves
  assert.deepEqual(link({ "/org_id": "7", "/kind": "contact" }), { matter: null, contact: "7", company: null });
});

test("the engine reads the same condition when it reads the app's rows", async () => {
  const wk = whenRemote("/org_id", { path: "/kind", equals: "prospect" });
  const rows = [
    { id: "1", properties: { "/org_id": "7", "/kind": "prospect" } },
    { id: "2", properties: { "/org_id": "7", "/kind": "contact" } },
    { id: "3", properties: { "/org_id": "7" } },
  ];
  const ctx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: () => ({}),
    call: async (cap: string) =>
      cap === "connectors.get" ? { connector: { key: "x" } } : { output: { results: rows } },
  };
  const store = remoteStore(ctx, { connector: "x", connectionId: "c", remote: "things" }, undefined, { whens: [wk] });
  const page = await store.page();
  assert.deepEqual(
    page.rows.map((r) => r.data[wk]),
    ["7", null, null],
  );
});

test("validate: an onlyWhen whose path the object does not describe is an error; preview shows which rows matched", async () => {
  const w = world();
  const bad = mutate(specWith(), (s) => {
    s["objects"][1]["fields"].find((f: any) => f.key === "matter_of").onlyWhen.path = "/nope";
  });
  const v = await w.k.hs["sync_specs.validate"](w.ctx, { spec: bad });
  assert.equal(v.ok, false);
  assert.match(
    v.problems
      .filter((p) => p.level === "error")
      .map((p) => p.message)
      .join(" "),
    /\/nope is not described/,
  );
  assert.match(
    parseSpec(mutate(specWith(), (s) => (s["objects"][1]["fields"][0]["onlyWhen"] = { path: "/kind" })))
      .problems.map((p) => p.message)
      .join(" "),
    /onlyWhen is/,
  );
});

test("three relations from one id pointer to one target each get their own inverse, so the type can be made", () => {
  const person = compileSpec(parseSpec(specWith()).spec as SyncSpec).types.find((t) => t.recordType === "person")!;
  assert.equal(person.relations.length, 3);
  assert.equal(new Set(person.relations.map((r) => r.inverse)).size, 3);
  assert.equal(new Set(person.relations.map((r) => r.inverseTitle)).size, 3);
});
