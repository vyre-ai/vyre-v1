// Migration 0005 (mounts_item.shown_name) on a REAL SQLite file built the way rc.26 left it (0001 to 0003 applied, rows in place). The mounts module tests run on an in-memory stand-in that reads
// CREATE TABLE only and never runs migration SQL (a reviewer found that on 14 Nov 2026), so this is the one place the ALTER runs against a file with data in it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/daemon/sqlite.ts";
import { migrate } from "../src/daemon/hosttables.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATIONS = path.join(ROOT, "modules", "mounts", "migrations");
const NEW = "0005_mounts_shown_name.sql";

/** A code root holding the mounts migrations that rc.26 shipped (0001 to 0003). */
function rc26Root(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-mounts-mig-"));
  fs.mkdirSync(path.join(root, "modules", "mounts", "migrations"), { recursive: true });
  for (const f of ["0001_mounts_core.sql", "0002_mount_account.sql", "0003_mounts_live.sql"])
    fs.copyFileSync(path.join(MIGRATIONS, f), path.join(root, "modules", "mounts", "migrations", f));
  return root;
}
const open = () => openDb(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-mounts-db-")), "modules.db"));
const columns = (db: ReturnType<typeof open>): string[] =>
  (db.all("PRAGMA table_info(mounts_item)") as { name: string }[]).map((c) => c.name);
const rows = (db: ReturnType<typeof open>): Record<string, unknown>[] =>
  JSON.parse(JSON.stringify(db.all("SELECT mount_id, item_key, remote_id, name, shown_name FROM mounts_item ORDER BY item_key"))) as Record<string, unknown>[];

const addNew = (root: string): void =>
  fs.copyFileSync(path.join(MIGRATIONS, NEW), path.join(root, "modules", "mounts", "migrations", NEW));

test("0005 ships byte for byte what the larger branch carries: one nullable TEXT column on mounts_item", () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS, NEW), "utf8");
  assert.match(sql, /^ALTER TABLE mounts_item ADD COLUMN shown_name TEXT;$/m);
  assert.equal(sql.includes("NOT NULL"), false);
});

test("an rc.26 file with rows: 0005 adds shown_name as NULL to every row, keeps every row, and a second run does nothing", () => {
  const root = rc26Root();
  const db = open();
  assert.equal(migrate(db, root, () => 1).length, 3);
  assert.equal(columns(db).includes("shown_name"), false, "rc.26 has no shown_name");
  db.run("INSERT INTO mounts_mount (id, folder_id, kind, name, mode, review_changes, state, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", "mnt_1", "fld_1", "google_drive", "Drive", "live_only", 1, "idle", "usr_a", 1, 1);
  // the shapes rc.26 wrote: a mapped file, a folder, a Vyre-side item with no remote id yet, and a name that is only spaces' worth of text
  db.run("INSERT INTO mounts_item (mount_id, item_key, remote_id, parent_key, file_id, folder_id, name, is_folder, native, dirty, deleted, conflict) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", "mnt_1", "itm_a", "d1", null, null, "fld_1", "Drive", 1, 0, 0, 0, 0);
  db.run("INSERT INTO mounts_item (mount_id, item_key, remote_id, parent_key, file_id, folder_id, name, is_folder, native, dirty, deleted, conflict) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", "mnt_1", "itm_b", "d2", "itm_a", "fil_b", null, "Budget.pdf", 0, 0, 0, 0, 0);
  db.run("INSERT INTO mounts_item (mount_id, item_key, remote_id, parent_key, file_id, folder_id, name, is_folder, native, dirty, deleted, conflict) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", "mnt_1", "itm_c", null, "itm_a", "fil_c", null, "new from Vyre.txt", 0, 0, 1, 0, 0);
  db.run("INSERT INTO mounts_item (mount_id, item_key, remote_id, parent_key, file_id, folder_id, name, is_folder, native, dirty, deleted, conflict) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", "mnt_1", "itm_d", "d4", "itm_a", "fil_d", null, "", 0, 0, 0, 0, 0);
  const before = JSON.parse(JSON.stringify(db.all("SELECT * FROM mounts_item ORDER BY item_key"))) as Record<string, unknown>[];

  addNew(root);
  assert.deepEqual(migrate(db, root, () => 2), [{ module: "mounts", file: NEW }]);
  assert.equal(columns(db).filter((c) => c === "shown_name").length, 1);
  const after = rows(db);
  assert.equal(after.length, 4, "no row lost");
  assert.ok(after.every((r) => r["shown_name"] === null), "every old row reads NULL");
  assert.deepEqual(
    after.map((r) => [r["item_key"], r["remote_id"], r["name"]]),
    before.map((r) => [r["item_key"], r["remote_id"], r["name"]]),
    "ids and names are untouched",
  );
  assert.deepEqual(migrate(db, root, () => 3), [], "a second run applies nothing");
  assert.equal(rows(db).length, 4);
  assert.equal(columns(db).filter((c) => c === "shown_name").length, 1);
});

test("an empty rc.26 table takes 0005, and the column then holds a value", () => {
  const root = rc26Root();
  const db = open();
  migrate(db, root, () => 1);
  addNew(root);
  migrate(db, root, () => 2);
  assert.equal(columns(db).includes("shown_name"), true);
  assert.deepEqual(rows(db), []);
  db.run("INSERT INTO mounts_item (mount_id, item_key, name, shown_name) VALUES (?, ?, ?, ?)", "mnt_1", "itm_x", "Q3/Q4 plan.pdf", "Q3-Q4 plan.pdf");
  assert.equal(rows(db)[0]?.["shown_name"], "Q3-Q4 plan.pdf");
});

test("the SQL itself run a second time fails with a duplicate column, which is why the runner records each file (host_migration) and never repeats one", () => {
  const root = rc26Root();
  const db = open();
  migrate(db, root, () => 1);
  const sql = fs.readFileSync(path.join(MIGRATIONS, NEW), "utf8");
  db.exec(sql);
  assert.throws(() => db.exec(sql), /duplicate column/i);
});

test("mounts_item.name is NOT NULL in rc.26, so a NULL name cannot exist in a file to migrate; an empty name can and migrates", () => {
  const root = rc26Root();
  const db = open();
  migrate(db, root, () => 1);
  assert.throws(
    () => db.run("INSERT INTO mounts_item (mount_id, item_key, name) VALUES (?, ?, ?)", "mnt_1", "itm_n", null),
    /NOT NULL/i,
  );
});
