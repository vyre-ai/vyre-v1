// The access store's cursor is a sequence number of this computer's own log (migrations/0004_local_cursor.sql). On a Personal Space on two computers the access tables travel, and the cursor
// used to travel with them in access_fields: a computer whose log was shorter then skipped its own access events at or below the other's number, so an agent made on one computer answered
// "not found" on the other, and after a restart that computer could not make agents at all (test/peers.agents.live under load). The cursor now lives in access_local_cursor, which never travels
// (host/tests/peers.local-tables.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { hostCalls } from "../consumers.ts";
import { harness } from "../fixtures/db.ts";
import { CURSOR_KEY, dropStore, storeOf } from "../projections.ts";

const sync = hostCalls["access.sync"] as unknown as (ctx: unknown, input: { events: Array<{ seq: number; type: string; payload: unknown }> }) => unknown;

test("a cursor copied from another computer's access_fields does not make this computer skip its own events", () => {
  const h = harness();
  sync(h.ctx, { events: [{ seq: 12, type: "principal.created", payload: { id: "usr_here", kind: "person", name: "Here" } }] });
  assert.ok(storeOf(h.ctx).principals.has("usr_here"));
  assert.deepEqual(h.db.tables.get("access_local_cursor"), [{ id: CURSOR_KEY, seq: 12 }], "the cursor is kept in the local table");
  assert.equal((h.db.tables.get("access_fields") ?? []).some((r) => r["k"] === CURSOR_KEY), false, "and not in access_fields, which travels");
  // the other computer's row arrives through the access tables, with its own log's number
  h.db.tables.get("access_fields")!.push({ k: CURSOR_KEY, rank: 295 });
  dropStore(h.db);
  assert.equal(storeOf(h.ctx).fieldLabels.get(CURSOR_KEY), 12, "this computer's cursor is its own");
  // its next event, seq 13, is folded
  sync(h.ctx, { events: [{ seq: 13, type: "principal.created", payload: { id: "agt_made_here", kind: "agent", name: "Made here", owner: "usr_here" } }] });
  assert.ok(storeOf(h.ctx).principals.has("agt_made_here"), "an event of this computer's own log above its own cursor is folded");
  dropStore(h.db);
  assert.ok(storeOf(h.ctx).principals.has("agt_made_here"), "and kept");
  assert.equal(storeOf(h.ctx).fieldLabels.get(CURSOR_KEY), 13);
});
