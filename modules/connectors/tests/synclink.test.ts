// SyncSpec relations to one target: a second relation to the same record type gets its own far-end name, a given name wins, and two that clash are said in plain words before apply.
import test from "node:test";
import assert from "node:assert/strict";
import { ledgerSpec } from "../fixtures/crm.ts";
import { world } from "../fixtures/crm-world.ts";
import { compileSpec, parseSpec, relationClashes } from "../syncspec.ts";
import type { SyncSpec } from "../syncspec.ts";

/** The ledger spec with people pointing at organizations four times: the org, an owner, a referrer and a former org. */
function fourWays(extra: Record<string, Record<string, unknown>> = {}): SyncSpec {
  const raw = JSON.parse(JSON.stringify(ledgerSpec())) as Record<string, any>;
  const people = raw["objects"][1];
  const mapping = raw["mapping"][1];
  for (const [path, label] of [
    ["/owner_org_id", "Owner"],
    ["/referrer_org_id", "Referrer"],
    ["/former_org_id", "Former"],
  ] as const) {
    people.fields.push({ path, label, type: "relation", relationTo: "organizations", ...(extra[path] ?? {}) });
    mapping.fields.push({ path, field: label.toLowerCase(), direction: "pull" });
  }
  const parsed = parseSpec(raw);
  assert.ok(parsed.spec, JSON.stringify(parsed.problems));
  return parsed.spec;
}

test("four relations from one type to one target each get their own far end; the first keeps the old name", () => {
  const person = compileSpec(fourWays()).types.find((t) => t.recordType === "person")!;
  assert.deepEqual(person.relations, [
    { field: "org", title: "Organization", to: "org", inverse: "persons", inverseTitle: "Persons" },
    { field: "owner", title: "Owner", to: "org", inverse: "person_owners", inverseTitle: "Persons (owner)" },
    {
      field: "referrer",
      title: "Referrer",
      to: "org",
      inverse: "person_referrers",
      inverseTitle: "Persons (referrer)",
    },
    { field: "former", title: "Former", to: "org", inverse: "person_formers", inverseTitle: "Persons (former)" },
  ]);
  assert.equal(new Set(person.relations.map((r) => r.inverse)).size, 4, "no two far ends share a name");
  assert.deepEqual(relationClashes(fourWays()), []);
  // a re-compile is the same document
  assert.equal(JSON.stringify(compileSpec(fourWays())), JSON.stringify(compileSpec(fourWays())));
});

test("a spec field may name its far end, and that name wins", () => {
  const person = compileSpec(
    fourWays({ "/owner_org_id": { inverseKey: "persons_owned", inverseTitle: "Persons owned" } }),
  ).types.find((t) => t.recordType === "person")!;
  const owner = person.relations.find((r) => r.field === "owner")!;
  assert.equal(owner.inverse, "persons_owned");
  assert.equal(owner.inverseTitle, "Persons owned");
  assert.equal(person.fields.find((f) => f.key === "owner")!.inverse, "persons_owned");
});

test("two given far-end names that clash are said in plain words before apply", async () => {
  const spec = fourWays({
    "/owner_org_id": { inverseKey: "staff" },
    "/referrer_org_id": { inverseKey: "staff" },
  });
  const said = relationClashes(spec);
  assert.equal(said.length, 1);
  assert.match(said[0]!, /person\.owner and person\.referrer both put staff on org/);
  const w = world();
  const out = await w.k.hs["sync_specs.validate"](w.ctx, { spec });
  assert.equal(out.ok, false);
  assert.match(JSON.stringify(out), /both put staff on org/);
});

test("a spec that gives an unusable far-end name is refused by shape", () => {
  const raw = JSON.parse(JSON.stringify(ledgerSpec())) as Record<string, any>;
  raw["objects"][1].fields.find((f: any) => f.type === "relation").inverseKey = "Bad Name";
  assert.match(
    parseSpec(raw)
      .problems.map((p) => p.message)
      .join(" "),
    /inverseKey/,
  );
});

// ---- a link: join rows that relate two synced types

/** The ledger spec plus a join object (who belongs to which organization, and as what) that also relates a person to an organization many to many. */
function withLink(change: (m: Record<string, any>) => void = () => undefined): Record<string, unknown> {
  const raw = JSON.parse(JSON.stringify(ledgerSpec())) as Record<string, any>;
  raw["objects"].push({
    remote: "memberships",
    label: "Membership",
    id: "/id",
    itemsAt: "/data",
    list: { path: "/api/v2/memberships" },
    fields: [
      { path: "/person", label: "Person", type: "text" },
      { path: "/org", label: "Organization", type: "text" },
      { path: "/kind", label: "Kind", type: "text" },
    ],
  });
  const mapping: Record<string, any> = {
    remote: "memberships",
    recordType: "membership",
    title: "Membership",
    fields: [{ path: "/kind", field: "kind", direction: "pull" }],
    link: {
      from: { recordType: "org", at: "/org" },
      to: { recordType: "person", at: "/person" },
      key: "members",
      title: "Members",
      inverseKey: "member_of",
      inverseTitle: "Member of",
    },
  };
  change(mapping);
  raw["mapping"].push(mapping);
  return raw;
}

test("a link compiles to a relation on the from type, the pointers in the shape, and the link on the connector's object", () => {
  const spec = parseSpec(withLink()).spec!;
  const compiled = compileSpec(spec);
  const join = compiled.types.find((t) => t.recordType === "membership")!;
  assert.deepEqual(join.relations, [
    { field: "members", title: "Members", to: "person", inverse: "member_of", inverseTitle: "Member of", on: "org" },
  ]);
  assert.deepEqual(join.link, {
    from: { type: "org", at: "/org" },
    to: { type: "person", at: "/person" },
    key: "members",
    inverseKey: "member_of",
  });
  assert.deepEqual(compiled.connector.objects!["memberships"]!.link, join.link);
  const list = compiled.connector.actions.find((a) => a.name === "list_memberships")!;
  assert.deepEqual((list.shape as { fields: string[] }).fields.sort(), ["/kind", "/org", "/person"]);
  // a spec without a link compiles as before: no link, no `on`
  const plain = JSON.stringify(compileSpec(parseSpec(ledgerSpec()).spec!));
  assert.equal(plain.includes('"link"') || plain.includes('"on"'), false);
});

test("validate proves a link against a real page and says what is wrong in plain words", async () => {
  const w = world();
  const ok = await w.k.hs["sync_specs.validate"](w.ctx, { spec: withLink() });
  assert.deepEqual(
    ok.problems.filter((p: { level: string }) => p.level === "error"),
    [],
  );
  const unmapped = await w.k.hs["sync_specs.validate"](w.ctx, {
    spec: withLink((m) => {
      m["link"]["to"]["recordType"] = "nobody";
    }),
  });
  assert.match(JSON.stringify(unmapped.problems), /nobody is not a record type this spec brings in/);
  const missing = await w.k.hs["sync_specs.validate"](w.ctx, {
    spec: withLink((m) => {
      m["link"]["from"]["at"] = "/nowhere";
    }),
  });
  assert.match(JSON.stringify(missing.problems), /\/nowhere is not described/);
  const bare = await w.k.hs["sync_specs.validate"](w.ctx, {
    spec: withLink((m) => {
      m["fields"] = [];
    }),
  });
  assert.match(JSON.stringify(bare.problems), /needs at least one mapped field/);
});

test("apply makes the many-to-many once, and a second apply makes nothing new", async () => {
  const w = world();
  await w.k.hs["sync_specs.apply"](w.ctx, { spec: withLink(), idempotencyKey: "l1" });
  const rel = w.calls
    .filter((c) => c.cap === "schema.apply")
    .flatMap((c) => c.input.ops)
    .filter((o: any) => o.op === "relation.add" && o.field === "members");
  assert.deepEqual(rel, [
    {
      op: "relation.add",
      type: "org",
      field: "members",
      def: { to: "person", inverse: "member_of", title: "Members", inverseTitle: "Member of" },
    },
  ]);
  const row = w.k.tx.get<{ def: string }>("SELECT def FROM cn_connectors WHERE key = 'crm_ledger'")!;
  assert.equal(JSON.parse(row.def).objects.memberships.link.key, "members");
  const before = w.calls.filter((c) => c.cap === "schema.apply").length;
  await w.k.hs["sync_specs.apply"](w.ctx, { spec: withLink(), idempotencyKey: "l2" });
  const after = w.calls
    .filter((c) => c.cap === "schema.apply")
    .slice(before)
    .flatMap((c) => c.input.ops)
    .filter((o: any) => o.field === "members");
  assert.deepEqual(after, [], "a re-apply makes no relation twice");
});

test("sweepEveryDays is a whole number of days from 1 to 30 and becomes the type's sweepSec", async () => {
  const bad = (n: unknown) => {
    const raw = JSON.parse(JSON.stringify(ledgerSpec())) as Record<string, any>;
    raw["objects"][1].list.sweepEveryDays = n;
    return parseSpec(raw);
  };
  assert.match(bad(0).problems.map((p) => p.message).join(" "), /sweepEveryDays/);
  assert.match(bad(31).problems.map((p) => p.message).join(" "), /sweepEveryDays/);
  assert.match(bad(1.5).problems.map((p) => p.message).join(" "), /sweepEveryDays/);
  assert.ok(bad(7).spec);
  const raw = JSON.parse(JSON.stringify(ledgerSpec())) as Record<string, any>;
  raw["objects"][1].list.sweepEveryDays = 7;
  const w = world();
  await w.k.hs["sync_specs.apply"](w.ctx, { spec: raw, idempotencyKey: "s1" });
  const polling = (type: string) =>
    JSON.parse(w.k.tx.get<{ polling: string }>("SELECT polling FROM cn_synced_types WHERE type = ?", type)!.polling);
  assert.equal(polling("person").sweepSec, 7 * 86_400, "a large table is swept weekly");
  assert.equal(polling("org").sweepSec, undefined, "a core one keeps the daily sweep");
});
