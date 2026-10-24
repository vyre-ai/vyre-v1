// Check 6c: SQLite3 Multiple Ciphers WASM (sqlite-wasm-cipher) - encryption inside the engine, FTS5. Exploratory: records what works.
import test from "node:test";
import assert from "node:assert/strict";
import { metric } from "./adapters.mjs";

test("sqlite-wasm-cipher: opens, encrypts file pages with a key, has FTS5", async () => {
  const out = { loaded: false };
  let mod;
  try { mod = await import("sqlite-wasm-cipher"); out.loaded = true; out.exports = Object.keys(mod).join(","); } catch (e) { out.load_error = String(e.message).slice(0, 200); metric("s6b.cipher_wasm", out); throw e; }
  const init = mod.default;
  const sqlite3 = await init();
  out.version = sqlite3.version.libVersion;
  const MARK = "CIPHER-MARK-4471";
  try {
    const db = new sqlite3.oo1.DB("/enc.db", "c");
    try { db.exec("PRAGMA key='correct horse'"); out.pragma_key = "ok"; } catch (e) { out.pragma_key = String(e.message).slice(0, 120); }
    db.exec("CREATE TABLE t(a TEXT); INSERT INTO t VALUES('" + MARK + "');");
    try { db.exec("CREATE VIRTUAL TABLE f USING fts5(x); INSERT INTO f(x) VALUES('hello cipher'); "); out.fts5 = db.selectValue("SELECT count(*) FROM f WHERE f MATCH 'hello'") === 1; } catch (e) { out.fts5 = String(e.message).slice(0, 80); }
    const bytes = sqlite3.capi.sqlite3_js_db_export(db.pointer); out.export_bytes = bytes.length;
    out.plaintext_in_pages = Buffer.from(bytes).includes(MARK);
    db.close();
    // reopen with wrong key
    sqlite3.capi.sqlite3_js_posix_create_file?.("/enc2.db", bytes);
    try { const d2 = new sqlite3.oo1.DB("/enc2.db", "w"); d2.exec("PRAGMA key='wrong'"); d2.selectValue("SELECT count(*) FROM t"); out.wrong_key = "READ_OK_BAD"; d2.close(); } catch (e) { out.wrong_key = "rejected"; }
    try { const d3 = new sqlite3.oo1.DB("/enc2.db", "w"); d3.exec("PRAGMA key='correct horse'"); out.right_key_reads = d3.selectValue("SELECT a FROM t") === MARK; d3.close(); } catch (e) { out.right_key_reads = String(e.message).slice(0, 80); }
  } catch (e) { out.error = String(e.message).slice(0, 200); }
  metric("s6b.cipher_wasm", out);
  assert.equal(out.loaded, true);
});
