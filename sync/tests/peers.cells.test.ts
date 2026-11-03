// Cells between computers of one Personal Space (sync/src/peers/cells.ts): a write on one computer reaches another whole, a write made offline arrives later, two computers that changed the
// same field agree on the later one whatever order they sync in, a delete beats an older edit and loses to a newer one, a change goes on through a third computer, and nothing applied from
// another computer is noted again as this computer's own.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createCells } from "../src/peers/cells.ts";
import type { Cells, CellDb } from "../src/peers/cells.ts";

const SCHEMA = `
CREATE TABLE chat_thread (id TEXT PRIMARY KEY, title TEXT NOT NULL, starred INTEGER NOT NULL DEFAULT 0, body BLOB);
CREATE TABLE chat_member (thread TEXT NOT NULL, person TEXT NOT NULL, role TEXT, PRIMARY KEY (thread, person));
CREATE TABLE logs_row (id INTEGER PRIMARY KEY, line TEXT);
CREATE TABLE network_phone (name TEXT PRIMARY KEY, state TEXT);
CREATE TABLE network_peer (id TEXT PRIMARY KEY, name TEXT, last_seen_at INTEGER);
CREATE TABLE projects_item (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, note TEXT);
CREATE TABLE numbers_line (id TEXT PRIMARY KEY, number INTEGER NOT NULL UNIQUE);
`;

function computer(site: string, clock: { t: number }): { db: DatabaseSync; cells: Cells } {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const cdb: CellDb = { all: (s, ...a) => db.prepare(s).all(...(a as never[])), run: (s, ...a) => db.prepare(s).run(...(a as never[])), exec: (s) => db.exec(s) };
  const cells = createCells(cdb, { site, now: () => clock.t, deny: (t) => t === "network_phone", denyColumns: { network_peer: ["last_seen_at"] } });
  cells.install();
  return { db, cells };
}
const sync = (from: Cells, to: Cells, peer: string): number => {
  let n = 0;
  for (;;) {
    const page = from.changes(to.cursor(peer), 2);
    n += to.apply(page.rows).applied;
    to.setCursor(peer, page.next);
    if (!page.more) return n;
  }
};
const rows = (db: DatabaseSync, sql: string): unknown[] => db.prepare(sql).all().map((r) => ({ ...r }));

test("a write on one computer reaches the other whole, and only the tables and columns that travel", () => {
  const clock = { t: 1_000 };
  const a = computer("peer_a", clock), b = computer("peer_b", clock);
  assert.deepEqual([...a.cells.tables()].sort(), ["chat_member", "chat_thread", "network_peer", "numbers_line", "projects_item"], "no integer-keyed log, no denied table");
  a.db.exec("INSERT INTO chat_thread (id, title, body) VALUES ('t1', 'Plan', x'0102ff')");
  a.db.exec("INSERT INTO chat_member VALUES ('t1', 'usr_irfad', 'owner'), ('t1', 'usr_aina', NULL)");
  a.db.exec("INSERT INTO logs_row (line) VALUES ('local only')");
  a.db.exec("INSERT INTO network_phone VALUES ('irfad', 'claimed')");
  a.db.exec("INSERT INTO network_peer VALUES ('peer_a', 'Office iMac', 99)");
  assert.equal(a.cells.waiting(0), 4, "four rows written here wait for the other computer");
  assert.equal(sync(a.cells, b.cells, "peer_a"), 4);
  assert.deepEqual(rows(b.db, "SELECT id, title, starred, hex(body) AS body FROM chat_thread"), [{ id: "t1", title: "Plan", starred: 0, body: "0102FF" }]);
  assert.equal(rows(b.db, "SELECT * FROM chat_member").length, 2);
  assert.deepEqual(rows(b.db, "SELECT * FROM network_peer"), [{ id: "peer_a", name: "Office iMac", last_seen_at: null }], "a denied column stays");
  assert.equal(rows(b.db, "SELECT * FROM logs_row").length + rows(b.db, "SELECT * FROM network_phone").length, 0);
  assert.equal(rows(b.db, "SELECT * FROM peer_dirty").length, 0, "nothing applied from another computer is noted as this computer's own");
  assert.equal(b.cells.waiting(0), 0);
  assert.equal(sync(a.cells, b.cells, "peer_a"), 0, "a second sync finds nothing new");
});

test("offline edits on both computers converge to the later write, whichever syncs first", () => {
  const clock = { t: 1_000 };
  const a = computer("peer_a", clock), b = computer("peer_b", clock);
  a.db.exec("INSERT INTO chat_thread (id, title) VALUES ('t1', 'Plan')");
  sync(a.cells, b.cells, "peer_a");
  // both offline: A renames at 2000, B renames at 3000 and stars it
  clock.t = 2_000; a.db.exec("UPDATE chat_thread SET title = 'Plan A' WHERE id = 't1'"); a.cells.stamp();
  clock.t = 3_000; b.db.exec("UPDATE chat_thread SET title = 'Plan B', starred = 1 WHERE id = 't1'"); b.cells.stamp();
  clock.t = 4_000;
  sync(a.cells, b.cells, "peer_a");
  sync(b.cells, a.cells, "peer_b");
  sync(a.cells, b.cells, "peer_a");
  for (const c of [a, b]) assert.deepEqual(rows(c.db, "SELECT title, starred FROM chat_thread"), [{ title: "Plan B", starred: 1 }], "both computers hold the later title");
  // the earlier write applied second changes nothing
  clock.t = 5_000; a.db.exec("UPDATE chat_thread SET starred = 0 WHERE id = 't1'");
  sync(a.cells, b.cells, "peer_a");
  assert.deepEqual(rows(b.db, "SELECT title, starred FROM chat_thread"), [{ title: "Plan B", starred: 0 }], "different fields merge independently");
});

test("a delete beats an older edit, and a newer edit brings the row back", () => {
  const clock = { t: 1_000 };
  const a = computer("peer_a", clock), b = computer("peer_b", clock);
  a.db.exec("INSERT INTO chat_thread (id, title) VALUES ('t1', 'Plan'), ('t2', 'Notes')");
  sync(a.cells, b.cells, "peer_a");
  clock.t = 2_000; b.db.exec("UPDATE chat_thread SET title = 'Plan edited' WHERE id = 't1'"); b.cells.stamp();
  clock.t = 3_000; a.db.exec("DELETE FROM chat_thread WHERE id = 't1'"); a.cells.stamp();
  clock.t = 4_000; a.db.exec("DELETE FROM chat_thread WHERE id = 't2'"); a.cells.stamp();
  clock.t = 5_000; b.db.exec("UPDATE chat_thread SET title = 'Notes kept' WHERE id = 't2'"); b.cells.stamp();
  sync(a.cells, b.cells, "peer_a");
  sync(b.cells, a.cells, "peer_b");
  for (const c of [a, b]) assert.deepEqual(rows(c.db, "SELECT id, title FROM chat_thread ORDER BY id"), [{ id: "t2", title: "Notes kept" }]);
});

test("a change goes on through a third computer that never met the first", () => {
  const clock = { t: 1_000 };
  const a = computer("peer_a", clock), b = computer("peer_b", clock), c = computer("peer_c", clock);
  a.db.exec("INSERT INTO chat_thread (id, title) VALUES ('t1', 'From the office')");
  sync(a.cells, b.cells, "peer_a");
  sync(b.cells, c.cells, "peer_b");
  assert.deepEqual(rows(c.db, "SELECT title FROM chat_thread"), [{ title: "From the office" }]);
  clock.t = 2_000; c.db.exec("UPDATE chat_thread SET title = 'From the laptop' WHERE id = 't1'");
  sync(c.cells, b.cells, "peer_c");
  sync(b.cells, a.cells, "peer_b");
  assert.deepEqual(rows(a.db, "SELECT title FROM chat_thread"), [{ title: "From the laptop" }]);
  // the clocks kept their writer: C's edit, not B's
  assert.equal((a.db.prepare("SELECT site FROM peer_clock WHERE tbl = 'chat_thread' AND col = 'title'").get() as { site: string }).site, "peer_c");
});

test("a table added later is copied once install runs again", () => {
  const clock = { t: 1_000 };
  const a = computer("peer_a", clock), b = computer("peer_b", clock);
  for (const x of [a, b]) { x.db.exec("CREATE TABLE rt_matter (id TEXT PRIMARY KEY, name TEXT)"); x.cells.install(); }
  a.db.exec("INSERT INTO rt_matter VALUES ('m1', 'Estate of Lee')");
  sync(a.cells, b.cells, "peer_a");
  assert.deepEqual(rows(b.db, "SELECT * FROM rt_matter"), [{ id: "m1", name: "Estate of Lee" }]);
});

test("the same name made on both computers while apart: both items survive, the later keeps the name, the other is renamed the same way on both", () => {
  const clock = { t: 1_000 };
  const a = computer("peer_a", clock), b = computer("peer_b", clock);
  a.db.exec("INSERT INTO projects_item VALUES ('p_a', 'Tax 2026', 'made on the office computer')"); a.cells.stamp();
  clock.t = 2_000; b.db.exec("INSERT INTO projects_item VALUES ('p_b', 'Tax 2026', 'made on the laptop')"); b.cells.stamp();
  clock.t = 3_000;
  const first = (() => { const page = a.cells.changes(0); return b.cells.apply(page.rows); })();
  assert.equal(first.conflicts.length, 1, "the clash is reported, not skipped");
  assert.equal(first.refused.length, 0);
  sync(b.cells, a.cells, "peer_b");
  sync(a.cells, b.cells, "peer_a");
  for (const c of [a, b]) {
    assert.deepEqual(rows(c.db, "SELECT id, name, note FROM projects_item ORDER BY id"), [
      { id: "p_a", name: "Tax 2026 (2)", note: "made on the office computer" },
      { id: "p_b", name: "Tax 2026", note: "made on the laptop" },
    ], "the later one keeps the name on both computers");
  }
  assert.equal(rows(b.db, "SELECT * FROM peer_conflict WHERE kind = 'renamed'").length >= 1, true, "the rename is in the conflicts list");
});

test("a clash that cannot be renamed keeps the other row whole in the conflicts list", () => {
  const clock = { t: 1_000 };
  const a = computer("peer_a", clock), b = computer("peer_b", clock);
  a.db.exec("INSERT INTO numbers_line VALUES ('n_a', 5551234)"); a.cells.stamp();
  clock.t = 2_000; b.db.exec("INSERT INTO numbers_line VALUES ('n_b', 5551234)"); b.cells.stamp();
  const out = b.cells.apply(a.cells.changes(0).rows);
  assert.equal(out.conflicts[0]?.kept, "aside");
  const kept = rows(b.db, "SELECT tbl, kind, row FROM peer_conflict") as { tbl: string; kind: string; row: string }[];
  assert.equal(kept[0]!.kind, "kept_aside");
  assert.equal(JSON.parse(kept[0]!.row).c.number.v, 5551234, "the row is kept whole, not lost");
});
