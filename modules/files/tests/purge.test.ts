// P-CC_39: files.versions.purge removes old unnamed versions past the cutoff, never a file's newest version, never a named one, never a file listed in skipFileIds (held), oldest first in batches. The blob
// a removed version held is released and goes with its last reference.
// @reads /modules/files/migrations/0001_files_tree.sql
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { open } from "../fixtures/lists-world.ts";

const DAY = 86_400_000;
const NOW = 1_760_000_000_000;

function seed(w: ReturnType<typeof open>): void {
  const blob = (id: string, refs: number) => w.ctx.db.run(`INSERT INTO files_blob (id, hash, size, mime, key_id, nonce, bytes, scope, created_at, refs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, `h_${id}`, 1, "text/plain", "k", "n", "b", "s", 1, refs);
  const ver = (id: string, file: string, n: number, blobId: string, at: number, name: string | null) => w.ctx.db.run(
    `INSERT INTO files_file_version (id, file_id, n, blob, actor, reason, name, at, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, file, n, blobId, "usr_a", null, name, at, 1, at, null);
  for (const b of ["b1", "b2", "b3", "b4", "b5", "b6", "b7"]) blob(`blb_${b}`, 1);
  // f1: three old versions; n=2 is named, n=3 is the newest
  ver("ver_f1n1", "fil_f1", 1, "blb_b1", NOW - 400 * DAY, null);
  ver("ver_f1n2", "fil_f1", 2, "blb_b2", NOW - 399 * DAY, "Signed copy");
  ver("ver_f1n3", "fil_f1", 3, "blb_b3", NOW - 398 * DAY, null);
  // f2 is held: its old versions stay
  ver("ver_f2n1", "fil_f2", 1, "blb_b4", NOW - 400 * DAY, null);
  ver("ver_f2n2", "fil_f2", 2, "blb_b5", NOW - 399 * DAY, null);
  // f3 is young
  ver("ver_f3n1", "fil_f3", 1, "blb_b6", NOW - 2 * DAY, null);
  ver("ver_f3n2", "fil_f3", 2, "blb_b7", NOW - 1 * DAY, null);
}

const versions = (w: ReturnType<typeof open>): string[] => w.db.rows("files_file_version").map((r) => String(r["id"])).sort();
const blobs = (w: ReturnType<typeof open>): string[] => w.db.rows("files_blob").map((r) => String(r["id"])).sort();
const purge = (w: ReturnType<typeof open>, input: Record<string, unknown>) => (handlers as Record<string, (c: unknown, i: unknown) => Promise<unknown>>)["files.versions.purge"]!(w.ctx, { idempotencyKey: "k", ...input });

test("old unnamed versions go, the newest, the named and the young stay, a held file is left whole, and the blobs follow", async () => {
  const w = open();
  seed(w);
  const out = await purge(w, { before: NOW - 30 * DAY, skipFileIds: ["fil_f2"] });
  assert.deepEqual(out, { removed: 1, more: false });
  assert.deepEqual(versions(w), ["ver_f1n2", "ver_f1n3", "ver_f2n1", "ver_f2n2", "ver_f3n1", "ver_f3n2"]);
  assert.ok(!blobs(w).includes("blb_b1"), "the removed version's blob is released");
  assert.ok(blobs(w).includes("blb_b2") && blobs(w).includes("blb_b4"));
  assert.deepEqual(w.events.map((e) => [e.name, e.payload]), [["file_versions.purged", { removed: 1 }]]);
});

test("without a hold list the held file's old version goes too; batches go oldest first and say when more is left", async () => {
  const w = open();
  seed(w);
  const first = await purge(w, { before: NOW - 30 * DAY, limit: 1 });
  assert.deepEqual(first, { removed: 1, more: true });
  const second = await purge(w, { before: NOW - 30 * DAY, limit: 1 });
  assert.deepEqual(second, { removed: 1, more: false });
  assert.deepEqual(versions(w), ["ver_f1n2", "ver_f1n3", "ver_f2n2", "ver_f3n1", "ver_f3n2"]);
  assert.deepEqual(await purge(w, { before: NOW - 30 * DAY }), { removed: 0, more: false });
});
