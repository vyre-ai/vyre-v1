// The field rule of records.get, asked for one record by the readers that show what a record's events carried (the event log, an Automation's trigger): fieldGate. It is the same rule: a field the grant
// hides is not in it, and neither is a field above the label ceiling of the AI provider the answer goes to (24 Nov 2026). Labels of a type are read once per call when the caller keeps them.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot } from "../../kernel/src/authorize/index.ts";
import type { Store, StoredRecord } from "../../kernel/src/store/types.ts";
import { createRecordAccess } from "../src/daemon/record-access.ts";

function fixture() {
  const snapshot = new AccessSnapshot();
  snapshot.putPrincipal({ id: "reader", kind: "person", status: "active" });
  snapshot.putRole({ id: "role", clearance: 3, perms: [] });
  snapshot.addPrincipalRole({ holder: "reader", role: "role" });
  snapshot.putResource({ id: "type", type: "record_type", parent_id: null, label: 0, owner_id: null, holds: 0 });
  snapshot.putResource({ id: "row", type: "record", parent_id: "type", label: 0, owner_id: null, holds: 0 });
  snapshot.putGrant({
    id: "grant",
    subject_kind: "actor",
    subject_id: "reader",
    resource_type: "record_type",
    resource_id: "type",
    level: "view",
    conditions: { hiddenFields: ["secret"] },
  });
  const row: StoredRecord = {
    id: "row",
    type: "type",
    version: 1,
    data: { name: "Visible", notes: "Confidential note", secret: "Hidden" },
    created_at: 1,
    updated_at: 1,
  };
  let typeReads = 0;
  const store = {
    types: async () => {
      typeReads++;
      return [
        {
          name: "type",
          fields: [
            { name: "name", kind: "text" },
            { name: "notes", kind: "text", sensitivity: "confidential" },
            { name: "secret", kind: "text" },
          ],
        },
      ];
    },
    get: async () => row,
  } as unknown as Store;
  const guard = createRecordAccess({ store: () => store, snapshot: () => snapshot, now: () => 1, fresh: () => true });
  return { snapshot, guard, reads: () => typeReads };
}

test("fieldGate: a field the grant hides is not visible, the others are, and a record the reader may not see has no gate", async () => {
  const f = fixture();
  const gate = await f.guard.fieldGate({ principal: "reader" }, "type", "row", "t");
  assert.ok(gate);
  assert.equal(gate!("name"), true);
  assert.equal(gate!("notes"), true);
  assert.equal(gate!("secret"), false, "the grant hides it");
  assert.equal(gate!("not_a_field"), false, "a field the type does not label is not shown");
  assert.equal(await f.guard.fieldGate({ principal: "stranger" }, "type", "row", "t"), null);
});

test("fieldGate: the label ceiling of the provider the answer goes to applies, as it does to records.get", async () => {
  const f = fixture();
  f.snapshot.setPolicies([{ key: "p1", kind: "provider_label", allow: { cloud: 1 } }]);
  const plain = await f.guard.fieldGate({ principal: "reader" }, "type", "row", "t");
  assert.equal(plain!("notes"), true, "to the person themselves a confidential field is theirs");
  const cloud = await f.guard.fieldGate({ principal: "reader", provider: "cloud" }, "type", "row", "t");
  assert.equal(cloud!("name"), true);
  assert.equal(cloud!("notes"), false, "a confidential field does not go to a provider cleared for internal");
});

test("fieldGate: the labels of a type are read once for a call that keeps them", async () => {
  const f = fixture();
  const kept = new Map<string, Readonly<Record<string, number>>>();
  for (let i = 0; i < 5; i++) await f.guard.fieldGate({ principal: "reader" }, "type", "row", "t", kept);
  assert.equal(f.reads(), 1, "one read of the schema for five records of one type");
  await f.guard.fieldGate({ principal: "reader" }, "type", "row", "t");
  assert.equal(f.reads(), 2, "without the cache each call reads it");
});

// ---- a record the access snapshot does not know yet, and a trashed one

function lateFixture(learnsAfter: number) {
  const snapshot = new AccessSnapshot();
  snapshot.putPrincipal({ id: "reader", kind: "person", status: "active" });
  snapshot.putRole({ id: "role", clearance: 3, perms: [] });
  snapshot.addPrincipalRole({ holder: "reader", role: "role" });
  snapshot.putResource({ id: "type", type: "record_type", parent_id: null, label: 0, owner_id: null, holds: 0 });
  snapshot.putGrant({
    id: "grant",
    subject_kind: "actor",
    subject_id: "reader",
    resource_type: "record_type",
    resource_id: "type",
    level: "view",
    conditions: { hiddenFields: ["secret"] },
  });
  let refreshes = 0;
  const trashed = { on: false };
  const row = { id: "row", type: "type", version: 1, data: { name: "N", secret: "S" }, created_at: 1, updated_at: 1 };
  const store = {
    types: async () => [
      {
        name: "type",
        fields: [
          { name: "name", kind: "text" },
          { name: "secret", kind: "text" },
        ],
      },
    ],
    get: async (_t: string, _i: string, opts?: { include_deleted?: boolean }) =>
      trashed.on && opts?.include_deleted !== true ? null : row,
  } as unknown as Store;
  const guard = createRecordAccess({
    store: () => store,
    snapshot: () => snapshot,
    now: () => 1,
    fresh: () => true,
    settleMs: [0, 0],
    refresh: async () => {
      refreshes++;
      // the access entry of the record is folded a moment after the store has the record
      if (refreshes >= learnsAfter)
        snapshot.putResource({ id: "row", type: "record", parent_id: "type", label: 0, owner_id: null, holds: 0 });
    },
  });
  return { guard, trashed, refreshes: () => refreshes, snapshot };
}

test("fieldGate: a record the snapshot learns a moment late is waited for and judged; one it never learns is 'later', not 'not visible'", async () => {
  const late = lateFixture(2);
  const gate = await late.guard.fieldGate({ principal: "reader" }, "type", "row", "t");
  assert.equal(typeof gate, "function", "after the wait the record is judged");
  assert.equal((gate as (k: string) => boolean)("name"), true);
  assert.equal((gate as (k: string) => boolean)("secret"), false);
  const never = lateFixture(Infinity);
  assert.equal(await never.guard.fieldGate({ principal: "reader" }, "type", "row", "t"), "later");
  const nowait = lateFixture(1);
  assert.equal(await nowait.guard.fieldGate({ principal: "reader" }, "type", "row", "t", undefined, { settle: false }), "later");
  assert.equal(nowait.refreshes(), 0, "a reader that cannot wait does not ask the snapshot to refresh");
});

test("fieldGate: a deletion's record is judged on the kept row, and only when asked for as a trashed one", async () => {
  const f = lateFixture(1);
  f.trashed.on = true;
  assert.equal(await f.guard.fieldGate({ principal: "reader" }, "type", "row", "t"), null, "a trashed row is not a live one");
  const gate = await f.guard.fieldGate({ principal: "reader" }, "type", "row", "t", undefined, { deleted: true });
  assert.equal(typeof gate, "function");
  assert.equal((gate as (k: string) => boolean)("name"), true);
  assert.equal((gate as (k: string) => boolean)("secret"), false);
  assert.equal(
    await f.guard.fieldGate({ principal: "stranger" }, "type", "row", "t", undefined, { deleted: true }),
    null,
    "a person who could not see the record is not told of its deletion",
  );
});
