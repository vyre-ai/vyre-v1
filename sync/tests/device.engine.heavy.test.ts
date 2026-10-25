// The REAL cipher engine (sqlite-wasm-cipher 2.2.4, chacha20), driven through our adapter and the one ReplicaStore. Proves what the doubles cannot:
// file bytes hold no marker and no SQLite header, a wrong key and no key fail, rekey moves the file to the new key, and the 200k-row reopen is measured on the real engine.
// sqlite-wasm-cipher 2.2.4 is a devDependency of @vyre/sync (the version spike S5 pins) and is on the allowlist.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openCipherOpfs, rekeyCipherOpfs, createReplicaKeyVault, memoryKeyBox, openDeviceReplica } from "../src/device/index.ts";
import type { McModule } from "../src/device/index.ts";

interface Cipher { default: (opts?: { wasmBinary: Uint8Array }) => Promise<RealSqlite3> }
interface RealSqlite3 extends McModule { capi: McModule["capi"] & { sqlite3_js_db_export(ptr: unknown): Uint8Array }; }

/** The installed package directory, found by walking up from this file (a workspace hoists it to the root node_modules). */
function packageDir(): string {
  for (let d = path.dirname(fileURLToPath(import.meta.url)); ; d = path.dirname(d)) {
    const p = path.join(d, "node_modules", "sqlite-wasm-cipher");
    if (fs.existsSync(path.join(p, "package.json"))) return p;
    if (path.dirname(d) === d) throw new Error("sqlite-wasm-cipher is not installed (sync devDependency)");
  }
}

async function loadEngine(): Promise<RealSqlite3> {
  const mod = (await import("sqlite-wasm-cipher")) as unknown as Cipher;
  // Node has no fetch for file URLs: hand the module its wasm bytes.
  const find = (d: string): string | null => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { const r = find(f); if (r) return r; } else if (e.name === "sqlite3.wasm") return f;
    }
    return null;
  };
  const wasm = find(packageDir());
  if (!wasm) throw new Error("sqlite3.wasm not found in the installed package");
  return mod.default({ wasmBinary: new Uint8Array(fs.readFileSync(wasm)) });
}

const key = (n: number): Uint8Array => new Uint8Array(32).fill(n);
const MARK = "CIPHER-MARK-4471-vyre-replica";

test("real engine: bytes at rest hold no marker or SQLite header; wrong key and no key fail; rekey moves the file", async () => {
  const sqlite3 = await loadEngine();
  // The stored bytes: a named in-memory database is one buffer shared by every connection. A holder connection that never sends a key keeps it alive and serializes that raw buffer
  // (for the memdb VFS sqlite3_serialize hands back the stored pages, not decrypted ones). The cipher lives in the wrapper VFS multipleciphers-memdb, which stores into that same buffer.
  const plainUri = "file:/enc.db?vfs=memdb";
  const holder = new sqlite3.oo1.DB(plainUri, "c");
  const open = (k: Uint8Array) => openCipherOpfs({ mod: sqlite3, vfs: "memdb", file: "enc.db", key: k });
  const d = open(key(1));
  d.exec("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT)");
  d.prepare("INSERT INTO t VALUES (?, ?)").run(["a", MARK]);
  assert.equal(d.prepare("SELECT v FROM t WHERE id = ?").get(["a"])?.v, MARK);
  d.close();

  const bytes: Uint8Array = sqlite3.capi.sqlite3_js_db_export((holder as unknown as { pointer: unknown }).pointer);
  // control: the same read of an UNkeyed database does show the marker, so a clean result above is the cipher and not a blind read
  const plain = new sqlite3.oo1.DB("file:/plain.db?vfs=memdb", "c");
  plain.exec(`CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('${MARK}')`);
  const plainBytes: Uint8Array = sqlite3.capi.sqlite3_js_db_export((plain as unknown as { pointer: unknown }).pointer);
  assert.equal(Buffer.from(plainBytes).includes(MARK), true, "control: an unkeyed database holds the marker in its stored bytes");
  assert.equal(Buffer.from(plainBytes.slice(0, 15)).toString(), "SQLite format 3");
  plain.close();
  assert.ok(bytes.length > 0, "the file has content");
  assert.equal(Buffer.from(bytes).includes(MARK), false, "no plaintext marker in the file bytes");
  assert.notEqual(Buffer.from(bytes.slice(0, 15)).toString(), "SQLite format 3", "no SQLite header in the file bytes");

  assert.throws(() => open(key(2)), (e: unknown) => (e as { code?: string }).code === "wrong_key");
  const keyless = new sqlite3.oo1.DB("file:/enc.db?vfs=multipleciphers-memdb", "w");
  try { assert.throws(() => keyless.selectValue("SELECT v FROM t"), "no key cannot read"); } finally { keyless.close(); }

  const live = open(key(1));
  rekeyCipherOpfs(live, key(3));
  live.close();
  assert.throws(() => open(key(1)), (e: unknown) => (e as { code?: string }).code === "wrong_key", "the old key fails after rekey");
  const moved = open(key(3));
  assert.equal(moved.prepare("SELECT v FROM t WHERE id = ?").get(["a"])?.v, MARK, "the new key reads");
  moved.close();
  const after = sqlite3.capi.sqlite3_js_db_export((holder as unknown as { pointer: unknown }).pointer);
  assert.equal(Buffer.from(after).includes(MARK), false, "still no plaintext after rekey");
  holder.close();
});

test("real engine: a 200k-row replica reopens through the device path under the startup slice", async () => {
  const sqlite3 = await loadEngine();
  const vault = createReplicaKeyVault(memoryKeyBox());
  const base = { target: "web" as const, spaceId: "spc_real", deviceId: "dev_1", vault, personKey: key(5), openers: { sqlite3mc: { mod: sqlite3, vfs: null } }, registryHash: "hash-real", personId: "prs_me" };
  const seed = await openDeviceReplica(base);
  const ins = seed.driver.prepare('INSERT INTO "calendar_event" (id, calendarId, title) VALUES (?, ?, ?)');
  const t0 = performance.now();
  seed.driver.transaction(() => { for (let i = 0; i < 200_000; i++) ins.run([`evt_${i}`, `cal_${i % 50}`, `Event ${i}`]); });
  const seedMs = performance.now() - t0;
  await seed.store.close();

  const opens: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await openDeviceReplica(base);
    const row = r.store.read("calendar_event", "evt_199999");
    assert.equal(row?.title, "Event 199999");
    opens.push(r.openMs);
    await r.store.close();
  }
  opens.sort((a, b) => a - b);
  const median = opens[1] ?? 0;
  // The measurement is the assertion message when it fails and the ok line when it holds: median open must stay under half of the 1000 ms app.usable budget.
  assert.ok(median < 500, `real engine reopen median ${median.toFixed(1)} ms (seed ${seedMs.toFixed(0)} ms) is over 500 ms`);
});
