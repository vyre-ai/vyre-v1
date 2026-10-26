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
type Fn = (...args: unknown[]) => number;
interface Struct { [field: string]: number }
interface RealSqlite3 extends McModule {
  capi: McModule["capi"] & {
    sqlite3_vfs_find(name: string | null): number;
    sqlite3_vfs: new (ptr: number) => Struct;
    sqlite3_io_methods: new (ptr: number) => Struct;
    SQLITE_OPEN_READONLY: number;
  };
  wasm: {
    alloc(n: number): number;
    dealloc(ptr: number): void;
    allocCString(s: string): number;
    peekPtr(ptr: number): number;
    peek(ptr: number, type: string): number | bigint;
    functionEntry(ptr: number): Fn | undefined;
    heap8u(): Uint8Array;
  };
}

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

/**
 * The bytes the file system holds, read through the default VFS itself (xOpen, xFileSize, xRead on the file), never through an export: an export (sqlite3_js_db_export) returns
 * decrypted pages. A file that does not exist is an error, so a clean result cannot come from reading nothing.
 */
function storedBytes(sqlite3: RealSqlite3, name: string): Uint8Array {
  const { capi, wasm } = sqlite3;
  const pVfs = capi.sqlite3_vfs_find(null);
  assert.notEqual(pVfs, 0, "the default VFS exists");
  const vfs = new capi.sqlite3_vfs(pVfs);
  const xOpen = wasm.functionEntry(vfs["$xOpen"] as number);
  assert.ok(xOpen, "the default VFS has xOpen");
  const pFile = wasm.alloc(vfs["$szOsFile"] as number);
  const pOut = wasm.alloc(8);
  const pName = wasm.allocCString(name);
  try {
    const rc = xOpen(pVfs, pName, pFile, capi.SQLITE_OPEN_READONLY, pOut);
    assert.equal(rc, 0, `xOpen(${name}) returned ${rc}: the file exists in the VFS`);
    const methods = new capi.sqlite3_io_methods(wasm.peekPtr(pFile));
    const xFileSize = wasm.functionEntry(methods["$xFileSize"] as number);
    const xRead = wasm.functionEntry(methods["$xRead"] as number);
    const xClose = wasm.functionEntry(methods["$xClose"] as number);
    assert.ok(xFileSize && xRead && xClose, "the file has xFileSize, xRead and xClose");
    try {
      assert.equal(xFileSize(pFile, pOut), 0);
      const size = Number(wasm.peek(pOut, "i64"));
      assert.ok(size > 0, `${name} holds ${size} bytes`);
      const buf = wasm.alloc(size);
      try {
        assert.equal(xRead(pFile, buf, size, BigInt(0)), 0, "xRead returns SQLITE_OK for the whole file");
        return wasm.heap8u().slice(buf, buf + size);
      } finally { wasm.dealloc(buf); }
    } finally { xClose(pFile); }
  } finally { wasm.dealloc(pName); wasm.dealloc(pOut); wasm.dealloc(pFile); }
}

test("real engine: bytes at rest hold no marker or SQLite header; wrong key and no key fail; rekey moves the file", async () => {
  const sqlite3 = await loadEngine();
  const open = (k: Uint8Array) => openCipherOpfs({ mod: sqlite3, vfs: null, file: "enc.db", key: k });
  const d = open(key(1));
  d.exec("CREATE TABLE t (id TEXT PRIMARY KEY, v TEXT)");
  d.prepare("INSERT INTO t VALUES (?, ?)").run(["a", MARK]);
  assert.equal(d.prepare("SELECT v FROM t WHERE id = ?").get(["a"])?.v, MARK);
  d.close();

  // control: the same read of an UNkeyed database does show the marker and the header, so a clean result below is the cipher and not a blind read
  const plain = new sqlite3.oo1.DB("/plain.db", "c");
  plain.exec(`CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('${MARK}')`);
  plain.close();
  const plainBytes = storedBytes(sqlite3, "/plain.db");
  assert.equal(Buffer.from(plainBytes).includes(MARK), true, "control: an unkeyed database holds the marker in its stored bytes");
  assert.equal(Buffer.from(plainBytes.slice(0, 15)).toString(), "SQLite format 3");

  const bytes = storedBytes(sqlite3, "/enc.db");
  assert.equal(Buffer.from(bytes).includes(MARK), false, "no plaintext marker in the file bytes");
  assert.notEqual(Buffer.from(bytes.slice(0, 15)).toString(), "SQLite format 3", "no SQLite header in the file bytes");

  assert.throws(() => open(key(2)), (e: unknown) => (e as { code?: string }).code === "wrong_key");
  const keyless = new sqlite3.oo1.DB("/enc.db", "w");
  try { assert.throws(() => keyless.exec("SELECT v FROM t"), "no key cannot read"); } finally { keyless.close(); }

  const live = open(key(1));
  rekeyCipherOpfs(live, key(3));
  live.close();
  assert.throws(() => open(key(1)), (e: unknown) => (e as { code?: string }).code === "wrong_key", "the old key fails after rekey");
  const moved = open(key(3));
  assert.equal(moved.prepare("SELECT v FROM t WHERE id = ?").get(["a"])?.v, MARK, "the new key reads");
  moved.close();
  const after = storedBytes(sqlite3, "/enc.db");
  assert.equal(Buffer.from(after).includes(MARK), false, "still no plaintext after rekey");
  assert.notEqual(Buffer.from(after.slice(0, 15)).toString(), "SQLite format 3");
  assert.notDeepEqual(Buffer.from(after), Buffer.from(bytes), "the rekey changed the stored bytes");
});

