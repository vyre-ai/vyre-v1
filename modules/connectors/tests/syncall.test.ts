// The pieces of one app together: a join object with a `link`, three conditional (onlyWhen) relations that share one pointer, a sealed field and a title made of two fields.
// The spec is applied, then pulled through the sync engine over a real Space store: records appear, each relation lands on the one right record, the join rows relate their two records,
// the sealed value is only in the Vault, and the pass asks the app once per object.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ledgerSpec } from "../fixtures/crm.ts";
import { world } from "../fixtures/crm-world.ts";
import { compileSpec, parseSpec } from "../syncspec.ts";
import type { CompiledType, SyncSpec } from "../syncspec.ts";
import { CODE_ROOT } from "../../../host/src/daemon/daemon.ts";
import { fileExportsImporter } from "../../../host/src/loader.ts";
import { createSpaceStore } from "../../../host/src/daemon/store.ts";
import { coreOf, createSyncEngine } from "../../../host/src/daemon/syncengine.ts";
import type { BindingRow, EngineCtx } from "../../../host/src/daemon/syncengine.ts";

const SSN = "123-45-6789";

function allInOne(): Record<string, any> {
  const s = JSON.parse(JSON.stringify(ledgerSpec())) as Record<string, any>;
  const people = s["objects"][1];
  people["fields"] = people["fields"].filter((f: any) => f.path !== "/org_id");
  for (const [key, kind] of [
    ["matter_of", "prospect"],
    ["contact_of", "contact"],
    ["company_of", ["company", " Org "]],
  ] as const)
    people["fields"].push({
      path: "/org_id",
      key,
      label: key,
      type: "relation",
      relationTo: "organizations",
      onlyWhen: { path: "/kind", equals: kind },
    });
  people["fields"].push({ path: "/kind", label: "Kind", type: "text" });
  people["fields"].push({ path: "/ssn", label: "SSN", type: "sealed" });
  s["objects"].push({
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
  const m = s["mapping"][1];
  m["fields"] = m["fields"].filter((f: any) => f.path !== "/org_id");
  for (const key of ["matter_of", "contact_of", "company_of"])
    m["fields"].push({ path: "/org_id", field: key, direction: "pull" });
  m["fields"].push({ path: "/kind", field: "kind", direction: "pull" });
  m["fields"].push({ path: "/ssn", field: "ssn", direction: "pull" });
  m["titleField"] = ["/attributes/full_name", "/kind"];
  s["mapping"].push({
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
  });
  return s;
}

test("link, three conditional relations, a sealed field and a list title: applied and pulled together", async () => {
  const raw = allInOne();
  // applied
  const w = world();
  const applied = await w.k.hs["sync_specs.apply"](w.ctx, { spec: raw, idempotencyKey: "all1" }).catch((e) => {
    throw new Error(JSON.stringify(e.error?.details?.cases?.filter((c: any) => !c.ok)));
  });
  assert.equal(applied.connector, "crm_ledger");
  const spec = parseSpec(raw).spec as SyncSpec;
  const compiled = compileSpec(spec);
  const typeOf = (t: string): CompiledType => compiled.types.find((x) => x.recordType === t)!;
  const person = typeOf("person");
  const inverses = person.relations.map((r) => r.inverse);
  assert.equal(new Set(inverses).size, inverses.length, "no two far ends share a name");
  assert.equal(person.relations.length, 3);

  // a Space store holding what apply made
  const core = coreOf(await fileExportsImporter(CODE_ROOT)("sources"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-syncall-"));
  const space = createSpaceStore({ path: path.join(dir, "space.db"), space: "sp_all" });
  const { store, tx } = space.open();
  const fieldsOf = new Map<string, { name: string; kind: string; label: string; to?: string; many?: boolean }[]>();
  for (const t of compiled.types)
    fieldsOf.set(
      t.recordType,
      t.defs.map((d) => ({ name: d.key, kind: d.type === "sealed" ? "sealed" : "text", label: d.title })),
    );
  for (const t of compiled.types)
    for (const r of t.relations) {
      const near = r.on ?? t.recordType;
      fieldsOf.get(near)!.push({ name: r.field, kind: "link", label: r.title, to: r.to, many: true });
      fieldsOf.get(r.to)!.push({ name: r.inverse, kind: "link", label: r.inverseTitle, to: near, many: true });
    }
  await store.define({
    add_types: [...fieldsOf].map(([name, fields]) => ({ name, label: name, fields })),
  } as never);

  // the app
  const rows: Record<string, { id: string; at: number; properties: Record<string, unknown> }[]> = {
    organizations: [
      { id: "o1", at: 1, properties: { "/name": "Northwind" } },
      { id: "o2", at: 1, properties: { "/name": "Fabrikam" } },
    ],
    people: [
      {
        id: "7",
        at: 1,
        properties: {
          "/attributes/full_name": "Imran Ibarra",
          "/kind": "prospect",
          "/org_id": "o1",
          "/ssn": SSN,
        },
      },
      {
        id: "8",
        at: 1,
        properties: { "/attributes/full_name": "Andrea Lindahl", "/kind": "company", "/org_id": "o2", "/ssn": "" },
      },
    ],
    memberships: [
      { id: "mb1", at: 1, properties: { "/org": "o1", "/person": "7", "/kind": "owner" } },
      { id: "mb2", at: 1, properties: { "/org": "o2", "/person": "8", "/kind": "member" } },
      { id: "mb3", at: 1, properties: { "/org": "o1", "/person": "8", "/kind": "advisor" } },
    ],
  };
  const typeIds = new Map(compiled.types.map((t) => [t.recordType, `syt_${t.recordType}`]));
  const vault = new Map<string, string>();
  const reads: string[] = [];
  const ctx: EngineCtx = {
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    emit: () => ({}),
    call: async (cap, input) => {
      if (cap === "connectors.get") return { connector: { key: "crm_ledger", objects: compiled.connector.objects } };
      if (cap === "sync_types.get") {
        const id = typeIds.get((input as { type: string }).type);
        return id ? { syncedType: { syncTypeId: id } } : {};
      }
      if (cap === "records.update") {
        const i = input as { type: string; recordId: string; patch: Record<string, unknown> };
        const cur = (await store.get(i.type, i.recordId))!;
        const patch: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(i.patch)) {
          if (v && typeof v === "object" && (v as { sealed?: unknown }).sealed === true) {
            const ref = (cur.data[k] as { ref?: string } | undefined)?.ref ?? `ref_${vault.size + 1}`;
            vault.set(ref, (v as { value: string }).value);
            patch[k] = { sealed: k, ref, present: true, set_at: Date.now() };
          } else patch[k] = v;
        }
        await store.update(i.type, i.recordId, patch, cur.version);
        return { record: { id: i.recordId } };
      }
      assert.ok(cap === "connectors.read" || cap === "connectors.run", cap);
      const action = (input as { action: string }).action;
      reads.push(action);
      const remote = Object.entries(compiled.connector.objects!).find(([, n]) => n.list === action)![0];
      return {
        output: { results: rows[remote]!.map((r) => ({ id: r.id, updatedAt: r.at, properties: r.properties })) },
      };
    },
  };
  const bind = (t: CompiledType): BindingRow => ({
    syncTypeId: typeIds.get(t.recordType)!,
    type: t.recordType,
    connector: "crm_ledger",
    connectionId: "con_1",
    remote: t.remote,
    fields: t.fields.map((f) => ({
      key: f.key,
      remote: f.remote,
      dir: f.dir,
      ...(f.relation ? { relation: spec.mapping.find((x) => x.remote === f.relation)!.recordType } : {}),
      ...(f.inverse ? { inverse: f.inverse } : {}),
      ...(f.sealed ? { sealed: true } : {}),
      ...(f.constant !== undefined ? { constant: f.constant } : {}),
    })),
    match: [],
    createAtSource: false,
    deletes: "off",
    conflict: "newest",
  });
  const engine = createSyncEngine({ core, local: { open: () => ({ store, tx }), space: "sp_all" } });
  const pass = async (): Promise<void> => {
    for (const t of ["org", "person", "membership"]) await engine.run(ctx, bind(typeOf(t)), { mode: "incremental" });
  };
  await pass();

  const all = async (type: string) => (await store.query(type, { page: { limit: 50 } })).rows;
  const orgs = await all("org"),
    people = await all("person");
  const org = (n: string) => orgs.find((o) => o.data["name"] === n)!;
  const imran = people.find((p) => String(p.data[person.titleField]).startsWith("Imran"))!;
  const andrea = people.find((p) => String(p.data[person.titleField]).startsWith("Andrea"))!;
  const urns = (r: { data: Record<string, unknown> }, f: string): string[] =>
    ((r.data[f] as { urn: string }[] | undefined) ?? []).map((u) => u.urn);
  const u = (type: string, id: string) => `vyre://sp_all/${type}/${id}`;

  // a title made of two fields
  assert.equal(imran.data[person.titleField], "Imran Ibarra prospect");
  // three conditional relations on one pointer: each row reaches only the one right field
  assert.deepEqual(urns(imran, "matter_of"), [u("org", org("Northwind").id)]);
  assert.deepEqual(urns(imran, "contact_of"), []);
  assert.deepEqual(urns(andrea, "company_of"), [u("org", org("Fabrikam").id)]);
  assert.deepEqual(urns(andrea, "matter_of"), []);
  // the join rows relate their records at both ends, many to many (Andrea is in two organizations)
  assert.deepEqual(urns(org("Northwind"), "members").sort(), [u("person", imran.id), u("person", andrea.id)].sort());
  assert.deepEqual(
    urns(andrea, "member_of").sort(),
    [u("org", org("Northwind").id), u("org", org("Fabrikam").id)].sort(),
  );
  assert.equal((await all("membership")).length, 3, "each join row is still a record of its own");
  // sealed: in the Vault, in no table
  assert.deepEqual([...vault.values()], [SSN]);
  const everywhere = tx
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .map((t) => JSON.stringify(tx.all(`SELECT * FROM "${t.name}"`)))
    .join("\n");
  assert.ok(!everywhere.includes(SSN));
  // the app was asked once per object: the link and the seal made no call of their own
  assert.deepEqual([...reads].sort(), ["list_memberships", "list_organizations", "list_people"]);

  // a second pass changes nothing
  const before = JSON.stringify(await all("org")) + JSON.stringify(await all("person"));
  await pass();
  assert.equal(JSON.stringify(await all("org")) + JSON.stringify(await all("person")), before);
});
