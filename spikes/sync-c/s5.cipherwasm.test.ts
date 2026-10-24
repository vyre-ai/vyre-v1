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
  const MARK2 = "URI-MARK-9123";
  const probe = (label, fn) => { try { out[label] = fn(); } catch (e) { out[label] = "ERR " + String(e.message).slice(0, 100); } };
  probe("mc_version", () => { const d = new sqlite3.oo1.DB(":memory:"); const v = d.selectValue("SELECT sqlite3mc_version()"); d.close(); return v; });
  probe("cipher_pragma", () => { const d = new sqlite3.oo1.DB(":memory:"); const v = d.selectValue("PRAGMA cipher"); d.close(); return v; });
  probe("uri_key", () => {
    const d = new sqlite3.oo1.DB("file:/uri.db?cipher=chacha20&key=sekret", "c");
    d.exec("CREATE TABLE t(a); INSERT INTO t VALUES('" + MARK2 + "')"); const b = sqlite3.capi.sqlite3_js_db_export(d.pointer); d.close();
    return { plaintext: Buffer.from(b).includes(MARK2), header_is_sqlite: Buffer.from(b.slice(0, 15)).toString() === "SQLite format 3" };
  });
  probe("pragma_key_file", () => {
    const d = new sqlite3.oo1.DB("/k.db", "c"); d.exec("PRAGMA cipher='chacha20'"); d.exec("PRAGMA key='sekret'");
    d.exec("CREATE TABLE t(a); INSERT INTO t VALUES('" + MARK2 + "')"); const b = sqlite3.capi.sqlite3_js_db_export(d.pointer); d.close();
    return { plaintext: Buffer.from(b).includes(MARK2), header_is_sqlite: Buffer.from(b.slice(0, 15)).toString() === "SQLite format 3" };
  });
  try {
    const f = "/enc.db"; const db = new sqlite3.oo1.DB(f, "c");
    db.exec("PRAGMA key='correct horse'");
    db.exec("CREATE TABLE t(a TEXT); INSERT INTO t VALUES('" + MARK + "');");
    try { db.exec("CREATE VIRTUAL TABLE f USING fts5(x); INSERT INTO f(x) VALUES('hello cipher');"); out.fts5 = db.selectValue("SELECT count(*) FROM f WHERE f MATCH 'hello'") === 1; } catch (e) { out.fts5 = String(e.message).slice(0, 80); }
    db.close();
    const tryOpen = (key) => { try { const d = new sqlite3.oo1.DB(f, "w"); if (key) d.exec("PRAGMA key='" + key + "'"); const v = d.selectValue("SELECT a FROM t"); d.close(); return v === MARK ? "READ" : "other"; } catch (e) { return "rejected:" + String(e.message).slice(0, 40); } };
    out.no_key = tryOpen(null); out.wrong_key = tryOpen("wrong"); out.right_key = tryOpen("correct horse");
    out.encrypted_at_rest = out.no_key.startsWith("rejected") && out.wrong_key.startsWith("rejected") && out.right_key === "READ";
  } catch (e) { out.error = String(e.message).slice(0, 200); }
  metric("s6b.cipher_wasm", out);
  assert.equal(out.loaded, true); assert.equal(out.encrypted_at_rest, true);
});
