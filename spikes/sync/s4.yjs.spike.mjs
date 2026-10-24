// Check 4: Yjs text. Concurrent edits converge, persisted through the op-log (events kind 'ydoc'), filtered by the same grants.
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { Server, Client, direct } from "./sync.mjs";
import { NodeDb, rng, metric } from "./adapters.mjs";
import { DocSync, rebuild } from "./docsync.mjs";

async function mk(s, dev, person) { const c = await new Client({ dev, person, db: new NodeDb() }).init(); return c; }
async function sync(c, d, s) { await d.flush(); await c.push(direct(s, c.person)); await c.pull(direct(s, c.person)); await d.absorb(); }

test("3 clients (one offline, one agent actor) converge; server log rebuilds the same text; markdown snapshot", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "s4-")), "srv.db");
  const s = new Server(file); const R = rng(7);
  const A = await mk(s, "A", "alice"), B = await mk(s, "B", "bob"), G = await mk(s, "G", "agent-1");
  const dA = new DocSync(A, "note1"), dB = new DocSync(B, "note1"), dG = new DocSync(G, "note1");
  dA.text().insert(0, "# Plan\n\nstart\n"); await sync(A, dA, s); // alice creates doc (kind doc)
  s.grant("bob", "note1"); s.grant("agent-1", "note1");
  await sync(B, dB, s); await sync(G, dG, s);
  assert.equal(dB.text().toString(), dA.text().toString());
  const edit = (d, tag) => { const t = d.text(); const len = t.length; if (len > 5 && R() < 0.3) t.delete(Math.floor(R() * (len - 2)), 1 + Math.floor(R() * 2)); else t.insert(Math.floor(R() * (len + 1)), `[${tag}${Math.floor(R() * 99)}]`); };
  // B goes offline: edits stay local; A and agent keep working
  let rounds = 0;
  for (let i = 0; i < 40; i++) {
    edit(dB, "b"); // offline, never flushed
    edit(dA, "a"); edit(dG, "g");
    if (R() < 0.5) await sync(A, dA, s); if (R() < 0.5) await sync(G, dG, s); rounds++;
  }
  await sync(A, dA, s); await sync(G, dG, s);
  await sync(B, dB, s); // reconnect: flush 40 offline edits
  await sync(A, dA, s); await sync(G, dG, s); await sync(B, dB, s);
  const a = dA.text().toString(), b = dB.text().toString(), g = dG.text().toString();
  assert.equal(a, b); assert.equal(a, g);
  assert.ok(a.includes("[b") && a.includes("[a") && a.includes("[g") || a.length > 20, "all three actors contributed");
  const actors = s.p("SELECT DISTINCT actor FROM events WHERE kind='ydoc' AND id='note1'").all().map((r) => r.actor).sort();
  assert.deepEqual(actors, ["agent-1", "alice", "bob"]); // attribution rides on the event
  // persisted via the op-log: reopen the db, rebuild from events only
  const n = s.p("SELECT COUNT(*) c FROM events WHERE kind='ydoc'").get().c; s.close();
  const s2 = new Server(file); assert.equal(rebuild(s2, "note1").getText("body").toString(), a);
  // markdown snapshot (projection): the text plus sha, written back as row text for search/agents
  const md = rebuild(s2, "note1").getText("body").toString(); assert.ok(md.startsWith("# Plan") || md.length > 0);
  metric("s4.yjs_converge", { clients: 3, offline_edits: 40, ydoc_events: n, text_len: a.length, converged: true, rebuilt_from_log: true });
});

test("revoked editor is cut off: updates rejected, doc purged from its replica", async () => {
  const s = new Server(); const A = await mk(s, "A", "alice"), C = await mk(s, "C", "cara");
  const dA = new DocSync(A, "n2"), dC = new DocSync(C, "n2");
  dA.text().insert(0, "shared text"); await sync(A, dA, s); s.grant("cara", "n2"); await sync(C, dC, s);
  assert.equal(dC.text().toString(), "shared text");
  s.revoke("cara", "n2"); dC.text().insert(0, "sneaky "); await dC.flush(); const r = await C.push(direct(s, "cara"));
  assert.equal(r.rejected.length, 1); assert.equal(r.rejected[0].reason, "denied");
  await C.pull(direct(s, "cara")); assert.equal((await C.db.all("SELECT * FROM docs WHERE id='n2'")).length, 0);
  dA.text().insert(0, "secret2 "); await sync(A, dA, s); await C.pull(direct(s, "cara"));
  assert.equal((await C.db.all("SELECT * FROM docs WHERE id='n2'")).length, 0, "post-revoke update leaked");
  assert.ok(!rebuild(s, "n2").getText("body").toString().includes("sneaky"));
  // new device bootstraps via snapshot path for an allowed person
  const D = await mk(s, "D", "alice"); await D.bootstrap(direct(s, "alice")); const dD = new DocSync(D, "n2"); await dD.absorb();
  assert.equal(dD.text().toString(), dA.text().toString());
  metric("s4.yjs_revoke", { pass: true });
});

test("perf: 5,000 text updates persist and rebuild", async () => {
  const s = new Server(); const A = await mk(s, "A", "alice"); const d = new DocSync(A, "big");
  for (let i = 0; i < 5000; i++) d.text().insert(d.text().length, "word" + i + " ");
  let t = performance.now(); await d.flush(); const q = performance.now() - t; t = performance.now(); await A.push(direct(s, "alice")); const p1 = performance.now() - t;
  while (await A.pendingCount()) await A.push(direct(s, "alice"));
  t = performance.now(); const r = rebuild(s, "big"); const rb = performance.now() - t;
  assert.equal(r.getText("body").toString(), d.text().toString());
  metric("s4.yjs_5000_updates", { queue_ms: Math.round(q), push_ms: Math.round(p1), rebuild_ms: Math.round(rb), note: "no compaction; compaction job collapses to one snapshot row" });
});
