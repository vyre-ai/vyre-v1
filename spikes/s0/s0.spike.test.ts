// S0: node:sqlite capabilities Vyre v1 depends on. Run on CI: node --test spikes/s0/s0.spike.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, backup } from "node:sqlite";
import { Worker } from "node:worker_threads";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const metric = (name: string, o: object) => console.log("METRIC " + JSON.stringify({ name, ...o }));

test("FTS5 with bm25 ranking", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE VIRTUAL TABLE d USING fts5(title, body, tokenize='unicode61 remove_diacritics 2')");
  const ins = db.prepare("INSERT INTO d(title, body) VALUES(?,?)");
  ins.run("invoice", "invoice invoice for the retainer"); ins.run("notes", "meeting notes mention an invoice once"); ins.run("café", "menu");
  const rows = db.prepare("SELECT title, bm25(d) AS s FROM d WHERE d MATCH ? ORDER BY bm25(d)").all("invoice") as any[];
  assert.equal(rows[0].title, "invoice"); assert.ok(rows[0].s < rows[1].s);
  assert.equal((db.prepare("SELECT count(*) c FROM d WHERE d MATCH 'cafe'").get() as any).c, 1); // diacritics folded
  metric("s0.fts5_bm25", { ok: true, top: rows[0].title });
});

test("JSON functions", () => {
  const db = new DatabaseSync(":memory:");
  const r = db.prepare(`SELECT json_extract('{"a":{"b":[1,2,3]}}','$.a.b[1]') x, json_array_length('[1,2,3]') n, json_set('{"a":1}','$.b',2) s, (SELECT group_concat(value) FROM json_each('[4,5]')) e, json_valid('{') bad`).get() as any;
  assert.equal(r.x, 2); assert.equal(r.n, 3); assert.equal(r.s, '{"a":1,"b":2}'); assert.equal(r.e, "4,5"); assert.equal(r.bad, 0);
  metric("s0.json", { ok: true });
});

test("DatabaseSync inside a worker thread (own connection, WAL file shared with main)", async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "s0-")), "w.db");
  const main = new DatabaseSync(f); main.exec("PRAGMA journal_mode=WAL; CREATE TABLE t(n)"); main.prepare("INSERT INTO t VALUES(1)").run();
  const code = `const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync(workerData);db.prepare('INSERT INTO t VALUES(2)').run();parentPort.postMessage(db.prepare('SELECT count(*) c FROM t').get().c);db.close();`;
  const c = await new Promise<number>((res, rej) => { const w = new Worker(code, { eval: true, workerData: f }); w.on("message", res); w.on("error", rej); });
  assert.equal(c, 2); assert.equal((main.prepare("SELECT count(*) c FROM t").get() as any).c, 2);
  metric("s0.worker_thread", { ok: true });
});

test("backup API copies a live database", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "s0b-")); const src = new DatabaseSync(path.join(dir, "a.db"));
  src.exec("CREATE TABLE t(n); BEGIN"); const ins = src.prepare("INSERT INTO t VALUES(?)"); for (let i = 0; i < 20000; i++) ins.run(i); src.exec("COMMIT");
  const pages = await backup(src, path.join(dir, "b.db"), { rate: 50 });
  const dst = new DatabaseSync(path.join(dir, "b.db")); assert.equal((dst.prepare("SELECT count(*) c FROM t").get() as any).c, 20000);
  metric("s0.backup", { ok: true, pages });
});

test("50k inserts/s batched (file db, WAL)", () => {
  const db = new DatabaseSync(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "s0i-")), "i.db")); db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; CREATE TABLE e(id INTEGER PRIMARY KEY, a TEXT, b TEXT)");
  const ins = db.prepare("INSERT INTO e(a,b) VALUES(?,?)"); const N = 200000; const t = performance.now();
  for (let k = 0; k < N; k += 1000) { db.exec("BEGIN"); for (let i = 0; i < 1000; i++) ins.run("a" + i, "payload " + i); db.exec("COMMIT"); }
  const rate = N / ((performance.now() - t) / 1000);
  metric("s0.insert_rate", { per_s: Math.round(rate), budget: 50000, pass: rate >= 50000 });
  assert.ok(rate >= 50000, `only ${Math.round(rate)}/s`);
});
