// The speed half of device.engine.heavy.test.ts (split out so only this file is a perf file, ruling 46); its functional tests stay in the original file and run on every PR.
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
