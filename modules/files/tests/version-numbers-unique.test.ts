// 0007_version_numbers_unique.sql (F50): a store the old race left with repeated version numbers is renumbered in the order saved, with no row dropped and the current content unchanged; a clean store is left as it is;
// and a repeated number can no longer be stored. How long it takes on a file with thousands of versions is measured here and bounded.
// @reads /modules/files/migrations/0005_files_entities.sql
// @reads /modules/files/migrations/0007_version_numbers_unique.sql
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const read = (f: string): string => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");
const entities = read("0005_files_entities.sql");
const unique = read("0007_version_numbers_unique.sql");

type Db = InstanceType<typeof DatabaseSync>;
function store(): Db {
  const db = new DatabaseSync(":memory:");
  db.exec(entities);
  return db;
}
function file(db: Db, id: string, version: number, blob: string): void {
  db.prepare("INSERT INTO files_file (id, version, blob) VALUES (?, ?, ?)").run(id, version, blob);
}
function ver(db: Db, id: string, fileId: string, n: number, at: number, blob: string): void {
  db.prepare("INSERT INTO files_file_version (id, file_id, n, blob, at) VALUES (?, ?, ?, ?, ?)").run(
    id,
    fileId,
    n,
    blob,
    at,
  );
}
const rows = (db: Db, fileId: string): Array<{ id: string; n: number; blob: string }> =>
  db.prepare("SELECT id, n, blob FROM files_file_version WHERE file_id = ? ORDER BY n").all(fileId) as never;

test("a file the race left with 1,2,2 is renumbered 1,2,3, every row kept, the current content unchanged", () => {
  const db = store();
  file(db, "f", 2, "B"); // Bob's write was the last to update the file
  ver(db, "v1", "f", 1, 100, "orig");
  ver(db, "v2a", "f", 2, 200, "A");
  ver(db, "v2b", "f", 2, 200, "B");
  db.exec(unique);
  assert.deepEqual(
    rows(db, "f").map((r) => [r.id, r.n, r.blob]),
    [
      ["v1", 1, "orig"],
      ["v2a", 2, "A"],
      ["v2b", 3, "B"],
    ],
  );
  const f = db.prepare("SELECT version, blob FROM files_file WHERE id = 'f'").get() as {
    version: number;
    blob: string;
  };
  assert.deepEqual({ ...f }, { version: 3, blob: "B" }, "the file shows the same content, under its new number");
});

test("1,2,3,3 becomes 1,2,3,4; and a later number after the repeat (1,2,2,3) moves up with it", () => {
  const db = store();
  file(db, "g", 3, "D");
  for (const [id, n, at, blob] of [
    ["a", 1, 1, "a"],
    ["b", 2, 2, "b"],
    ["c", 3, 3, "c"],
    ["d", 3, 3, "D"],
  ] as const)
    ver(db, id, "g", n, at, blob);
  file(db, "h", 3, "H3");
  for (const [id, n, at, blob] of [
    ["h1", 1, 1, "H1"],
    ["h2a", 2, 2, "H2a"],
    ["h2b", 2, 2, "H2b"],
    ["h3", 3, 5, "H3"],
  ] as const)
    ver(db, id, "h", n, at, blob);
  db.exec(unique);
  assert.deepEqual(
    rows(db, "g").map((r) => r.n),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    rows(db, "h").map((r) => [r.n, r.blob]),
    [
      [1, "H1"],
      [2, "H2a"],
      [3, "H2b"],
      [4, "H3"],
    ],
  );
  assert.equal((db.prepare("SELECT version FROM files_file WHERE id = 'h'").get() as { version: number }).version, 4);
});

test("a clean store is left exactly as it was, gaps included, and a repeated number is refused from then on", () => {
  const db = store();
  file(db, "c", 5, "e");
  for (const [id, n] of [
    ["a", 1],
    ["b", 2],
    ["e", 5],
  ] as const)
    ver(db, id, "c", n, n, id);
  db.exec(unique);
  assert.deepEqual(
    rows(db, "c").map((r) => r.n),
    [1, 2, 5],
  );
  assert.equal((db.prepare("SELECT version FROM files_file WHERE id = 'c'").get() as { version: number }).version, 5);
  assert.throws(() => ver(db, "dup", "c", 2, 9, "x"), /UNIQUE/);
  db.exec(unique); // running it again changes nothing
});

test("a file with 5000 versions and one repeat is renumbered in well under a second", () => {
  const db = store();
  file(db, "big", 5000, "last");
  db.exec("BEGIN");
  for (let i = 1; i <= 2500; i++) ver(db, `v${i}`, "big", i, i, `b${i}`);
  ver(db, "dup", "big", 2500, 2500, "dup");
  for (let i = 2501; i <= 5000; i++) ver(db, `v${i}`, "big", i, i, `b${i}`);
  db.exec("COMMIT");
  for (let k = 0; k < 20; k++) {
    file(db, `o${k}`, 3, "x");
    for (let i = 1; i <= 3; i++) ver(db, `o${k}_${i}`, `o${k}`, i, i, "x");
  }
  const t0 = performance.now();
  db.exec(unique);
  const ms = performance.now() - t0;
  console.log(`MEASURE migration 0007 on a file with 5001 versions and 20 clean files: ${ms.toFixed(1)} ms`);
  assert.ok(ms < 1000, `${ms} ms`);
  assert.equal(rows(db, "big").length, 5001);
  assert.deepEqual(
    rows(db, "big")
      .slice(-2)
      .map((r) => r.n),
    [5000, 5001],
  );
});
