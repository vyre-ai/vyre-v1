// Runs inside headless Chrome: sqlite3 multiple ciphers WASM on an OPFS SAH-pool VFS with an encryption key.
import sqlite3InitModule from "/sqlite/index.mjs";
const post = (m) => postMessage(m);
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)];
try {
  const out = { crossOriginIsolated: self.crossOriginIsolated };
  const sqlite3 = await sqlite3InitModule();
  out.version = sqlite3.version.libVersion;
  // Which VFS can carry a key? Record every candidate, then use the first that works.
  out.capi_mc = Object.keys(sqlite3.capi).filter((k) => /mc|multiple|cipher/i.test(k)).slice(0, 20);
  await sqlite3.installOpfsSAHPoolVfs({ name: "vyre-spike", clearOnInit: true });
  out.mc_create = {};
  for (const n of ["opfs", "vyre-spike"]) { try { out.mc_create[n] = sqlite3.capi.sqlite3mc_vfs_create(n, 0); } catch (e) { out.mc_create[n] = String(e.message).slice(0, 80); } }
  out.vfs_found = {};
  for (const n of ["opfs", "vyre-spike", "multipleciphers-opfs", "multipleciphers-vyre-spike"]) out.vfs_found[n] = !!sqlite3.capi.sqlite3_vfs_find(n);
  const tryVfs = (vfs) => { try { const d = new sqlite3.oo1.DB({ filename: "file:/probe-" + vfs + ".db?vfs=" + vfs, flags: "c" }); d.exec("PRAGMA cipher='chacha20'; PRAGMA key='k'; CREATE TABLE t(a); INSERT INTO t VALUES(1)"); d.close(); return "key ok"; } catch (e) { return String(e.message).slice(0, 100); } };
  out.key_by_vfs = {}; let chosen = null;
  for (const n of Object.keys(out.vfs_found)) if (out.vfs_found[n]) { out.key_by_vfs[n] = tryVfs(n); if (out.key_by_vfs[n] === "key ok" && !chosen) chosen = n; }
  out.vfs = chosen;
  if (!chosen) { post({ ok: false, error: "no OPFS VFS accepted a key: " + JSON.stringify(out) }); throw new Error("stop"); }
  const pool = { OpfsSAHPoolDb: class extends sqlite3.oo1.DB { constructor(f) { super({ filename: "file:" + f + "?vfs=" + chosen, flags: "c" }); } } };
  const N = 200000, KEY = "correct horse";
  let t = performance.now();
  let db = new pool.OpfsSAHPoolDb("/enc.db");
  db.exec("PRAGMA cipher='chacha20'; PRAGMA key='" + KEY + "'");
  db.exec("CREATE TABLE rows(id INTEGER PRIMARY KEY, title TEXT, amount INTEGER)");
  db.exec("BEGIN");
  const ins = db.prepare("INSERT INTO rows(title, amount) VALUES(?, ?)");
  for (let i = 0; i < N; i++) { ins.bind([i === 7 ? "SECRET-TITLE-qq73" : "row " + i, i]).stepReset(); }
  ins.finalize(); db.exec("COMMIT"); db.close();
  out.insert_200k_ms = Math.round(performance.now() - t);
  // Reopen with the key: all rows readable, timed query over 200k rows.
  t = performance.now();
  db = new pool.OpfsSAHPoolDb("/enc.db"); db.exec("PRAGMA cipher='chacha20'; PRAGMA key='" + KEY + "'");
  out.open_ms = Math.round(performance.now() - t);
  t = performance.now();
  out.count = db.selectValue("SELECT count(*) FROM rows");
  out.sum = db.selectValue("SELECT sum(amount) FROM rows WHERE title LIKE 'row 1%'");
  const all = db.selectArrays("SELECT id, title FROM rows");
  out.query_200k_ms = Math.round(performance.now() - t); out.query_rows = all.length;
  // Reactive list of 10k rows: update one row, refresh that row only, patch the cached list.
  const cache = new Map(db.selectArrays("SELECT id, title FROM rows WHERE id <= 10000"));
  const upd = [];
  for (let i = 0; i < 300; i++) {
    const id = 1 + i * 7, t0 = performance.now();
    db.exec({ sql: "UPDATE rows SET title=? WHERE id=?", bind: ["live " + i, id] });
    cache.set(id, db.selectValue("SELECT title FROM rows WHERE id=?", [id]));
    upd.push(performance.now() - t0);
  }
  out.reactive_list = cache.size; out.reactive_p50_ms = +pct(upd, 0.5).toFixed(3); out.reactive_p99_ms = +pct(upd, 0.99).toFixed(3);
  t = performance.now(); db.selectArrays("SELECT id, title FROM rows WHERE id <= 10000"); out.full_rerun_10k_ms = Math.round(performance.now() - t);
  db.close();
  // At rest: no key and a wrong key are rejected; the OPFS file does not hold the plaintext marker.
  const tryOpen = (key) => { try { const d = new pool.OpfsSAHPoolDb("/enc.db"); if (key) d.exec("PRAGMA cipher='chacha20'; PRAGMA key='" + key + "'"); const v = d.selectValue("SELECT count(*) FROM rows"); d.close(); return "READ " + v; } catch (e) { return "rejected"; } };
  out.no_key = tryOpen(null); out.wrong_key = tryOpen("wrong");
  let leaked = false;
  const root = await navigator.storage.getDirectory();
  async function scan(dir) { for await (const [, h] of dir.entries()) { if (h.kind === "directory") await scan(h); else { const f = await h.getFile(); const txt = new TextDecoder("latin1").decode(new Uint8Array(await f.arrayBuffer())); if (txt.includes("SECRET-TITLE-qq73")) leaked = true; } } }
  await scan(root);
  out.plaintext_in_opfs = leaked;
  post({ ok: true, out });
} catch (e) { if (String(e.message) !== "stop") post({ ok: false, error: String(e && e.stack || e).slice(0, 800) }); }
