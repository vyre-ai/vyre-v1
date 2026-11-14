// "Made for me, usable by the maker" in the access module's own tables: the agent a resource was made by (the host's registrar says it in resource.created) is kept as the resource row says, survives a
// re-registration that does not repeat it (a move, a label change), and is the same when the snapshot is rebuilt from the tables.
import test from "node:test";
import assert from "node:assert/strict";
import type { LogEvent } from "../consumers.ts";
import { SPACE, ctxOf, fresh, fromTables, sync } from "../fixtures/incremental.ts";

test("made_by on a resource is kept, survives a re-registration without it, and is the same after a rebuild from the tables", () => {
  const { db } = fresh("made-by");
  const space: LogEvent = {
    seq: 1,
    type: "resource.created",
    payload: { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_ana", holds: 0 },
  };
  const made: LogEvent = {
    seq: 2,
    type: "resource.created",
    payload: {
      id: "sit_1",
      type: "site",
      parent_id: SPACE,
      label: 0,
      owner_id: "usr_ana",
      holds: 0,
      made_by: "agt_helper",
    },
  };
  const own: LogEvent = {
    seq: 3,
    type: "resource.created",
    payload: { id: "sit_2", type: "site", parent_id: SPACE, label: 0, owner_id: "usr_ana", holds: 0 },
  };
  let snap = sync(ctxOf(db), { events: [space, made, own] });
  assert.equal(snap.resource("sit_1")?.made_by, "agt_helper");
  assert.equal(snap.resource("sit_2")?.made_by, undefined, "what no agent made says nothing");
  // registered again without it (a move)
  const again: LogEvent = {
    seq: 4,
    type: "resource.created",
    payload: { id: "sit_1", type: "site", parent_id: "fld_x", label: 0, owner_id: "usr_ana", holds: 0 },
  };
  snap = sync(ctxOf(db), { events: [again] });
  assert.equal(snap.resource("sit_1")?.made_by, "agt_helper", "kept");
  assert.equal(fromTables(ctxOf(db)).resource("sit_1")?.made_by, "agt_helper", "the same from the tables");
});

test("a calendar registered before the outside flag existed is flagged at start by an outside_only mark: nothing else changes, and a second mark changes nothing", () => {
  const { db } = fresh("outside");
  const space: LogEvent = {
    seq: 1,
    type: "resource.created",
    payload: { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_ana", holds: 0 },
  };
  const cal: LogEvent = {
    seq: 2,
    type: "resource.created",
    payload: { id: "cld_google", type: "calendar", parent_id: null, label: 0, owner_id: "usr_ana", holds: 0 },
  };
  let snap = sync(ctxOf(db), { events: [space, cal] });
  assert.equal(snap.resource("cld_google")?.outside, undefined, "registered before the flag: not flagged");
  const mark: LogEvent = { seq: -1, type: "resource.created", payload: { id: "cld_google", outside_only: true } };
  snap = sync(ctxOf(db), { events: [mark] });
  const r = snap.resource("cld_google")!;
  assert.equal(r.outside, true);
  assert.equal(r.parent_id, null, "its place is kept");
  assert.equal(r.owner_id, "usr_ana", "and its owner");
  assert.equal(fromTables(ctxOf(db)).resource("cld_google")?.outside, true, "the same from the tables");
  snap = sync(ctxOf(db), { events: [mark] });
  assert.equal(snap.resource("cld_google")?.outside, true, "idempotent");
  // a mark for something not registered does nothing
  snap = sync(ctxOf(db), {
    events: [{ seq: -1, type: "resource.created", payload: { id: "cld_none", outside_only: true } }],
  });
  assert.equal(snap.resource("cld_none"), undefined);
});
