// Two calls on one database overlap: each holds the copy of the access store it read when it began, and the one that writes last must not write away what the other changed.
// The host gives every call a new `ctx.db` over the same database, so the tests do too.
import test from "node:test";
import assert from "node:assert/strict";
import { MemoryDb, harness } from "../fixtures/db.ts";
import { changed, storeOf } from "../projections.ts";
import type { AccessCtx, Db, GrantRec, ResourceRec } from "../projections.ts";

/** One call's window onto the shared database: a different object every time, as in the host. */
const view = (shared: MemoryDb): Db => ({ all: (sql, ...a) => shared.all(sql, ...a), run: (sql, ...a) => shared.run(sql, ...a) });
const callOn = (base: AccessCtx, shared: MemoryDb): AccessCtx => ({ ...base, db: view(shared) });

const grant = (id: string): GrantRec => ({ id, subject: { kind: "person", id: "usr_ian" }, resource: { type: "folder", id: "fld_x" }, level: "view", conditions: {}, by: "usr_admin", createdAt: 1 });
const folder = (id: string): ResourceRec => ({ id, type: "folder", parentId: null, label: "internal", ownerId: null, holds: 0 });

test("a row one call added survives another call that read the store before it and writes after it", () => {
  const h = harness();
  const shared = h.db;
  storeOf(callOn(h.ctx, shared));   // the Space is seeded
  const a = callOn(h.ctx, shared), b = callOn(h.ctx, shared);
  const storeA = storeOf(a), storeB = storeOf(b);      // both read the same state
  assert.notEqual(storeA, storeB, "each call has its own copy");
  // call A adds a Space root folder and a share
  storeA.resources.set("fld_agents", folder("fld_agents"));
  storeA.grants.set("grn_new", grant("grn_new"));
  changed(a, storeA, "label");
  // call B, which began before A finished, changes something else and writes
  storeB.fieldLabels.set("contact.phone", 2);
  changed(b, storeB, "label");
  const fresh = storeOf(callOn(h.ctx, shared));
  assert.ok(fresh.resources.has("fld_agents"), "the root folder is still there");
  assert.ok(fresh.grants.has("grn_new"), "the share is still there");
  assert.equal(fresh.fieldLabels.get("contact.phone"), 2, "and B's own change is written");
});

test("a grant one call revoked does not come back when another call writes from an older copy", () => {
  const h = harness();
  const shared = h.db;
  const seed = callOn(h.ctx, shared);
  const s0 = storeOf(seed);
  s0.grants.set("grn_old", grant("grn_old"));
  changed(seed, s0, "label");
  const a = callOn(h.ctx, shared), b = callOn(h.ctx, shared);
  const storeA = storeOf(a), storeB = storeOf(b);
  assert.ok(storeB.grants.has("grn_old"), "B read it before the revoke");
  storeA.grants.delete("grn_old");
  changed(a, storeA, "label");
  storeB.fieldLabels.set("contact.email", 1);
  changed(b, storeB, "label");
  const fresh = storeOf(callOn(h.ctx, shared));
  assert.equal(fresh.grants.has("grn_old"), false, "a revoked grant stays revoked");
});

test("two calls that both change the same row: the later write wins, and the epoch and event cursor never go back", () => {
  const h = harness();
  const shared = h.db;
  const a = callOn(h.ctx, shared), b = callOn(h.ctx, shared);
  const storeA = storeOf(a), storeB = storeOf(b);
  storeA.fieldLabels.set("seed_cursor", 40);
  changed(a, storeA, "label");
  storeB.fieldLabels.set("seed_cursor", 12);
  changed(b, storeB, "label");
  const fresh = storeOf(callOn(h.ctx, shared));
  assert.equal(fresh.fieldLabels.get("seed_cursor"), 40, "the cursor of events folded in does not move back");
  assert.ok(fresh.epoch >= storeA.epoch, "nor does the epoch");
});
