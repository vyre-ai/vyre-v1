// Files' Trash events are folded into a mark on the file and folder resources the access module keeps (projections.ts TRASH_KEY, consumers.ts trashEvent), and that mark is the only thing a list reads.
import test from "node:test";
import assert from "node:assert/strict";
import { applyEvent, trashEvent } from "../consumers.ts";
import type { LogEvent } from "../consumers.ts";
import { AccessStore, isTrashed, loadStore, TRASH_KEY } from "../projections.ts";
import { SPACE, ctxOf, fresh, sync } from "../fixtures/incremental.ts";

const res = (
  s: AccessStore,
  id: string,
  type: string,
  parent: string | null,
  extra?: Record<string, unknown>,
): void => {
  applyEvent(s, { seq: 1, type: "resource.created", payload: { id, type, parent_id: parent, ...(extra ?? {}) } }, 1);
};
const tree = (): AccessStore => {
  const s = new AccessStore();
  res(s, "fld_top", "folder", null);
  res(s, "fld_sub", "folder", "fld_top");
  res(s, "fil_a", "file", "fld_top");
  res(s, "fil_b", "file", "fld_sub");
  res(s, "fil_c", "file", "fld_top");
  res(s, "rec_1", "record", "fld_top");
  return s;
};
const mark = (s: AccessStore, id: string) => s.resources.get(id)?.row?.[TRASH_KEY];
const ev = (type: string, payload: Record<string, unknown>) => ({ seq: 9, type, payload });

test("a file put in Trash is marked, brought back it is not, and a repeat changes nothing", () => {
  const s = tree();
  assert.deepEqual(trashEvent(s, ev("file.deleted", { fileId: "fil_a" })), ["fil_a"]);
  assert.equal(isTrashed(s.resources.get("fil_a")), true);
  assert.deepEqual(trashEvent(s, ev("file.deleted", { fileId: "fil_a" })), []);
  assert.deepEqual(trashEvent(s, ev("file.restored", { fileId: "fil_a" })), ["fil_a"]);
  assert.equal(isTrashed(s.resources.get("fil_a")), false);
  assert.equal(s.resources.get("fil_a")!.row, undefined, "the row is gone when nothing else was in it");
});

test("a folder takes what is under it, only what was not in Trash already, and brings back only what it took", () => {
  const s = tree();
  trashEvent(s, ev("file.deleted", { fileId: "fil_c" }));
  const touched = trashEvent(s, ev("folder.deleted", { folderId: "fld_top" }))!;
  assert.deepEqual(new Set(touched), new Set(["fld_top", "fld_sub", "fil_a", "fil_b"]));
  assert.equal(mark(s, "fil_c"), "fil_c", "its own root is kept");
  assert.equal(isTrashed(s.resources.get("rec_1")), false, "a record is not a file or a folder");
  trashEvent(s, ev("folder.restored", { folderId: "fld_top" }));
  for (const id of ["fld_top", "fld_sub", "fil_a", "fil_b"]) assert.equal(isTrashed(s.resources.get(id)), false, id);
  assert.equal(isTrashed(s.resources.get("fil_c")), true, "the file trashed by itself stays");
});

test("a mark survives a re-registration of the resource, and an unknown id is no change", () => {
  const s = tree();
  trashEvent(s, ev("file.deleted", { fileId: "fil_a" }));
  res(s, "fil_a", "file", "fld_sub"); // a move registers the resource again
  assert.equal(isTrashed(s.resources.get("fil_a")), true, "a registration keeps the row it had");
  assert.deepEqual(
    trashEvent(s, ev("file.deleted", { fileId: "fil_gone" })),
    [],
    "an id the store does not hold changes nothing",
  );
});

// through access.sync, as the host feeds it: the mark is written to the resource's own row, kept across calls, and read back from the tables

test("access.sync writes the mark to the resource's row, a later sync keeps it, a restore clears it, and a start marks what was in Trash before the mark existed", () => {
  const { db } = fresh("trash-sync");
  const make = (seq: number, id: string, type: string, parent: string): LogEvent => ({
    seq,
    type: "resource.created",
    payload: { id, type, parent_id: parent, label: 0, owner_id: "usr_ana", holds: 0 },
  });
  const space = make(1, SPACE, "space", null as unknown as string);
  sync(ctxOf(db), { events: [space, make(2, "fld_a", "folder", SPACE), make(3, "fil_a", "file", "fld_a")] });
  const stored = (id: string): string | null =>
    (db.all("SELECT row_json FROM access_resources WHERE id = ?", id)[0] as { row_json: string | null } | undefined)
      ?.row_json ?? null;
  assert.equal(stored("fil_a"), null);
  sync(ctxOf(db), { events: [{ seq: 4, type: "folder.deleted", payload: { folderId: "fld_a" } }] });
  assert.match(stored("fil_a") ?? "", /"trashRoot":"fld_a"/);
  assert.equal(isTrashed(loadStore(db as never).resources.get("fil_a")), true, "read back from the tables");
  sync(ctxOf(db), { events: [make(5, "fil_b", "file", "fld_a")] }); // another call: the mark is still there
  assert.equal(isTrashed(loadStore(db as never).resources.get("fil_a")), true);
  sync(ctxOf(db), { events: [{ seq: 6, type: "folder.restored", payload: { folderId: "fld_a" } }] });
  assert.equal(stored("fil_a"), null);
  // a start: Files' Trash rows name what was in Trash before the module kept the mark
  const boot: LogEvent = {
    seq: -1,
    type: "resource.created",
    payload: { id: "fil_b", trash_root: "fil_b", trash_only: true },
  };
  sync(ctxOf(db), { events: [boot] });
  assert.match(stored("fil_b") ?? "", /"trashRoot":"fil_b"/);
  sync(ctxOf(db), { events: [boot] });
  assert.match(stored("fil_b") ?? "", /"trashRoot":"fil_b"/, "idempotent");
  sync(ctxOf(db), {
    events: [{ seq: -1, type: "resource.created", payload: { id: "fil_none", trash_root: "x", trash_only: true } }],
  });
  assert.equal(stored("fil_none"), null, "nothing is made for an id the module does not hold");
});
