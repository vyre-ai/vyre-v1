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
