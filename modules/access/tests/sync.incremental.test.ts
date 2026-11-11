// access.sync keeps its store and snapshot between calls on a daemon database (consumers.ts syncKept, issue #905). These tests hold it to the old behaviour, a store read from the tables on
// every call and a snapshot built from it, on a real SQLite file with every module migration applied and the host's own db handle (a new one per call, as host/src/loader.ts makes them).
//   1  a long seeded stream of log events, handler calls, plain SQL behind the store's back and restarts: after every step the kept snapshot equals one built from the tables, and authorize
//      answers the same for a sample of people, actions and resources
//   2  a handler's change that is never written does not reach the snapshot, even when a sync runs while the handler waits
//   3  a row changed with plain SQL (as the copy from another computer does), on this connection or another, is seen by the next sync
//   4  every access table the store reads carries the triggers that move the write counter
//   5  a restart does not fold again the objects registered since the last other change (the cursor of an objects-only batch is kept in access_local_cursor)
import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../../../host/src/daemon/sqlite.ts";
import { authorize } from "../../../kernel/src/authorize/index.ts";
import type { AccessSnapshot } from "../../../kernel/src/authorize/index.ts";
import { syncCounts } from "../consumers.ts";
import type { LogEvent } from "../consumers.ts";
import { loadStore } from "../projections.ts";
import type { Db } from "../projections.ts";
import { storeOf } from "../projections.ts";
import { NOW, SPACE, ctxOf, fresh, fromTables, setLabel, stream, sync } from "../fixtures/incremental.ts";

for (const seed of [1, 7]) {
  test(`1 seed ${seed}: after every step the kept snapshot equals one built from the tables, and authorize answers the same`, async () => {
    const c = await stream(seed, 300);
    console.log(`seed ${seed}: in place ${c.inPlace}, rebuilt from the kept store ${c.rebuilt}, read from the tables ${c.hydrated}, restarts ${c.restarts}, handler calls ${c.handler}, plain SQL ${c.external}`);
    assert.ok(c.inPlace > 50, "the stream changed the kept snapshot in place");
    assert.ok(c.rebuilt > 20, "the stream built a new snapshot from the kept store");
    assert.ok(c.hydrated > c.restarts, "the stream read the tables again after other writers");
  });
}

test("1b a batch of new objects changes the kept snapshot in place; nothing new answers the same snapshot", () => {
  const { db: raw } = fresh("inplace");
  const a = sync(ctxOf(raw), { events: [{ seq: 1, type: "resource.created", payload: { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_owner", holds: 0 } }] });
  const epoch = a.epoch;
  const b = sync(ctxOf(raw), { events: [{ seq: 2, type: "resource.created", payload: { id: "rec_1", type: "record", parent_id: SPACE, label: 1, owner_id: "usr_owner", holds: 0 } }] });
  assert.equal(b, a, "the same object");
  assert.ok(b.epoch > epoch, "its epoch moved, so every derived view was dropped");
  assert.equal(b.resource("rec_1")?.label, 1);
  assert.equal(sync(ctxOf(raw), { events: [] }), b);
  const c = sync(ctxOf(raw), { events: [{ seq: 3, type: "principal.created", payload: { id: "usr_new", kind: "person", name: "New", status: "active" } }] });
  assert.notEqual(c, b, "any other change builds a new snapshot");
  assert.equal(b.principal("usr_new"), undefined, "and the one a reader still holds does not change under it");
  assert.equal(b.rowSource?.("rec_2"), undefined);
  sync(ctxOf(raw), { events: [{ seq: 4, type: "resource.created", payload: { id: "rec_2", type: "record", parent_id: SPACE, label: 0, owner_id: "usr_owner", holds: 0 } }] });
  assert.equal(b.resource("rec_2"), undefined, "a snapshot no longer kept is never changed again");
  assert.equal(b.rowSource?.("rec_2"), undefined, "nor are the rows it reads");
  raw.close();
});

test("2 a handler's change that is never written does not reach a sync that runs while the handler waits", async () => {
  const { db: raw } = fresh("phantom");
  sync(ctxOf(raw), { events: [
    { seq: 1, type: "resource.created", payload: { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_owner", holds: 0 } },
    { seq: 2, type: "principal.created", payload: { id: "usr_eve", kind: "person", name: "Eve", status: "active" } },
    { seq: 3, type: "resource.created", payload: { id: "fld_secret", type: "folder", parent_id: SPACE, label: 0, owner_id: "usr_owner", holds: 0 } },
  ] });
  const canEdit = (snap: AccessSnapshot): string => authorize(snap, { principal: "usr_eve", action: { perm: null, level: "edit" }, resource: { type: "folder", id: "fld_secret" }, now: NOW }).effect;
  assert.equal(canEdit(sync(ctxOf(raw), { events: [] })), "deny");
  const before = { ...syncCounts };
  // the handler: its own store, a grant and a role in memory, then it waits (a call out, an approval) and fails without writing
  const handler = (async () => {
    const store = storeOf(ctxOf(raw));
    store.grants.set("gr_phantom", { id: "gr_phantom", subject: { kind: "person", id: "usr_eve" }, resource: { type: "folder", id: "fld_secret" }, level: "manage", conditions: {}, by: "usr_owner", createdAt: NOW });
    store.setRoles("usr_eve", ["rol_admin"]);
    store.bump();
    await new Promise((done) => setTimeout(done, 20));
    throw new Error("the handler failed before it wrote");
  })();
  // meanwhile commits land: objects, and a forced sync
  await new Promise((done) => setTimeout(done, 5));
  const during = sync(ctxOf(raw), { events: [{ seq: 4, type: "resource.created", payload: { id: "rec_x", type: "record", parent_id: "fld_secret", label: 0, owner_id: "usr_owner", holds: 0 } }] });
  assert.equal(canEdit(during), "deny", "the sync's snapshot has none of the handler's unwritten change");
  assert.equal(during.grantsOn("fld_secret"), undefined);
  assert.equal(during.info("usr_eve")?.keys.has("role:rol_admin"), false);
  assert.equal(syncCounts.inPlace - before.inPlace, 1, "and it came from the kept store, which the handler never held");
  await assert.rejects(handler);
  const after = sync(ctxOf(raw), { events: [] });
  assert.equal(canEdit(after), "deny");
  assert.equal(canEdit(fromTables(ctxOf(raw))), "deny");
  raw.close();
});

test("3 a row changed with plain SQL, on this connection or another, is seen by the next sync", () => {
  const { file, db: raw } = fresh("external");
  const base: LogEvent[] = [
    { seq: 1, type: "resource.created", payload: { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_owner", holds: 0 } },
    { seq: 2, type: "principal.created", payload: { id: "usr_dan", kind: "person", name: "Dan", status: "active" } },
    { seq: 3, type: "principal.role_set", payload: { holder: "usr_dan", role: "rol_member" } },
    { seq: 4, type: "resource.created", payload: { id: "fld_a", type: "folder", parent_id: SPACE, label: 0, owner_id: "usr_owner", holds: 0 } },
  ];
  sync(ctxOf(raw), { events: base });
  const kept = sync(ctxOf(raw), { events: [{ seq: 5, type: "resource.created", payload: { id: "rec_a", type: "record", parent_id: "fld_a", label: 0, owner_id: "usr_owner", holds: 0 } }] });
  const view = (snap: AccessSnapshot, id: string): string => authorize(snap, { principal: "usr_dan", action: { perm: null, level: "view" }, resource: { type: "record", id }, now: NOW }).effect;
  assert.equal(view(kept, "rec_a"), "allow");
  // this connection: the folder becomes Restricted, as a copy from another computer writes it
  raw.run("UPDATE access_resources SET label = 'restricted' WHERE id = 'fld_a'");
  const one = sync(ctxOf(raw), { events: [] });
  assert.notEqual(one, kept, "read again");
  assert.equal(one.effectiveLabel("rec_a"), 3);
  assert.equal(view(one, "rec_a"), "deny");
  // another connection (another process on the same file): Dan's role row goes
  const other = openDb(file);
  other.run("DELETE FROM access_assignments WHERE holder = 'usr_dan'");
  other.close();
  const two = sync(ctxOf(raw), { events: [] });
  assert.equal(two.info("usr_dan")?.keys.has("role:rol_member"), false);
  // a grant row put in behind the store, then removed
  raw.run(`INSERT INTO access_grants (id, "subjectKind", "subjectId", "resourceType", "resourceId", level, conditions, "expiresAt", by, source, version) VALUES ('gr_sql','person','usr_dan','record','rec_a','view','{}',NULL,'usr_owner',NULL,1)`);
  raw.run("UPDATE access_resources SET label = 'public' WHERE id = 'fld_a'");
  assert.equal(view(sync(ctxOf(raw), { events: [] }), "rec_a"), "allow");
  raw.run("DELETE FROM access_grants WHERE id = 'gr_sql'");
  assert.equal(view(sync(ctxOf(raw), { events: [] }), "rec_a"), "deny");
  // the store's own cursor row, changed behind it, is read again too
  raw.run("UPDATE access_local_cursor SET seq = 1 WHERE id = 'seed_cursor'");
  const again = sync(ctxOf(raw), { events: [{ seq: 4, type: "resource.created", payload: { id: "fld_a", type: "folder", parent_id: SPACE, label: 2, owner_id: "usr_owner", holds: 0 } }] });
  assert.equal(again.resource("fld_a")?.label, 2, "an event above the cursor as the table now holds it is folded");
  raw.close();
});

test("4 every table the store reads moves the write counter on insert, update and delete", () => {
  const { db: raw } = fresh("triggers");
  const read = new Set<string>();
  const spy: Db = { all: (sql, ...a) => { const m = /\bFROM\s+"?([A-Za-z0-9_]+)/i.exec(sql); if (m) read.add(m[1]!); return raw.all(sql, ...a); }, run: (sql, ...a) => raw.run(sql, ...a) };
  loadStore(spy);   // seeds the empty tables
  loadStore(spy);   // reads them
  read.delete("access_local_stamp");
  assert.ok(read.size >= 12, [...read].join(", "));
  const triggers = raw.all("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'access_stamp_%'") as { tbl_name: string; sql: string }[];
  for (const t of read) for (const op of ["INSERT", "UPDATE", "DELETE"]) {
    assert.ok(triggers.some((x) => x.tbl_name === t && new RegExp(`AFTER ${op} ON`, "i").test(x.sql)), `${t} has a counter trigger AFTER ${op}`);
  }
  const n = (): number => Number((raw.all(`SELECT n FROM access_local_stamp WHERE id = 1`)[0] as { n: number }).n);
  const at = n();
  raw.run("INSERT INTO access_fields (k, rank) VALUES ('x.y', 1)");
  raw.run("UPDATE access_fields SET rank = 2 WHERE k = 'x.y'");
  raw.run("INSERT OR REPLACE INTO access_fields (k, rank) VALUES ('x.y', 3)");
  raw.run("INSERT INTO access_fields (k, rank) VALUES ('x.y', 4) ON CONFLICT(k) DO UPDATE SET rank = max(rank, excluded.rank)");
  raw.run("DELETE FROM access_fields WHERE k = 'x.y'");
  assert.equal(n(), at + 5, "one step per row written, which is what each statement's change count says");
  raw.close();
});

test("5 a restart does not fold again objects registered since the last other change, so a label set on one since is kept", () => {
  const { file, db: first } = fresh("cursor");
  const log: LogEvent[] = [
    { seq: 1, type: "resource.created", payload: { id: SPACE, type: "space", parent_id: null, label: 0, owner_id: "usr_owner", holds: 0 } },
    { seq: 2, type: "principal.created", payload: { id: "usr_fay", kind: "person", name: "Fay", status: "active" } },
    { seq: 3, type: "principal.role_set", payload: { holder: "usr_fay", role: "rol_member" } },
  ];
  sync(ctxOf(first), { events: log });
  const made: LogEvent = { seq: 4, type: "resource.created", payload: { id: "fld_hr", type: "folder", parent_id: SPACE, label: 0, owner_id: "usr_owner", holds: 0 } };
  log.push(made);
  sync(ctxOf(first), { events: [made] });   // an objects-only batch
  assert.equal(setLabel(ctxOf(first), { resource: { type: "folder", id: "fld_hr" }, label: "restricted" }), true);
  sync(ctxOf(first), { events: [] });
  first.close();
  const raw = openDb(file);   // the server starts again and hands its whole log over
  const snap = sync(ctxOf(raw), { events: log });
  assert.equal(snap.resource("fld_hr")?.label, 3, "the folder is still Restricted");
  assert.equal(authorize(snap, { principal: "usr_fay", action: { perm: null, level: "view" }, resource: { type: "folder", id: "fld_hr" }, now: NOW }).effect, "deny");
  assert.deepEqual(raw.all("SELECT id, seq FROM access_local_cursor").map((row) => ({ ...(row as object) })), [{ id: "seed_cursor", seq: 4 }]);
  raw.close();
});
