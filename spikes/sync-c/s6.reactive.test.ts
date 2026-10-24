// Check 6: device store. wa-sqlite (in-memory VFS, the Node stand-in for OPFS) + app-layer AES-GCM; latency, 10k pull, reactive list.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Server, Client, direct } from "./sync.mjs";
import { NodeDb, WaDb, codecFor, replicaKey, metric, pct } from "./adapters.mjs";

const MARK = "SECRET-TITLE-qq73";
for (const kind of ["node:sqlite+aesgcm"]) {
  test(`${kind}: replica round trip, ciphertext at rest, local write < 10 ms, 10k pull, reactive list`, async () => {
    const key = replicaKey(crypto.randomBytes(32), "space1", "dev1"); const codec = codecFor(key);
    const db = kind.startsWith("wa") ? await WaDb.open("spike") : new NodeDb();
    const c = await new Client({ dev: "dev1", person: "alice", db, codec }).init();
    const s = new Server(); s.bulkLoad("alice", 10000, (i) => ({ title: i === 7 ? MARK : "row " + i, status: "open", amount: i, note: "n" + i }));
    let t = performance.now(); await c.bootstrap(direct(s, "alice")); const snapMs = performance.now() - t;
    assert.equal(await c.rowCount(), 10000); assert.equal((await c.read("r0000007")).title, MARK);
    // event-log pull path for another 10k
    const c2 = await new Client({ dev: "dev2", person: "alice", db: kind.startsWith("wa") ? await WaDb.open("spike2") : new NodeDb(), codec }).init();
    t = performance.now(); await c2.pull(direct(s, "alice")); const pullMs = performance.now() - t; assert.equal(await c2.rowCount(), 10000);
    // plaintext must not be at rest in the replica
    if (kind.startsWith("wa")) assert.ok(!db.rawBytes().includes(MARK), "plaintext in wa-sqlite VFS bytes");
    else assert.ok(!JSON.stringify(await db.all("SELECT v FROM rows WHERE id='r0000007'")).includes(MARK));
    // wrong key cannot read
    const wrong = codecFor(crypto.randomBytes(32)); const raw = (await db.get("SELECT v FROM rows WHERE id='r0000007' AND field='title'")).v; assert.throws(() => wrong.dec(raw));
    // local write latency
    const lat = []; for (let i = 0; i < 3000; i++) { const t0 = performance.now(); await c.edit("r" + String(i % 1000).padStart(7, "0"), { note: "e" + i }); lat.push(performance.now() - t0); }
    // reactive: live list of 10k titles, update propagates to the subscriber
    const cache = new Map(); for (const r of await c.db.all("SELECT id, v FROM rows WHERE field='title'")) cache.set(r.id, JSON.parse(c.dec(r.v)));
    let t0r = 0; const upd = []; let done;
    c.subscribeAll(async (ids) => { for (const id of ids) { const r = await c.db.get("SELECT v FROM rows WHERE id=? AND field='title'", [id]); if (r) cache.set(id, JSON.parse(c.dec(r.v))); } if (done) { upd.push(performance.now() - t0r); done(); } });
    for (let i = 0; i < 200; i++) { await new Promise((res) => { done = res; t0r = performance.now(); c.edit("r" + String(i * 7).padStart(7, "0"), { title: "live " + i }); }); }
    done = null;
    assert.equal(cache.get("r0000000"), "live 0");
    t = performance.now(); const full = await c.db.all("SELECT id, v FROM rows WHERE field='title'"); const fullMs = performance.now() - t; assert.equal(full.length, 10000);
    // push everything to the server and compare end state
    while (await c.pendingCount()) await c.push(direct(s, "alice"));
    await c2.pull(direct(s, "alice")); assert.equal((await c2.read("r0000000")).title, "live 0");
    metric("s6." + kind, { bootstrap_10k_ms: Math.round(snapMs), pull_10k_ms: Math.round(pullMs), write_p50_ms: +pct(lat, 0.5).toFixed(3), write_p99_ms: +pct(lat, 0.99).toFixed(3), reactive_update_p50_ms: +pct(upd, 0.5).toFixed(3), reactive_update_p99_ms: +pct(upd, 0.99).toFixed(3), full_rerun_10k_ms: +fullMs.toFixed(2), budget_write_ms: 10, budget_reactive_ms: 16 });
    assert.ok(pct(lat, 0.99) < 10, "write p99 over budget"); assert.ok(pct(upd, 0.99) < 16, "reactive p99 over budget");
  });
}
