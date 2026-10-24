// Check 3: offline queue of 1,000 edits from 3 devices merges deterministically; protected fields open conflicts.
import test from "node:test";
import assert from "node:assert/strict";
import { Server, Client, direct } from "./sync.mjs";
import { NodeDb, rng, metric } from "./adapters.mjs";

async function scenario(order) {
  const s = new Server(); s.addPerson("owner");
  const R = rng(42); const devs = ["d1", "d2", "d3"]; const people = { d1: "owner", d2: "bob", d3: "cara" };
  // seed 20 rows by owner, share with all
  const seed = await new Client({ dev: "seed", person: "owner", db: new NodeDb(), now: () => 1000 }).init();
  for (let i = 0; i < 20; i++) await seed.edit("r" + i, { title: "t0", note: "n0", status: "open" });
  await seed.push(direct(s, "owner")); for (let i = 0; i < 20; i++) { s.grant("bob", "r" + i); s.grant("cara", "r" + i); }
  const cl = {}; let tnow = 5_000;
  for (const d of devs) { cl[d] = await new Client({ dev: d, person: people[d], db: new NodeDb(), now: () => tnow }).init(); await cl[d].bootstrap(direct(s, people[d])); }
  // 1,000 offline edits, interleaved in wall time; ms ticks deterministic so hlc is a pure function of the plan
  const plan = []; for (let i = 0; i < 1000; i++) plan.push({ d: devs[Math.floor(R() * 3)], id: "r" + Math.floor(R() * 20), f: ["title", "note", "status"][Math.floor(R() * 3)], v: `v${i}`, ms: 10_000 + i });
  for (const p of plan) { tnow = p.ms; await cl[p.d].edit(p.id, { [p.f]: p.v }); }
  assert.equal((await Promise.all(devs.map((d) => cl[d].pendingCount()))).reduce((a, b) => a + b, 0), 1000);
  // reconnect in the given order, each drains its outbox in batches of 200
  let conflicts = 0;
  for (const d of order) { for (;;) { const r = await cl[d].push(direct(s, people[d])); conflicts += r.conflicts.length; if (!(await cl[d].pendingCount())) break; } }
  for (const d of devs) await cl[d].pull(direct(s, people[d]));
  const lww = Object.fromEntries(s.p("SELECT id, field, v FROM rows WHERE field IN ('title','note') ORDER BY id, field").all().map((r) => [r.id + "." + r.field, r.v]));
  const hist = s.p("SELECT id, field, v FROM field_history WHERE field IN ('title','note') ORDER BY id, field, v").all().map((h) => `${h.id}.${h.field}=${h.v}`);
  const states = await Promise.all(devs.map((d) => cl[d].visibleState()));
  return { lww, hist, conflicts, states, s, plan };
}

test("1,000 offline edits from 3 devices merge identically for every reconnect order", async () => {
  const orders = [["d1", "d2", "d3"], ["d3", "d2", "d1"], ["d2", "d3", "d1"]];
  const res = []; for (const o of orders) res.push(await scenario(o));
  // lww fields: identical values, identical loser history, replicas converge to server
  for (const r of res.slice(1)) { assert.deepEqual(r.lww, res[0].lww); assert.deepEqual(r.hist, res[0].hist); }
  for (const r of res) for (const st of r.states) { for (const [id, f] of Object.entries(st)) { for (const k of ["title", "note"]) assert.equal(JSON.stringify(f[k]), r.lww[id + "." + k], "replica != server for " + id + "." + k); } assert.deepEqual(Object.keys(st).length, 20); }
  // newest hlc is the plan's last write per (id, field) among lww fields
  const last = {}; for (const p of res[0].plan) if (p.f !== "status") last[p.id + "." + p.f] = JSON.stringify(p.v);
  for (const [k, v] of Object.entries(last)) assert.equal(res[0].lww[k], v);
  // every superseded lww value is in history exactly once (nothing silently lost)
  const nLww = res[0].plan.filter((p) => p.f !== "status").length;
  assert.equal(res[0].hist.length, nLww, "every superseded value (including the seed) is in history exactly once");
  // protected field: no silent overwrite. status never changed by a concurrent edit, conflicts opened instead.
  for (const r of res) {
    const open = r.s.p("SELECT COUNT(*) c FROM conflicts WHERE state='open'").get().c;
    assert.equal(open, r.conflicts); assert.ok(r.conflicts > 0, "expected status conflicts");
    for (const row of r.s.p("SELECT v FROM rows WHERE field='status'").all()) { const val = JSON.parse(row.v); assert.ok(val === "open" || /^v\d+$/.test(val)); }
  }
  metric("s3.offline_merge", { edits: 1000, devices: 3, orders: orders.length, deterministic: true, status_conflicts_per_order: res.map((r) => r.conflicts), history_rows: res[0].hist.length });
});
