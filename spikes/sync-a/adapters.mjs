// Device DB adapters: node:sqlite and wa-sqlite (in-memory VFS, the OPFS-equivalent for Node), plus the app-layer AES-GCM codec.
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export class NodeDb {
  constructor(file = ":memory:") { this.db = new DatabaseSync(file); this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;"); this.c = new Map(); }
  p(sql) { let s = this.c.get(sql); if (!s) { s = this.db.prepare(sql); this.c.set(sql, s); } return s; }
  exec(sql) { this.db.exec(sql); }
  run(sql, params = []) { this.p(sql).run(...params); }
  all(sql, params = []) { return this.p(sql).all(...params).map((r) => ({ ...r })); }
  get(sql, params = []) { const r = this.p(sql).get(...params); return r ? { ...r } : undefined; }
  close() { this.db.close(); }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export class WaDb {
  static async open(name = "spike") {
    const base = path.join(HERE, "node_modules/wa-sqlite");
    const { default: Factory } = await import(pathToFileURL(path.join(base, "dist/wa-sqlite.mjs")).href);
    const SQLite = await import(pathToFileURL(path.join(base, "src/sqlite-api.js")).href);
    const { MemoryVFS } = await import(pathToFileURL(path.join(base, "src/examples/MemoryVFS.js")).href);
    const fs = await import("node:fs");
    const module = await Factory({ wasmBinary: fs.readFileSync(path.join(base, "dist/wa-sqlite.wasm")) });
    const sqlite3 = SQLite.Factory(module);
    const vfs = new MemoryVFS(); sqlite3.vfs_register(vfs, true);
    const h = await sqlite3.open_v2(name);
    const d = new WaDb(); d.sqlite3 = sqlite3; d.SQLite = SQLite; d.h = h; d.vfs = vfs; d.cache = new Map();
    return d;
  }
  async exec(sql) { await this.sqlite3.exec(this.h, sql); }
  async query(sql, params = []) {
    const out = [];
    for await (const stmt of this.sqlite3.statements(this.h, sql)) {
      if (params.length) this.sqlite3.bind_collection(stmt, params);
      const cols = this.sqlite3.column_names(stmt);
      while ((await this.sqlite3.step(stmt)) === this.SQLite.SQLITE_ROW) { const r = this.sqlite3.row(stmt); const o = {}; cols.forEach((c, i) => (o[c] = r[i])); out.push(o); }
    }
    return out;
  }
  async run(sql, params = []) { await this.query(sql, params); }
  async all(sql, params = []) { return this.query(sql, params); }
  async get(sql, params = []) { return (await this.query(sql, params))[0]; }
  // raw bytes of every file in the VFS, for the plaintext-on-disk check
  rawBytes() { const bufs = []; for (const f of this.vfs.mapNameToFile.values()) bufs.push(Buffer.from(f.data instanceof ArrayBuffer ? f.data : f.data.buffer ?? f.data)); return Buffer.concat(bufs); }
}

// App-layer encryption: AES-256-GCM, key derived HKDF(personKey, "replica" || space || device).
export function replicaKey(personKey, space, device) { return Buffer.from(crypto.hkdfSync("sha256", personKey, Buffer.alloc(0), `replica|${space}|${device}`, 32)); }
export function codecFor(key) {
  return {
    enc(s) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", key, iv); const ct = Buffer.concat([c.update(s, "utf8"), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64"); },
    dec(s) { const b = Buffer.from(s, "base64"); const d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"); },
  };
}
// E2E keys: values travel as ciphertext the server orders but cannot read.
export function e2eKeys(personKey, keyId = "k1") {
  const key = Buffer.from(crypto.hkdfSync("sha256", personKey, Buffer.alloc(0), `item|${keyId}`, 32));
  return {
    enc(s) { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", key, iv); const ct = Buffer.concat([c.update(s, "utf8"), c.final(), c.getAuthTag()]); return { ct: ct.toString("base64"), key: keyId, nonce: iv.toString("base64") }; },
    dec(ct, _key, nonce) { const b = Buffer.from(ct, "base64"); const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64")); d.setAuthTag(b.subarray(b.length - 16)); return Buffer.concat([d.update(b.subarray(0, b.length - 16)), d.final()]).toString("utf8"); },
  };
}
export const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const metric = (name, obj) => console.log("METRIC " + JSON.stringify({ name, ...obj }));
export const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };
