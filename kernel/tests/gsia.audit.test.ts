// @ts-nocheck (adapted from vyre 0.6.9 kernel/audit/{audit,anchor,key}.test.js; the log is the v1 LogStore behind the AuditLog adapter)
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { LogStore } from "../src/log/index.ts";
import { auditLogOf, createCheckpointer, verifyTail, verifyLog, verifyCheckpoint, createDeviceCheckpoints, ed25519Signer, anchorCheck } from "../src/audit/index.ts";
import { compareCheckpoints, publicKeyOf, revokeKey, verifyEndorsement } from "../src/audit/verify.ts";
import { endorse, verifyRevocation } from "../src/audit/key.ts";
import * as C from "../src/identity/chain.ts";

const SPACE = "spc_aaaaaaaaaaaa";
let T = 1_800_000_000_000;
const clock = () => ++T;
const keys = () => crypto.generateKeyPairSync("ed25519");
const TRACE = "0123456789abcdef0123456789abcdef";
const newLog = (space = SPACE) => { const store = new LogStore({ db: new DatabaseSync(":memory:"), space, clock }); return { store, log: auditLogOf(store) }; };
const fill = (store, n, from = 0) => { for (let i = 0; i < n; i++) store.appendBatch([{ type: "note.added", sv: 1, trace_id: TRACE, actor: "usr_owner", vis: "space", payload: { i: from + i } }]); };
const rig = (over = {}) => {
  const { store, log } = newLog();
  const { publicKey, privateKey } = keys();
  const cp = createCheckpointer({ space: SPACE, log, sign: ed25519Signer(privateKey), key_id: "space-key-1", clock, ...over });
  return { store, log, cp, publicKey, privateKey };
};
/** The log as it was at event n: what a database put back to an older copy shows. */
const viewAt = (log, n) => ({ latestSeq: () => n, head: () => log.get(n).hash, get: (s) => (s <= n ? log.get(s) : undefined), read: (f) => log.read(f).filter((e) => e.seq <= n), verify: () => ({ ok: true, head: log.get(n).hash, seq: n }) });
const fakeAnchor = () => {
  let held = null;
  return {
    get held() { return held; },
    read: async () => held,
    advance: async ({ seq, head }) => {
      if (held) { if (seq < held.seq) throw Object.assign(new Error("anchor_behind"), { code: "anchor_behind" }); if (seq === held.seq && head !== held.head) throw Object.assign(new Error("anchor_split"), { code: "anchor_split" }); }
      held = { seq, head };
      return held;
    },
    reset: () => { held = null; },
  };
};

// ---- the chain itself: tamper detection ----
test("the hash chain catches an edited envelope, a deleted event and a truncated tail", () => {
  const { store } = newLog();
  fill(store, 12);
  assert.equal(store.verify().ok, true);
  store.db.exec(`UPDATE events SET event = json_set(event, '$.actor', 'usr_mallory') WHERE seq = 5`);
  const bad = store.verify();
  assert.deepEqual([bad.ok, bad.at], [false, 5]);
  const b = newLog(); fill(b.store, 12);
  b.store.db.exec("DELETE FROM events WHERE seq = 6");
  assert.equal(b.store.verify().ok, false, "a gap");
  const c = newLog(); fill(c.store, 12);
  c.store.db.exec("DELETE FROM events WHERE seq > 9");
  const t = c.store.verify();
  assert.deepEqual([t.ok, t.why], [false, "the log is shorter than the head it recorded"]);
});

// ---- checkpoints ----
test("checkpoints: signed over the head before their own event, appended, and verify walks them", async () => {
  const { store, log, cp, publicKey } = rig();
  fill(store, 5);
  const c = await cp.sign();
  assert.equal(c.seq, 5);
  assert.equal(c.hash, log.read({})[4].hash);
  assert.equal(log.latestSeq(), 6, "the checkpoint is itself an event, after the head it names");
  assert.ok(verifyCheckpoint(c, publicKey));
  assert.equal(verifyCheckpoint({ ...c, seq: 4 }, publicKey), false, "a changed field breaks the signature");
  assert.equal(verifyCheckpoint(c, keys().publicKey), false, "another key");
  fill(store, 3, 5);
  await cp.sign();
  const v = verifyLog({ space: SPACE, log, publicKey });
  assert.deepEqual([v.ok, v.checkpoints, v.problems], [true, 2, []]);
});

test("checkpoints: tick signs after 1,000 events or 10 minutes, and never when nothing happened", async () => {
  const { store, cp } = rig({ every_events: 10, every_ms: 600_000 });
  assert.equal(await cp.tick(), null, "nothing yet");
  fill(store, 3);
  assert.equal(await cp.tick(), null, "too few events, too soon");
  fill(store, 7, 3);
  assert.ok(await cp.tick(), "10 events");
  assert.equal(await cp.tick(), null, "nothing since");
  fill(store, 1, 10);
  T += 601_000;
  assert.ok(await cp.tick(), "10 minutes with something to say");
});

test("audit verify: a forged checkpoint and an edited event are found", async () => {
  const { store, log, cp, publicKey } = rig();
  fill(store, 4);
  await cp.sign();
  assert.equal(verifyLog({ space: SPACE, log, publicKey }).ok, true);
  const evil = keys();
  await createCheckpointer({ space: SPACE, log, sign: ed25519Signer(evil.privateKey), key_id: "space-key-1", clock }).sign();
  const v = verifyLog({ space: SPACE, log, publicKey });
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /signature/.test(p.why)));
  const { store: s2, log: l2, cp: cp2, publicKey: pk2 } = rig();
  fill(s2, 4); await cp2.sign();
  s2.db.exec(`UPDATE events SET event = json_set(event, '$.type', 'note.edited') WHERE seq = 2`);
  const bad = verifyLog({ space: SPACE, log: l2, publicKey: pk2 });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((p) => p.seq === 2));
});

test("device checkpoints: a rollback, a rewrite and a split are detected; an older checkpoint is refused", async () => {
  const { store, log, cp, publicKey } = rig();
  const dev = createDeviceCheckpoints({ space: SPACE, publicKey });
  fill(store, 6);
  const c1 = await cp.sign();
  assert.deepEqual(dev.accept(c1), { ok: true });
  assert.deepEqual(dev.check(log), { ok: true });
  fill(store, 4, 6);
  const c2 = await cp.sign();
  assert.deepEqual(dev.accept(c2), { ok: true });
  assert.deepEqual(dev.accept(c1), { ok: false, why: "older_than_held" }, "the home cannot walk a device back");
  assert.deepEqual(dev.accept({ ...c2, signature: "AAAA" }), { ok: false, why: "bad_signature" });
  assert.deepEqual(dev.check(viewAt(log, 7)), { ok: false, why: "rolled_back" });
  const rewritten = newLog();
  fill(rewritten.store, log.latestSeq(), 500);
  assert.deepEqual(dev.check(rewritten.log), { ok: false, why: "history_differs" });
});

test("device checkpoints: two devices holding one position with two hashes expose a split; with a log they check inclusion", async () => {
  const { store, log, cp, publicKey, privateKey } = rig();
  fill(store, 5);
  const a = await cp.sign();
  const sign = ed25519Signer(privateKey);
  const body = { space: SPACE, seq: a.seq, hash: "x".repeat(43), time: a.time, key_id: a.key_id };
  const b = { ...body, signature: sign(Buffer.from("vyre-checkpoint-v1\n" + JSON.stringify({ hash: body.hash, key_id: body.key_id, seq: body.seq, space: body.space, time: body.time }))) };
  assert.equal(compareCheckpoints(a, b, publicKey).ok, false);
  fill(store, 3, 5);
  const c = await cp.sign();
  assert.deepEqual(compareCheckpoints(a, c, publicKey, log), { ok: true });
  const other = newLog();
  fill(other.store, 12, 300);
  assert.deepEqual(compareCheckpoints(a, c, publicKey, other.log), { ok: false, why: "history_differs" });
});

test("boot check: only what the last checkpoint does not vouch for; a rollback, a rewrite and a broken tail are found", async () => {
  const { store, log, cp, publicKey } = rig();
  assert.deepEqual(verifyTail({ space: SPACE, log, publicKey }), { ok: true, from: 0, checked: 0 }, "an empty log");
  fill(store, 30);
  assert.equal(verifyTail({ space: SPACE, log, publicKey }).ok, true, "no checkpoint yet: the whole chain");
  const c = await cp.sign();
  fill(store, 12, 100);
  const v = verifyTail({ space: SPACE, log, publicKey });
  assert.deepEqual([v.ok, v.from, v.checked], [true, c.seq, log.latestSeq() - c.seq], "only what came after the checkpoint was walked");
  const shorter = { ...log, latestSeq: () => c.seq - 1 };
  assert.equal(verifyTail({ space: SPACE, log: shorter, publicKey }).why, "rolled_back");
  const rewritten = { ...log, get: (s) => (s === c.seq ? { ...log.get(s), hash: "x" } : log.get(s)) };
  assert.equal(verifyTail({ space: SPACE, log: rewritten, publicKey }).why, "history_differs");
  assert.equal(verifyTail({ space: SPACE, log, publicKey: keys().publicKey }).from, 0, "a checkpoint from another key is not a start point");
  store.db.exec(`UPDATE events SET event = json_set(event, '$.actor', 'usr_mallory') WHERE seq = ${c.seq + 3}`);
  const broken = verifyTail({ space: SPACE, log, publicKey });
  assert.equal(broken.ok, false, "a broken tail after the checkpoint");
});

// ---- the anchor (BL-2) ----
const anchored = (over = {}) => { const anchor = fakeAnchor(); const { publicKey, privateKey } = keys(); const { store, log } = newLog(); const cp = createCheckpointer({ space: SPACE, log, sign: ed25519Signer(privateKey), key_id: "k1", clock, publicKey, anchor, ...over }); return { store, log, cp, publicKey, anchor }; };

test("anchor: a fresh home boots; each checkpoint moves the anchor forward to the head it signed", async () => {
  const { store, log, cp, anchor } = anchored();
  fill(store, 5);
  assert.deepEqual(await anchorCheck({ log, anchor }), { ok: true, seq: null });
  const c1 = await cp.sign();
  assert.deepEqual(anchor.held, { seq: c1.seq, head: c1.hash });
  fill(store, 4, 5);
  const c2 = await cp.sign();
  assert.deepEqual(anchor.held, { seq: c2.seq, head: c2.hash });
  assert.deepEqual(await anchorCheck({ log, anchor }), { ok: true, seq: c2.seq });
});

test("anchor: a database put back to an older copy is found though its own checkpoints say it is fine", async () => {
  const { store, log, cp, publicKey, anchor } = anchored();
  fill(store, 300);
  const old = await cp.sign();
  fill(store, 300, 300);
  const newest = await cp.sign();
  const back = viewAt(log, old.seq + 3);
  assert.equal(verifyTail({ space: SPACE, log: back, publicKey }).ok, true, "tail check alone passes on a rollback");
  const a = await anchorCheck({ log: back, anchor });
  assert.deepEqual([a.ok, a.why, a.seq], [false, "anchor_rolled_back", newest.seq]);
  assert.deepEqual(await anchorCheck({ log, anchor }), { ok: true, seq: newest.seq });
  anchor.reset();
  assert.deepEqual(await anchorCheck({ log: back, anchor }), { ok: true, seq: null }, "after the owner's reset");
});

test("anchor: another event at the anchor's position, and an unreadable anchor, are failures", async () => {
  const { store, log, cp, anchor } = anchored();
  fill(store, 20);
  const c = await cp.sign();
  const rewritten = { ...log, get: (s) => (s === c.seq ? { ...log.get(s), hash: "x".repeat(64) } : log.get(s)) };
  const a = await anchorCheck({ log: rewritten, anchor });
  assert.deepEqual([a.ok, a.why], [false, "anchor_history_differs"]);
  const u = await anchorCheck({ log, anchor: { read: async () => { throw new Error("gone"); } } });
  assert.deepEqual([u.ok, u.why], [false, "anchor_unreadable"]);
});

test("anchor: moves only with a head just verified; a rolled-back log is refused and writes nothing", async () => {
  const { store, log, cp, anchor } = anchored();
  fill(store, 10);
  const c = await cp.sign();
  fill(store, 6, 10);
  const before = log.latestSeq();
  const broken = { ...log, verify: () => ({ ok: false, at: 12, why: "hash does not match the envelope" }) };
  const cp2 = createCheckpointer({ space: SPACE, log: broken, sign: () => "sig", key_id: "k1", clock, anchor });
  await assert.rejects(() => cp2.sign(), { code: "log_broken" });
  assert.deepEqual(anchor.held, { seq: c.seq, head: c.hash }, "unchanged");
  assert.equal(log.latestSeq(), before, "nothing was written");
  fill(store, 30, 100);
  await cp.sign();
  let appended = 0;
  const back = viewAt(log, c.seq + 1);
  const cp3 = createCheckpointer({ space: SPACE, log: { ...back, append: () => { appended++; } }, sign: () => "sig", key_id: "k1", clock, anchor });
  await assert.rejects(() => cp3.sign(), { code: "anchor_behind" });
  assert.equal(appended, 0, "no checkpoint event for a log the anchor says is behind");
});

// ---- the Space key: endorsement and revocation through the identity chain ----
const H = 3_600_000, T0 = Date.UTC(2026, 9, 3, 12, 0, 0);
async function key(label) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const eid = await C.eidOf(pub);
  const pubText = Buffer.from(pub).toString("base64url");
  return { label, pub: pubText, eid, sign: (m) => crypto.sign(null, Buffer.from(m), privateKey), entry: (kind) => ({ eid, kind, pub: pubText, label }) };
}
async function world() {
  const phone = await key("phone");
  const g0 = await C.makeGenesis({ kind: "person", entry: phone.entry("device"), nonce: "n-alex-phone", ts: T0, sign: phone.sign });
  const alex = { ops: [g0], state: await C.verifyChain([g0], { now: T0 }) };
  const chains = new Map([[alex.state.id, alex.ops]]);
  const ownerOps = async (id) => chains.get(id) || null;
  const viaPos = await C.viaOf(alex.ops);
  const g = await C.makeGenesis({ kind: "space", entry: { eid: alex.state.id, kind: "owner", subject: alex.state.id, label: "Alex" }, nonce: "space-nonce-1", ts: T0 + H, via: phone.eid, viaPos, sign: phone.sign });
  return { phone, alex, space: [g], spaceId: (await C.verifyChain([g], { now: T0 + H, ownerOps })).id, ownerOps, viaPos, chains };
}
const spkiOf = (k) => k.publicKey.export({ type: "spki", format: "der" }).toString("base64");
const kidOf = (spki) => crypto.createHash("sha256").update(Buffer.from(spki, "base64")).digest("hex").slice(0, 16);

test("an owner's device endorses the key, and a device accepts it only through the Space's identity chain", async () => {
  const w = await world();
  const spki = spkiOf(keys());
  const key0 = { space: w.spaceId, key_id: kidOf(spki), pub: spki };
  const e = await endorse(key0, { by: w.alex.state.id, via: w.phone.eid, viaPos: w.viaPos, ts: T0 + 2 * H, sign: w.phone.sign });
  const ctx = { ownerOps: w.ownerOps, now: T0 + 10 * H };
  assert.deepEqual(await verifyEndorsement(w.space, e, ctx), key0);
  await assert.rejects(() => verifyEndorsement(w.space, { ...e, pub: spkiOf(keys()) }, ctx), { code: "bad_endorsement" });
  const stranger = await key("stranger");
  const forged = await endorse(key0, { by: w.alex.state.id, via: stranger.eid, viaPos: w.viaPos, ts: T0 + 2 * H, sign: stranger.sign });
  await assert.rejects(() => verifyEndorsement(w.space, forged, ctx), { code: "bad_endorsement" });
  await assert.rejects(() => verifyEndorsement(w.space, { ...e, space: "spc_" + "a".repeat(26) }, ctx), { code: "bad_endorsement" });
  await assert.rejects(() => verifyEndorsement(w.space, { ...e, ts: T0 }, ctx), { code: "bad_endorsement" });
  const dev = createDeviceCheckpoints({ space: w.spaceId, publicKey: publicKeyOf(key0.pub) });
  assert.deepEqual(dev.accept({ space: w.spaceId, seq: 1, hash: "h", time: 1, key_id: key0.key_id, signature: "AAAA" }), { ok: false, why: "bad_signature" });
});

test("any owner revokes the checkpoint key through the chain; a device then refuses it, and notices a home gone quiet", async () => {
  const w = await world();
  const k = keys();
  const kid = kidOf(spkiOf(k));
  const ctx = { ownerOps: w.ownerOps, now: T0 + 10 * H };
  const rev = await revokeKey({ space: w.spaceId, key_id: kid }, { by: w.alex.state.id, via: w.phone.eid, viaPos: w.viaPos, ts: T0 + 3 * H, sign: w.phone.sign });
  assert.deepEqual(await verifyRevocation(w.space, rev, ctx), { space: w.spaceId, key_id: kid });
  const stranger = await key("stranger");
  const forged = await revokeKey({ space: w.spaceId, key_id: kid }, { by: w.alex.state.id, via: stranger.eid, viaPos: w.viaPos, ts: T0 + 3 * H, sign: stranger.sign });
  await assert.rejects(() => verifyRevocation(w.space, forged, ctx), { code: "bad_revocation" });
  let now = 1_000_000;
  const { store, log } = newLog(w.spaceId);
  fill(store, 1);
  const cp = await createCheckpointer({ space: w.spaceId, log, sign: ed25519Signer(k.privateKey), key_id: kid, clock: () => now, publicKey: k.publicKey }).sign();
  const dev = createDeviceCheckpoints({ space: w.spaceId, publicKey: k.publicKey, clock: () => now });
  assert.equal(dev.staleness().stale, true, "nothing held yet");
  assert.deepEqual(dev.accept(cp), { ok: true });
  assert.equal(dev.staleness().stale, false);
  now += 31 * 60_000;
  assert.equal(dev.staleness().stale, true, "no newer checkpoint for three intervals");
  dev.revoke(kid);
  assert.deepEqual(dev.accept({ ...cp, seq: cp.seq + 1 }), { ok: false, why: "key_revoked" });
  log.append({ type: "checkpoint.signed", sv: 1, subject: "x", data: { checkpoint: { ...cp, seq: 99, hash: "forged", signature: "AAAA" } } });
  assert.equal(createCheckpointer({ space: w.spaceId, log, sign: () => "", key_id: kid, publicKey: k.publicKey }).latest().seq, cp.seq, "latest() skips an event that is not a verifying checkpoint");
});

test("a device the owner removed cannot endorse or revoke, even with a backdated ts (position-based validity)", async () => {
  const w = await world();
  const laptop = await key("laptop");
  const state0 = await C.verifyChain(w.alex.ops, { now: T0 + 5 * H });
  const add = await C.makeOp(state0, { type: "add", entry: laptop.entry("device") }, { by: w.phone.eid, ts: T0 + 2 * H, sign: w.phone.sign });
  const s1 = await C.applyOp(state0, add, { now: T0 + 2 * H });
  const rem = await C.makeOp(s1, { type: "remove", target: w.phone.eid }, { by: laptop.eid, ts: T0 + 30 * H, sign: laptop.sign });
  w.chains.set(w.alex.state.id, [...w.alex.ops, add, rem]);
  const pub = spkiOf(keys());
  const key0 = { space: w.spaceId, key_id: kidOf(pub), pub };
  const old = await endorse(key0, { by: w.alex.state.id, via: w.phone.eid, viaPos: w.viaPos, ts: T0 + 2 * H, sign: w.phone.sign });
  await assert.rejects(() => verifyEndorsement(w.space, old, { ownerOps: w.ownerOps, now: T0 + 40 * H }), { code: "bad_endorsement" }, "the removed phone");
  const oldRev = await revokeKey(key0, { by: w.alex.state.id, via: w.phone.eid, viaPos: w.viaPos, ts: T0 + 2 * H, sign: w.phone.sign });
  await assert.rejects(() => verifyRevocation(w.space, oldRev, { ownerOps: w.ownerOps, now: T0 + 40 * H }), { code: "bad_revocation" });
  const cur = await C.viaOf(w.chains.get(w.alex.state.id));
  const ok = await endorse(key0, { by: w.alex.state.id, via: laptop.eid, viaPos: cur, ts: T0 + 31 * H, sign: laptop.sign });
  assert.equal((await verifyEndorsement(w.space, ok, { ownerOps: w.ownerOps, now: T0 + 40 * H })).key_id, key0.key_id);
});
