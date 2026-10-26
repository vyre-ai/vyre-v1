// @reads /modules/sync/migrations/0001_pull.sql
// sync.push merge (ARCH 5.4 step 3): lww with the loser kept, protected fields to the assistant, append, the 5 minute clamp, no self-conflict through `after`, and convergence of random edit orders.
import test from "node:test";
import assert from "node:assert/strict";
import type { Op } from "../../../sync/src/protocol.ts";
import { createOutbox, memoryOutboxStore } from "../../../sync/src/outbox/index.ts";
import { NOW, hl, patchOp, pushRig } from "./push.rig.test.ts";
import type { PushRig } from "./push.rig.test.ts";

// ---- lww ----

test("a field nobody else touched applies, and an edit made on the latest version applies even with an older clock", async () => {
  const r = pushRig();
  const s0 = r.seed("contact", "c1", { name: "A" });
  const res = await r.push("usr_ada", "dev_a", [patchOp({ id: "a1", fields: { name: "B", stage: "won" }, base: { name: s0 }, hlc: hl(NOW - 500_000) })]);
  assert.equal(res.applied.length, 1);
  assert.equal(r.value("contact", "c1", "name"), "B");
  assert.equal(r.value("contact", "c1", "stage"), "won", "a field with no clock yet is fresh");
  assert.deepEqual(r.history, []);
});

test("lww: the newer write wins whichever arrives first, and the other value is kept in history", async () => {
  for (const order of [["early", "late"], ["late", "early"]] as const) {
    const r = pushRig();
    const s0 = r.seed("contact", "c1", { name: "A" });
    const ops = {
      early: patchOp({ id: "early", fields: { name: "from early" }, base: { name: s0 }, hlc: hl(NOW - 4000, 0, "dev_a") }),
      late: patchOp({ id: "late", fields: { name: "from late" }, base: { name: s0 }, hlc: hl(NOW - 2000, 0, "dev_b") }),
    };
    for (const k of order) await r.push(k === "early" ? "usr_ada" : "usr_bo", k === "early" ? "dev_a" : "dev_b", [ops[k]]);
    assert.equal(r.value("contact", "c1", "name"), "from late", order.join(" then "));
    assert.ok(r.history.some((h) => h.field === "name" && h.value === "from early" && h.reason === "lww_loser"), "the loser stays in history");
    assert.equal(r.conflicts.length, 0);
  }
});

test("lww tie: equal hlc is decided by the actor id, the same on every server and replay", async () => {
  const winners = new Set<unknown>();
  for (const order of [["a", "b"], ["b", "a"]] as const) {
    const r = pushRig();
    const s0 = r.seed("contact", "c1", { name: "A" });
    const op = (who: string) => patchOp({ id: `t_${who}`, fields: { name: `by ${who}` }, base: { name: s0 }, hlc: hl(NOW - 2000, 5, "dev_x") });
    for (const who of order) await r.push(`usr_${who}`, "dev_x", [op(who)]);
    winners.add(r.value("contact", "c1", "name"));
  }
  assert.deepEqual([...winners], ["by b"]);
});

test("the result reports a lost field and the value is not applied", async () => {
  const r = pushRig();
  const s0 = r.seed("contact", "c1", { name: "A", stage: "lead" });
  await r.push("usr_bo", "dev_b", [patchOp({ id: "w", fields: { name: "newer" }, base: { name: s0 }, hlc: hl(NOW - 1000, 0, "dev_b") })]);
  const res = await r.push("usr_ada", "dev_a", [patchOp({ id: "l", fields: { name: "older", stage: "won" }, base: { name: s0, stage: s0 }, hlc: hl(NOW - 3000, 0, "dev_a") })]);
  assert.equal(res.applied.length, 1);
  assert.equal(r.value("contact", "c1", "name"), "newer");
  assert.equal(r.value("contact", "c1", "stage"), "won", "the field that did not lose still applies");
  assert.deepEqual(r.calls.at(-1)!.input, { fields: { stage: "won" } }, "the capability is called with the winning fields only");
});

// ---- the clamp ----

test("skewed clocks: an hlc more than 5 minutes ahead is clamped to now, so it cannot win for ever", async () => {
  const r = pushRig();
  const s0 = r.seed("contact", "c1", { name: "A" });
  await r.push("usr_ada", "dev_a", [patchOp({ id: "skew", fields: { name: "from the future" }, base: { name: s0 }, hlc: hl(NOW + 3_600_000, 9, "dev_a") })]);
  const stored = r.cells("contact", "c1")["name"]!;
  assert.equal(stored.hlc, hl(NOW, 0, "dev_a"), "stored at server now, counter 0");
  assert.equal(r.calls[0]!.hlc, hl(NOW, 0, "dev_a"));
  // A concurrent edit a few seconds later by an honest clock beats it.
  const res = await r.push("usr_bo", "dev_b", [patchOp({ id: "honest", fields: { name: "honest" }, base: { name: s0 }, hlc: hl(NOW + 4000, 0, "dev_b") })]);
  assert.equal(res.applied.length, 1);
  assert.equal(r.value("contact", "c1", "name"), "honest");
});

test("an hlc inside the 5 minute bound is kept as sent", async () => {
  const r = pushRig();
  const s0 = r.seed("contact", "c1", { name: "A" });
  await r.push("usr_ada", "dev_a", [patchOp({ id: "ok", fields: { name: "B" }, base: { name: s0 }, hlc: hl(NOW + 200_000, 2, "dev_a") })]);
  assert.equal(r.cells("contact", "c1")["name"]!.hlc, hl(NOW + 200_000, 2, "dev_a"));
});

// ---- protected fields ----

test("a protected field edited concurrently keeps the current value and opens a conflict; the rest of the op applies", async () => {
  const r = pushRig();
  const s0 = r.seed("agent", "ag1", { name: "Bot", status: "active", model: "m1" });
  await r.push("usr_bo", "dev_b", [patchOp({ id: "first", entity: "agent", row: "ag1", fields: { status: "paused" }, base: { status: s0 }, hlc: hl(NOW - 3000, 0, "dev_b") })]);
  const res = await r.push("usr_ada", "dev_a", [patchOp({ id: "second", entity: "agent", row: "ag1", fields: { status: "archived", model: "m2" }, base: { status: s0, model: s0 }, hlc: hl(NOW - 1000, 0, "dev_a") })]);
  assert.equal(r.value("agent", "ag1", "status"), "paused", "the current value stays");
  assert.equal(r.value("agent", "ag1", "model"), "m2");
  assert.equal(res.applied.length, 1);
  assert.equal(res.conflicts.length, 1);
  assert.deepEqual({ entity: res.conflicts[0]!.entity, rowId: res.conflicts[0]!.rowId, field: res.conflicts[0]!.field, state: res.conflicts[0]!.state, opId: res.conflicts[0]!.opId }, { entity: "agent", rowId: "ag1", field: "status", state: "open", opId: "second" });
  const c = r.conflicts[0]!;
  assert.deepEqual({ ours: c.ours, theirs: c.theirs, base: c.base, oursActor: c.oursActor, theirsActor: c.theirsActor, plain: c.plainChoice }, { ours: "paused", theirs: "archived", base: s0, oursActor: "usr_bo", theirsActor: "usr_ada", plain: false });
  assert.deepEqual(r.calls.at(-1)!.input, { fields: { model: "m2" } });
});

test("a retried op that opened a conflict gets the same conflict and opens none", async () => {
  const r = pushRig();
  const s0 = r.seed("agent", "ag1", { status: "active" });
  await r.push("usr_bo", "dev_b", [patchOp({ id: "p1", entity: "agent", row: "ag1", fields: { status: "paused" }, base: { status: s0 }, hlc: hl(NOW - 3000, 0, "dev_b") })]);
  const op = patchOp({ id: "p2", entity: "agent", row: "ag1", fields: { status: "archived" }, base: { status: s0 }, hlc: hl(NOW - 1000, 0, "dev_a") });
  const first = await r.push("usr_ada", "dev_a", [op]);
  const again = await r.push("usr_ada", "dev_a", [op]);
  assert.deepEqual(again.conflicts, first.conflicts);
  assert.equal(r.conflicts.length, 1);
  assert.deepEqual(first.applied.map((a) => a.opId), ["p2"], "an op whose fields all conflicted is still settled, so the device drops it from the outbox");
});

test("a protected field edited on the latest version applies; there is nothing to conflict with", async () => {
  const r = pushRig();
  const s0 = r.seed("agent", "ag1", { status: "active" });
  const res = await r.push("usr_ada", "dev_a", [patchOp({ id: "s", entity: "agent", row: "ag1", fields: { status: "paused" }, base: { status: s0 }, hlc: hl(NOW - 1000) })]);
  assert.equal(r.value("agent", "ag1", "status"), "paused");
  assert.deepEqual(res.conflicts, []);
});

test("no self-conflict: a device's second queued edit of a protected field names the first (`after`) and applies", async () => {
  const r = pushRig();
  const s0 = r.seed("agent", "ag1", { status: "active" });
  const one = patchOp({ id: "q1", entity: "agent", row: "ag1", fields: { status: "paused" }, base: { status: s0 }, hlc: hl(NOW - 3000) });
  const two = patchOp({ id: "q2", entity: "agent", row: "ag1", fields: { status: "archived" }, base: { status: s0 }, after: { status: "q1" }, hlc: hl(NOW - 2000) });
  const res = await r.push("usr_ada", "dev_a", [one, two]);
  assert.deepEqual(res.conflicts, []);
  assert.equal(r.value("agent", "ag1", "status"), "archived");
  // Without the link the same second op is a conflict with the device's own first edit.
  const r2 = pushRig();
  const t0 = r2.seed("agent", "ag1", { status: "active" });
  const bare = { ...patchOp({ id: "q2", entity: "agent", row: "ag1", fields: { status: "archived" }, base: { status: t0 }, hlc: hl(NOW - 2000) }) };
  const res2 = await r2.push("usr_ada", "dev_a", [patchOp({ id: "q1", entity: "agent", row: "ag1", fields: { status: "paused" }, base: { status: t0 }, hlc: hl(NOW - 3000) }), bare]);
  assert.equal(res2.conflicts.length, 1);
});

test("a Restricted field conflict is a plain choice and never goes to a provider", async () => {
  const r = pushRig();
  r.policies.set("client_plan.tax_id", "assistant");
  const s0 = r.seed("client_plan", "cp1", { tax_id: "11-111" });
  await r.push("usr_bo", "dev_b", [patchOp({ id: "r1", entity: "client_plan", row: "cp1", fields: { tax_id: "22-222" }, base: { tax_id: s0 }, hlc: hl(NOW - 3000, 0, "dev_b") })]);
  await r.push("usr_ada", "dev_a", [patchOp({ id: "r2", entity: "client_plan", row: "cp1", fields: { tax_id: "33-333" }, base: { tax_id: s0 }, hlc: hl(NOW - 1000) })]);
  assert.equal(r.conflicts[0]!.plainChoice, true);
});

// ---- append and text ----

test("append fields always apply, concurrent or not", async () => {
  const r = pushRig();
  r.policies.set("contact.log", "append");
  const s0 = r.seed("contact", "c1", { log: "one" });
  await r.push("usr_bo", "dev_b", [patchOp({ id: "l1", fields: { log: "two" }, base: { log: s0 }, hlc: hl(NOW - 1000, 0, "dev_b") })]);
  const res = await r.push("usr_ada", "dev_a", [patchOp({ id: "l2", fields: { log: "three" }, base: { log: s0 }, hlc: hl(NOW - 3000, 0, "dev_a") })]);
  assert.equal(res.applied.length, 1);
  assert.equal(r.calls.at(-1)!.idempotencyKey, "l2");
  assert.deepEqual(r.conflicts, []);
});

test("a long-text field is not a field op: the op is refused with the values to copy out", async () => {
  const r = pushRig();
  r.policies.set("contact.bio", "text-crdt");
  const res = await r.push("usr_ada", "dev_a", [patchOp({ id: "t", fields: { bio: "long text", name: "N" }, hlc: hl(NOW - 1000) })]);
  assert.equal(res.rejected[0]!.error.code, "validation.unsupported");
  assert.deepEqual(res.rejected[0]!.copyOut, { bio: "long text", name: "N" });
  assert.equal(r.calls.length, 0);
});

test("an op that is not a field patch goes to the capability as it is", async () => {
  const r = pushRig();
  const op: Op = { opId: "call1", traceId: "0123456789abcdef0123456789abcdef", hlc: hl(NOW - 1000), cap: "chat.send", v: 2, input: { thread: "th1", body: "hi" }, baseSeq: {} };
  const res = await r.push("usr_ada", "dev_a", [op]);
  assert.equal(res.applied.length, 1);
  assert.deepEqual(r.calls[0]!.input, { thread: "th1", body: "hi" });
  assert.equal(r.calls[0]!.v, 2);
});

// ---- convergence ----

function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0;
  const next = (): number => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { int: (n: number) => Math.floor(next() * n), chance: (p: number) => next() < p };
}
function perms<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

test("random concurrent edits converge: every arrival order gives the same row, and every value that did not win is in history", async () => {
  const fields = ["name", "stage", "region"];
  for (let seed = 1; seed <= 25; seed++) {
    const g = rng(seed);
    const k = 2 + g.int(3);
    const spec = Array.from({ length: k }, (_, i) => {
      const touched = fields.filter(() => g.chance(0.6));
      if (!touched.length) touched.push(fields[g.int(fields.length)]!);
      return { id: `s${seed}_${i}`, person: `usr_p${i}`, device: `dev_${i}`, ms: NOW - 20_000 + g.int(10_000), counter: g.int(3), touched };
    });
    let reference: Record<string, unknown> | null = null;
    for (const order of perms(spec)) {
      const r: PushRig = pushRig();
      const s0 = r.seed("contact", "c1", { name: "seed", stage: "seed", region: "seed" });
      for (const o of order) {
        const f = Object.fromEntries(o.touched.map((t) => [t, `${t}:${o.id}`]));
        await r.push(o.person, o.device, [patchOp({ id: o.id, fields: f, base: Object.fromEntries(o.touched.map((t) => [t, s0])), hlc: hl(o.ms, o.counter, o.device) })]);
      }
      const final = Object.fromEntries(fields.map((f) => [f, r.value("contact", "c1", f)]));
      reference ??= final;
      assert.deepEqual(final, reference, `seed ${seed}: order ${order.map((o) => o.id).join(",")}`);
      // The expected winner of each field: the largest (hlc, actor) among the ops that touched it.
      for (const f of fields) {
        const touching = spec.filter((o) => o.touched.includes(f));
        if (!touching.length) { assert.equal(final[f], "seed"); continue; }
        const best = touching.reduce((a, b) => (hl(a.ms, a.counter, a.device) > hl(b.ms, b.counter, b.device) || (hl(a.ms, a.counter, a.device) === hl(b.ms, b.counter, b.device) && a.person > b.person) ? a : b));
        assert.equal(final[f], `${f}:${best.id}`, `seed ${seed} field ${f}`);
        for (const o of touching) if (o !== best) assert.ok(r.history.some((h) => h.field === f && h.value === `${f}:${o.id}`), `seed ${seed}: ${f}:${o.id} kept in history`);
      }
    }
  }
});

// ---- outbox and server together ----

/** A device model: local values with the version each came from, an outbox, and a pull cursor. */
function device(r: PushRig, person: string, id: string) {
  if (!r.access.principal(person)) {
    r.access.putPrincipal({ id: person, kind: "person", status: "active", name: person });
    r.access.addPrincipalRole({ holder: person, role: "owner" });
    r.access.putGrant({ id: `gr_${person}`, subject_kind: "actor", subject_id: person, resource_type: "record", resource_id: null, level: "manage" });
  }
  let t = NOW - 60_000;
  const ob = createOutbox({ store: memoryOutboxStore(), deviceId: id, now: () => (t += 10), newOpId: (() => { let n = 0; return () => `${id}_op${++n}`; })() });
  const local = new Map<string, { v: unknown; hlc: string; seq: number }>();
  let cursor = 0;
  return {
    ob,
    local,
    edit(field: string, v: unknown) {
      const had = local.get(field);
      const op = ob.enqueue({ cap: "test.patch", entity: "contact", id: "c1", input: { fields: { [field]: v } }, seqOf: { [field]: had?.seq ?? 0 } });
      local.set(field, { v, hlc: op.hlc, seq: had?.seq ?? 0 });
    },
    async sync() {
      const ops = ob.batch();
      if (ops.length) ob.acknowledge(await r.push(person, id, ops));
      const pulled = await r.s.handlers["sync.pull"]({ trace: { traceId: "0123456789abcdef0123456789abcdef" }, principal: person, deviceId: id, deviceClass: "desktop" }, { cursor, epoch: 0 });
      for (const c of pulled.changes) {
        if (c.op === "delete") continue;
        for (const [f, fv] of Object.entries(c.fields)) {
          const mine = local.get(f);
          // A queued edit of this field is newer than anything the server can tell the device yet; once it is pushed, the server's answer replaces it.
          if (!mine || !pendingFor(f)) local.set(f, { v: fv.v, hlc: fv.hlc, seq: c.seq });
        }
      }
      cursor = pulled.next;
      return pulled.more;
    },
  };
  function pendingFor(f: string): boolean { return ob.batch(200).some((o) => JSON.stringify((o.input as { fields?: Record<string, unknown> }).fields ?? {}).includes(`"${f}"`)); }
}

test("three devices editing offline through outboxes converge on the server's row", async () => {
  for (let seed = 1; seed <= 8; seed++) {
    const g = rng(seed * 7);
    const r = pushRig();
    r.seed("contact", "c1", { name: "seed", stage: "seed", region: "seed" });
    const devs = [device(r, "usr_a", "dev_a"), device(r, "usr_b", "dev_b"), device(r, "usr_c", "dev_c")];
    for (const d of devs) while (await d.sync()) { /* initial pull */ }
    const fields = ["name", "stage", "region"];
    for (let step = 0; step < 24; step++) {
      const d = devs[g.int(3)]!;
      if (g.chance(0.6)) d.edit(fields[g.int(3)]!, `v${seed}_${step}`);
      else await d.sync();
    }
    for (let round = 0; round < 3; round++) for (const d of devs) { await d.sync(); while (await d.sync()) { /* drain */ } }
    for (const d of devs) assert.equal(d.ob.pending(), 0, `seed ${seed}: outbox drained`);
    for (const f of fields) {
      const server = r.value("contact", "c1", f);
      for (const d of devs) assert.equal(d.local.get(f)?.v, server, `seed ${seed} field ${f}`);
    }
  }
});
