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
