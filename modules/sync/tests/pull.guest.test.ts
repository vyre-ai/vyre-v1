// Ruling 68, 69: a person whose only grant is on some records (no Space-wide view, no role that reads) pulls exactly those rows, and what is not theirs never appears. The gate for reaching sync.pull at all is
// level 'member' (host/tests/invoke.member-level.test.ts); this proves the handler narrows by per-resource view once the call is in.
// @reads /modules/sync/migrations/0001_pull.sql
import test from "node:test";
import assert from "node:assert/strict";
import { mintRecordId } from "../../../lib/ids.ts";
import { AccessSnapshot } from "../../../kernel/src/authorize/snapshot.ts";
import { openSync } from "../impl.ts";
import { ADA, CONTACT_TYPE, NOW } from "../fixtures/world.ts";

const TESS = "usr_tess";
const TRACE = "0123456789abcdef0123456789abcdef";

function world(): AccessSnapshot {
  const snap = new AccessSnapshot();
  snap.putRole({ id: "owner", clearance: 3, perms: ["records.read"], name: "Owner" });
  snap.putRole({ id: "temp", clearance: 0, perms: [], name: "Temp" });
  for (const id of [ADA, TESS]) snap.putPrincipal({ id, kind: "person", status: "active", name: id });
  snap.addPrincipalRole({ holder: ADA, role: "owner" });
  snap.addPrincipalRole({ holder: TESS, role: "temp" });
  for (const type of ["record", "space"]) snap.putGrant({ id: `gr_ada_${type}`, subject_kind: "actor", subject_id: ADA, resource_type: type, resource_id: null, level: "manage" });
  // Tess: records of one region only. Nothing on the Space.
  snap.putGrant({ id: "gr_tess_record", subject_kind: "actor", subject_id: TESS, resource_type: "record", resource_id: null, level: "view", conditions: { rowFilter: { op: "eq", field: "region", value: "eu" } } });
  return snap;
}

test("a person with a grant on some records and nothing on the Space pulls those records and no others; the owner pulls all", async () => {
  const access = world();
  const s = openSync({ access: () => access, clock: () => NOW });
  await s.store.define({ add_types: [CONTACT_TYPE] });
  const make = async (region: string): Promise<string> => { const id = mintRecordId(); await s.store.create("contact", id, { name: `N ${region}`, email: "n@example.com", phone: "+1", region, stage: "lead", owner: ADA }); return id; };
  const eu = await make("eu"), us = await make("us");
  const pull = (person: string) => s.handlers["sync.pull"]({ trace: { traceId: TRACE }, principal: person, deviceId: "dev1", deviceClass: "desktop" }, { cursor: 0, epoch: 0 });
  const tess = await pull(TESS);
  assert.deepEqual(tess.changes.map((c) => c.id), [eu], "only the record her grant reaches");
  assert.ok(!JSON.stringify(tess).includes(us));
  const ada = await pull(ADA);
  assert.deepEqual(ada.changes.map((c) => c.id).sort(), [eu, us].sort(), "the owner still sees everything");
});
