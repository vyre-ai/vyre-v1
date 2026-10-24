// Check 2: permission filtering never leaks. Random grants/revokes/edits/label changes interleaved with partial pulls;
// after every catch-up the replica must equal a fresh filtered snapshot. Stale replays never resurrect rows.
import test from "node:test";
import assert from "node:assert/strict";
import { Server, Client, direct, hlcStr } from "./sync.mjs";
import { NodeDb, rng, metric } from "./adapters.mjs";

let FR = 0;
const strip = (st) => { const o = {}; for (const [id, f] of Object.entries(st)) o[id] = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v])); return o; };
async function freshState(s, person) { // what a brand-new device would get
  const c = await new Client({ dev: "fresh" + (++FR), person, db: new NodeDb(), fts: true }).init(); await c.bootstrap(direct(s, person)); return c;
}

for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  test(`property: replica == fresh filtered snapshot after random grants/revokes (seed ${seed})`, async () => {
    const R = rng(seed); const s = new Server(); const people = ["p0", "p1", "p2", "p3"]; const owner = "boss"; s.addPerson(owner, 3);
    people.forEach((p, i) => s.addPerson(p, i % 3 + 1));
    const ids = Array.from({ length: 40 }, (_, i) => "r" + i);
    let t = 100; const mk = (id, fields) => ({ opId: `o${++t}`, hlc: hlcStr(t, 0, "boss"), id, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { v }])), baseSeq: {} });
    for (const id of ids) s.push(owner, [mk(id, { title: "title " + id, salary: 1000, status: "new" })]);
    const clients = {}; for (const p of people) { clients[p] = await new Client({ dev: p, person: p, db: new NodeDb(), fts: true }).init(); await clients[p].bootstrap(direct(s, p)); }
    let checks = 0, hides = 0;
    for (let step = 0; step < 150; step++) {
      const r = R(); const id = ids[Math.floor(R() * ids.length)]; const p = people[Math.floor(R() * people.length)];
      if (r < 0.3) s.grant(p, id); else if (r < 0.55) s.revoke(p, id);
      else if (r < 0.9) s.push(owner, [mk(id, { title: "t" + step, salary: step })]);
      else if (r < 0.95) { s.bumpEpoch(p); }
      else { s.addPerson(p, Math.floor(R() * 3) + 1); s.bumpEpoch(p); } // clearance change forces purge + resync
      if (R() < 0.35) { // partial pull: one small page, as a flaky connection would
        const c = clients[p]; const res = await direct(s, p).pull({ cursor: c.cursor, epoch: c.epoch, limit: 5, dev: c.dev });
        if (res.reset) { await c.pull(direct(s, p)); await c.bootstrap(direct(s, p)); } else { await c.applyChanges(res.changes); c.cursor = res.next; }
      }
      if (R() < 0.15) { // catch-up and compare
        for (const q of people) {
          const c = clients[q]; const res = await c.pull(direct(s, q)); if (res.purged) await c.bootstrap(direct(s, q));
          const fresh = await freshState(s, q);
          assert.deepEqual(strip(await c.visibleState()), strip(await fresh.visibleState()), `seed ${seed} step ${step} person ${q}: replica != fresh snapshot`);
          const ftsA = (await c.db.all("SELECT id FROM fts ORDER BY id")).map((x) => x.id); const ftsB = (await fresh.db.all("SELECT id FROM fts ORDER BY id")).map((x) => x.id);
          assert.deepEqual(ftsA, ftsB, "FTS rows differ from fresh");
          for (const [rid, f] of Object.entries(await c.visibleState())) { void rid; if (s.person(q).clearance < 2) assert.equal(f.salary, undefined, "salary leaked"); }
          checks++;
        }
      }
    }
    metric("s2.property", { seed, steps: 150, comparisons: checks, revokes: s.p("SELECT COUNT(*) c FROM events WHERE kind='revoke'").get().c, epoch_purges: people.reduce((n, p) => n + s.epoch(p), 0) });
    assert.ok(checks > 20);
  });
}

test("revoke mid-stream: next pull purges and stale pre-revoke replay never resurrects the row", async () => {
  const s = new Server(); const mk = (n, id, f, ms) => ({ opId: n, hlc: hlcStr(ms, 0, "o"), id, fields: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { v }])), baseSeq: {} });
  for (let i = 0; i < 6; i++) s.push("owner", [mk("a" + i, "r" + i, { title: "secret " + i }, 10 + i)]);
  for (let i = 0; i < 6; i++) s.grant("bob", "r" + i);
  const bob = await new Client({ dev: "b", person: "bob", db: new NodeDb(), fts: true }).init(); const t = direct(s, "bob");
  const early = await t.pull({ cursor: 0, epoch: 0, limit: 4, dev: "b" }); // page 1 of the stream
  await bob.applyChanges(early.changes); bob.cursor = early.next;
  s.revoke("bob", "r1"); s.push("owner", [mk("late", "r1", { title: "post-revoke edit" }, 99)]); // revoke while paging
  await bob.pull(t);
  assert.equal(await bob.rowCount(), 5); assert.deepEqual(await bob.read("r1"), {});
  assert.equal((await bob.db.all("SELECT id FROM fts WHERE id='r1'")).length, 0);
  await bob.applyChanges(early.changes); // replay of the old page (duplicate delivery after reconnect)
  assert.deepEqual(await bob.read("r1"), {}, "stale replay resurrected a hidden row");
  assert.equal(await bob.rowCount(), 5);
  // regrant brings it back with current state only
  s.grant("bob", "r1"); await bob.pull(t); assert.equal((await bob.read("r1")).title, "post-revoke edit");
  // epoch bump (device revoked) purges everything including FTS and the outbox
  await bob.edit("r0", { title: "offline" }); s.bumpEpoch("bob"); const res = await bob.pull(t); assert.ok(res.purged);
  assert.equal(await bob.rowCount(), 0); assert.equal((await bob.db.all("SELECT * FROM fts")).length, 0); assert.equal(await bob.pendingCount(), 0);
  metric("s2.revoke_midstream", { pass: true });
});
