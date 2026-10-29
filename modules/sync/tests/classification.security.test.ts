// @reads /modules/sync/migrations/0001_pull.sql
// The Space's own schema classifies its record types' fields (typed field `sensitivity`). Sync must use that classification at the one boundary pull, snapshot and live share: a Restricted field never
// reaches a laptop (even the Owner's), a Confidential one only a person cleared for it, and a classification it cannot read counts as Restricted.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot } from "../../../kernel/src/authorize/snapshot.ts";
import { mintRecordId } from "../../../lib/ids.ts";
import { LABEL_RANKS, DEVICE_CEILING, classifiedCatalog, loadCatalog } from "../../../sync/src/server/pull/index.ts";
import type { TypeDef } from "../../../kernel/src/store/types.ts";
import { openSync } from "../impl.ts";

const OWNER = "usr_classowner", GUEST = "usr_classguest", TRACE = "11".repeat(16);
const SECRET = { tax: "restricted-fixture-value", salary: "confidential-fixture-value", internalMemo: "hidden-fixture-value" };

function access(): AccessSnapshot {
  const a = new AccessSnapshot();
  a.putRole({ id: "classowner", name: "Owner", clearance: 3, perms: ["records.read"] });
  a.putRole({ id: "classguest", name: "Guest", clearance: 1, perms: [] });
  for (const [id, role] of [[OWNER, "classowner"], [GUEST, "classguest"]] as const) {
    a.putPrincipal({ id, kind: "person", status: "active" });
    a.addPrincipalRole({ holder: id, role });
  }
  a.putGrant({ id: "class_owner", subject_kind: "actor", subject_id: OWNER, resource_type: "record", resource_id: null, level: "manage" });
  a.putGrant({ id: "class_guest", subject_kind: "actor", subject_id: GUEST, resource_type: "record", resource_id: null, level: "view", conditions: { rowFilter: { op: "eq", field: "region", value: "eu" }, hiddenFields: ["internalMemo"] } });
  return a;
}
const ctx = (principal: string, deviceId = "class-device") => ({ trace: { traceId: TRACE }, principal, deviceId, deviceClass: "desktop" as const });
const TYPE = { name: "classrecord", fields: [
  { name: "name", kind: "text" }, { name: "region", kind: "text" },
  { name: "tax", kind: "text", label: "Tax identifier", sensitivity: "restricted" },
  { name: "salary", kind: "text", sensitivity: "confidential" },
  { name: "internalMemo", kind: "text" },
] };

test("canonical typed Schema sensitivity filters snapshot and pull independently of Owner clearance", async () => {
  const a = access(), s = openSync({ access: () => a });
  try {
    await s.store.define({ add_types: [TYPE] });
    const eu = mintRecordId(), us = mintRecordId();
    for (const [id, region] of [[eu, "eu"], [us, "us"]] as const) await s.store.create("classrecord", id!, { name: region, region, ...SECRET });
    const owner = JSON.stringify(await s.handlers["sync.pull"](ctx(OWNER), { cursor: 0, epoch: 0 }));
    assert.ok(!owner.includes(SECRET.tax), "Restricted never mirrors to laptops, even to the Owner");
    assert.ok(owner.includes(SECRET.salary), "the Owner is cleared for Confidential");
    const guest = await s.handlers["sync.pull"](ctx(GUEST), { cursor: 0, epoch: 0 });
    assert.deepEqual(guest.changes.map((row) => row.id), [eu]);
    for (const value of Object.values(SECRET)) assert.ok(!JSON.stringify(guest).includes(value), value);
    const begin = await s.handlers["sync.snapshot.begin"](ctx(GUEST, "snapshot-device"), { deviceClass: "desktop" });
    const snapshot = await s.handlers["sync.snapshot.page"](ctx(GUEST, "snapshot-device"), { entity: "classrecord", asOf: begin.asOfSeq });
    assert.deepEqual(snapshot.rows.map((row) => row.id), [eu]);
    for (const value of Object.values(SECRET)) assert.ok(!JSON.stringify(snapshot).includes(value), value);
  } finally { s.host.close(); }
});

test("an unreadable classification counts as Restricted, and the overlay never lowers a generated label", () => {
  const base = loadCatalog();
  const type = (sensitivity: unknown): TypeDef => ({ name: "overlaid", fields: [{ name: "f", kind: "text", sensitivity }, { name: "g", kind: "text" }] });
  const rank = (sensitivity: unknown): number | undefined => classifiedCatalog(base, () => [type(sensitivity)]).get("overlaid").fieldLabels["f"];
  assert.equal(rank("confidential"), LABEL_RANKS.confidential);
  assert.equal(rank("secretish"), LABEL_RANKS.restricted, "an unknown label name fails closed");
  assert.equal(rank(7), LABEL_RANKS.restricted, "a value that is not a label fails closed");
  assert.equal(rank("toString"), LABEL_RANKS.restricted, "an inherited property name is not a label");
  assert.equal(classifiedCatalog(base, () => [type("confidential")]).get("overlaid").fieldLabels["g"], undefined, "an unclassified field stays unlabelled");
  const generated = base.known().find((e) => Object.keys(e.fieldLabels).length > 0);
  if (generated) {
    const [field, was] = Object.entries(generated.fieldLabels)[0]!;
    const low: TypeDef = { name: generated.key, fields: [{ name: field, kind: "text", sensitivity: "public" }] };
    assert.equal(classifiedCatalog(base, () => [low]).get(generated.key).fieldLabels[field], was, "a typed public label cannot lower the generated one");
  }
});

test("Restricted, the label Access keeps off laptops (access.labels.list: syncToLaptop false), is above every device ceiling", () => {
  for (const cls of ["desktop", "web", "phone"] as const) assert.ok(DEVICE_CEILING[cls] < LABEL_RANKS.restricted, `${cls} ceiling ${DEVICE_CEILING[cls]} is below Restricted`);
  assert.ok(DEVICE_CEILING.desktop >= LABEL_RANKS.confidential, "Confidential may travel to a laptop for a person cleared for it");
});

// ---- a classification raised after a device cached the field ----
// A patch omits a field, it never removes one, so a device that already holds `salary` keeps it unless it is told to start over.

const EMPLOYEE = { name: "employee", fields: [{ name: "name", kind: "text" }, { name: "salary", kind: "text", sensitivity: "internal" }, { name: "note", kind: "text" }] };
const RAISED = { ...EMPLOYEE, fields: EMPLOYEE.fields.map((f) => (f.name === "salary" ? { ...f, sensitivity: "restricted" } : f)) };
const open = (a: AccessSnapshot) => openSync({ access: () => a });
type Sync = ReturnType<typeof open>;
const pull = async (s: Sync, who: string, device: string, cursor: number, epoch: number) => s.handlers["sync.pull"](ctx(who, device), { cursor, epoch });

async function seeded(): Promise<{ s: Sync; id: string }> {
  const s = open(access());
  await s.store.define({ add_types: [EMPLOYEE] });
  const id = mintRecordId()!;
  await s.store.create("employee", id, { name: "Ada", salary: "salary-fixture-value", note: "note-fixture-value" });
  return { s, id };
}

test("raising a field's classification after a device cached it makes that device start over, and the new copy never carries the field", async () => {
  const { s, id } = await seeded();
  try {
    const first = await pull(s, OWNER, "laptop", 0, 0);
    assert.ok(JSON.stringify(first).includes("salary-fixture-value"), "while the field is Internal the device holds it");
    assert.equal((await pull(s, OWNER, "laptop", first.next, first.epoch)).reset, undefined, "an unchanged classification leaves the device alone");

    await s.store.define({ change_types: [RAISED] });
    const stale = await pull(s, OWNER, "laptop", first.next, first.epoch);
    assert.equal(stale.reset, "purge", "the device cached a field it may no longer hold, so it must purge");
    assert.deepEqual([stale.changes, stale.hide], [[], []], "no data goes back with a purge");
    assert.ok(stale.epoch > first.epoch, "the epoch rose, so the old copy cannot be presented again");
    assert.equal((await pull(s, OWNER, "laptop", first.next, first.epoch)).reset, "purge", "a replay of the stale pull is refused again");

    const again = await pull(s, OWNER, "laptop", 0, stale.epoch);
    assert.equal(again.reset, undefined);
    assert.ok(again.changes.some((c) => c.id === id), "the row comes back");
    assert.ok(!JSON.stringify(again).includes("salary-fixture-value"), "without the field that is now Restricted");
    assert.ok(JSON.stringify(again).includes("note-fixture-value"), "and with the fields that are still allowed");
    assert.equal((await pull(s, OWNER, "laptop", again.next, again.epoch)).reset, undefined, "the fresh copy is not purged again");
  } finally { s.host.close(); }
});

test("the purge is the person's: a second device of the same person also starts over, cleanly, and the new copies never carry the field", async () => {
  const { s } = await seeded();
  try {
    const laptop = await pull(s, OWNER, "laptop", 0, 0);
    const tablet = await pull(s, OWNER, "tablet", 0, 0);
    await s.store.define({ change_types: [RAISED] });
    assert.equal((await pull(s, OWNER, "laptop", laptop.next, laptop.epoch)).reset, "purge");
    const next = (await pull(s, OWNER, "tablet", tablet.next, tablet.epoch));
    assert.equal(next.reset, "purge", "the tablet cached the field too");
    for (const device of ["laptop", "tablet"]) {
      const fresh = await pull(s, OWNER, device, 0, next.epoch);
      assert.equal(fresh.reset, undefined, `${device} resyncs without a second purge`);
      assert.ok(!JSON.stringify(fresh).includes("salary-fixture-value"));
      assert.equal((await pull(s, OWNER, device, fresh.next, fresh.epoch)).reset, undefined);
    }
  } finally { s.host.close(); }
});

test("a classification raise purges only people who cached the field; a device that never held the type is untouched", async () => {
  const { s } = await seeded();
  try {
    const owner = await pull(s, OWNER, "laptop", 0, 0);
    const guest = await pull(s, GUEST, "guest-laptop", 0, 0);
    assert.deepEqual(guest.changes, [], "the Guest's grant gives the Guest no employee rows");
    await s.store.define({ change_types: [RAISED] });
    assert.equal((await pull(s, GUEST, "guest-laptop", guest.next, guest.epoch)).reset, undefined, "the Guest cached nothing of it");
    assert.equal((await pull(s, OWNER, "laptop", owner.next, owner.epoch)).reset, "purge");
  } finally { s.host.close(); }
});

test("a replica from before the guard existed, with no record of what it may hold, is purged once and then tracked", async () => {
  const { s } = await seeded();
  try {
    const first = await pull(s, OWNER, "old-laptop", 0, 0);
    await s.store.define({ change_types: [RAISED] });
    s.host.tx.run("DELETE FROM sync_class_sig WHERE person = ? AND device = ?", OWNER, "old-laptop");
    const old = await pull(s, OWNER, "old-laptop", first.next, first.epoch);
    assert.equal(old.reset, "purge", "no record and a held field that is held back: it cannot be vouched for");
    const fresh = await pull(s, OWNER, "old-laptop", 0, old.epoch);
    assert.equal(fresh.reset, undefined);
    assert.equal((await pull(s, OWNER, "old-laptop", fresh.next, fresh.epoch)).reset, undefined);
  } finally { s.host.close(); }
});

test("a snapshot taken after the raise has no trace of the field, and a lowered classification does not purge", async () => {
  const { s } = await seeded();
  try {
    await s.store.define({ change_types: [RAISED] });
    const begin = await s.handlers["sync.snapshot.begin"](ctx(OWNER, "snap"), { deviceClass: "desktop" });
    const page = await s.handlers["sync.snapshot.page"](ctx(OWNER, "snap"), { entity: "employee", asOf: begin.asOfSeq });
    assert.equal(page.rows.length, 1);
    assert.ok(!JSON.stringify(page).includes("salary-fixture-value"));
    const head = await pull(s, OWNER, "snap", begin.asOfSeq, 0);
    assert.equal(head.reset, undefined, "the snapshot recorded what the device may hold");
    await s.store.define({ change_types: [EMPLOYEE] });
    assert.equal((await pull(s, OWNER, "snap", head.next, head.epoch)).reset, undefined, "lowering a label removes nothing the device holds");
  } finally { s.host.close(); }
});

test("a grant on a record's type or ancestor that hides a field removes it from the person's rows, and a device that cached the field before the grant narrowed is purged", async () => {
  const a = access();
  a.putResource({ id: "rt_hubtype", type: "record_type", parent_id: null, owner_id: null, label: 0 } as never);
  const s = open(a);
  try {
    await s.store.define({ add_types: [EMPLOYEE] });
    const id = mintRecordId()!;
    await s.store.create("employee", id, { name: "Ada", salary: "salary-fixture-value", note: "note-fixture-value" });
    // the Guest reaches the row through a grant on an ancestor that hides `note`
    a.putResource({ id, type: "record", parent_id: "rt_hubtype", owner_id: OWNER, label: 0 } as never);
    a.putGrant({ id: "anc_guest", subject_kind: "actor", subject_id: GUEST, resource_type: "record_type", resource_id: "rt_hubtype", level: "view", conditions: { hiddenFields: ["note"] } });
    const first = await pull(s, GUEST, "guest-laptop", 0, 0);
    const text = JSON.stringify(first);
    assert.ok(text.includes("Ada"), "the Guest reaches the row through its ancestor");
    assert.ok(!text.includes("note-fixture-value"), "the field the ancestor grant hides is not sent");
    assert.ok(text.includes("salary-fixture-value"), "a field no grant hides is sent");
    // narrowing: a second field is hidden after the device already holds it
    a.putGrant({ id: "anc_guest", subject_kind: "actor", subject_id: GUEST, resource_type: "record_type", resource_id: "rt_hubtype", level: "view", conditions: { hiddenFields: ["note", "salary"] } });
    const stale = await pull(s, GUEST, "guest-laptop", first.next, first.epoch);
    assert.equal(stale.reset, "purge", "the device cached salary, which is now hidden from it");
    const fresh = JSON.stringify(await pull(s, GUEST, "guest-laptop", 0, stale.epoch));
    assert.ok(!fresh.includes("salary-fixture-value") && !fresh.includes("note-fixture-value") && fresh.includes("Ada"), "the new copy has the row without either hidden field");
  } finally { s.host.close(); }
});
