// @reads /modules/sync/migrations/0001_pull.sql
// P-L1_06, private documents (ARCH 5.6, enc 2): a personal memory note is sealed on the owner's device update by update. The server holds ciphertext only and orders it blind; a second user cannot pull plaintext;
// a device with the wrong key cannot read it; the owner's device folds it (compact) and the server never builds a snapshot, a Markdown text or a search entry.
import test from "node:test";
import assert from "node:assert/strict";
import { aesDocCrypto, baseSnapshot, docMeta, fromB64, headSeq, toB64, updatesAfter } from "../../../sync/src/yjs/index.ts";
import { ADA, BO, ctx, docRig, edit } from "./docs.rig.test.ts";
import { createDocHandlers } from "../handlers/docs.ts";

const DOC = "not_mem";
const SECRET = "the settlement number is 4417 and the client does not know";
const KEY = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 255);
const WRONG = new Uint8Array(32).map((_, i) => (i * 5 + 1) & 255);

const has = (hay: Uint8Array, needle: string): boolean => Buffer.from(hay).includes(Buffer.from(needle, "utf8"));
const errCode = (e: unknown): string | undefined => (e as { error?: { code?: string } }).error?.code;

test("the server holds ciphertext only: no plaintext in any stored update, no snapshot, no Markdown, no index text", async () => {
  const rig = docRig();
  rig.allow(DOC, [ADA], { enc: 2, owner: { entity: "memory", id: "m1" } });
  const a = rig.device(ADA, { crypto: aesDocCrypto(KEY) });
  const d = a.client.open(DOC, { enc: 2 });
  d.text().insert(0, SECRET);
  d.text().insert(0, "note: ");
  await d.idle();
  await rig.settle();

  const rows = updatesAfter(rig.s.host.tx, DOC, 0);
  assert.equal(rows.length, 2, "one sealed update per edit");
  for (const r of rows) {
    assert.equal(r.enc, 2);
    assert.ok(!has(r.bytes, "settlement") && !has(r.bytes, "4417") && !has(r.bytes, "note:"), "no plaintext in a stored update");
  }
  assert.equal(docMeta(rig.s.host.tx, DOC)?.enc, 2);
  assert.equal(baseSnapshot(rig.s.host.tx, DOC), undefined);
  const open = rig.server.open(ADA, { doc: DOC }, "t");
  assert.equal(open.enc, 2);
  assert.equal(open.md, undefined);
  assert.equal(open.sv, "");
  assert.equal(open.updates.length, 2);
  assert.ok(open.updates.every((u) => !has(fromB64(u), "settlement")));
  assert.equal(rig.projected.length, 0, "a private document never reaches the owning row's text");
  assert.equal(rig.server.sweep("t"), 0, "the sweep leaves private documents alone");
  assert.equal(baseSnapshot(rig.s.host.tx, DOC), undefined);
  for (const e of rig.events) assert.ok(!JSON.stringify(e).includes("settlement"), "no event carries content");
  assert.deepEqual(rig.errors, []);
});

test("a second user cannot pull plaintext: the capability refuses, the live subscribe is dropped, an update is refused", async () => {
  const rig = docRig();
  rig.allow(DOC, [ADA], { enc: 2 });
  const a = rig.device(ADA, { crypto: aesDocCrypto(KEY) });
  a.client.open(DOC, { enc: 2 }).text().insert(0, SECRET);
  await rig.settle();

  const handlers = createDocHandlers(rig.server);
  await assert.rejects(handlers["sync.doc.open"](ctx(BO), { doc: DOC }), (e) => errCode(e) === "permission.no_grant");
  await assert.rejects(handlers["sync.doc.update"](ctx(BO), { doc: DOC, update: toB64(new Uint8Array([1, 2, 3])), enc: 2 }), (e) => errCode(e) === "permission.revoked");

  // Even with the owner's own account name the server cannot help: a live subscribe by the other user is dropped.
  const b = rig.device(BO, { crypto: aesDocCrypto(KEY) });
  const stolen = b.client.open(DOC, { enc: 2 });
  await rig.settle();
  assert.equal(stolen.text().toString(), "");
  assert.deepEqual(b.problems.map((p) => [p.code, p.dropped]), [["permission.no_grant", true]]);
  assert.equal(b.store.has(DOC), false, "nothing of the document is kept on that device");
});

test("a device with the wrong key never gets plaintext; a second device of the owner with the right key reads it", async () => {
  const rig = docRig();
  rig.allow(DOC, [ADA], { enc: 2 });
  const a = rig.device(ADA, { crypto: aesDocCrypto(KEY) });
  const dA = a.client.open(DOC, { enc: 2 });
  dA.text().insert(0, SECRET);
  await dA.idle();
  await rig.settle();

  const phone = rig.device(ADA, { id: "dev_phone", crypto: aesDocCrypto(KEY) });
  const dP = phone.client.open(DOC, { enc: 2 });
  await rig.settle();
  assert.equal(dP.text().toString(), SECRET);
  dP.text().insert(0, "from the phone: ");
  await dP.idle();
  await rig.settle();
  assert.equal(dA.text().toString(), `from the phone: ${SECRET}`, "live updates are sealed on one device and opened on the other");

  const thief = rig.device(ADA, { id: "dev_wrong", crypto: aesDocCrypto(WRONG) });
  const dT = thief.client.open(DOC, { enc: 2 });
  await rig.settle();
  assert.equal(dT.text().toString(), "", "wrong key: nothing readable");
  assert.ok(rig.errors.length > 0, "opening a sealed update with the wrong key fails");
  rig.errors.length = 0;
});

test("the owner's device folds a private document: compact stores the sealed snapshot, later updates keep numbering, a new device reads snapshot plus tail", async () => {
  const rig = docRig();
  rig.allow(DOC, [ADA], { enc: 2 });
  const handlers = createDocHandlers(rig.server);
  const a = rig.device(ADA, { crypto: aesDocCrypto(KEY) });
  const dA = a.client.open(DOC, { enc: 2 });
  for (let i = 0; i < 6; i++) { dA.text().insert(dA.text().length, `line ${i}. `); await dA.idle(); }
  await rig.settle();
  assert.equal(headSeq(rig.s.host.tx, DOC), 6);

  // The server will not fold it itself, and refuses a compact without the device's snapshot.
  await assert.rejects(handlers["sync.doc.compact"](ctx(ADA), { doc: DOC }), (e) => errCode(e) === "validation.bad_input");
  const payload = await a.client.compactionOf(DOC);
  assert.ok(payload);
  assert.equal(payload.upto, 6);
  const res = await handlers["sync.doc.compact"](ctx(ADA), { doc: payload.doc, upto: payload.upto, snapshot: payload.snapshot });
  assert.equal(res.upto, 6);
  const snap = baseSnapshot(rig.s.host.tx, DOC);
  assert.equal(snap?.md, null);
  assert.ok(!has(snap!.bytes, "line 0"), "the stored snapshot is ciphertext");
  assert.equal(updatesAfter(rig.s.host.tx, DOC, 0).length, 0);
  await assert.rejects(handlers["sync.doc.compact"](ctx(ADA), { doc: DOC, upto: 99, snapshot: payload.snapshot }), (e) => errCode(e) === "validation.bad_input");

  dA.text().insert(0, "after fold: ");
  await dA.idle();
  await rig.settle();
  assert.equal(updatesAfter(rig.s.host.tx, DOC, 0)[0]?.seq, 7, "numbering continues after the fold");

  const tablet = rig.device(ADA, { id: "dev_tablet", crypto: aesDocCrypto(KEY) });
  const dT = tablet.client.open(DOC, { enc: 2 });
  await rig.settle();
  assert.equal(dT.text().toString(), dA.text().toString());
  assert.ok(dT.text().toString().startsWith("after fold: line 0."));
  assert.deepEqual(rig.errors, []);
});

test("plain and private updates do not mix: a plain update to a private document, and a sealed one to a plain document, are refused", async () => {
  const rig = docRig();
  rig.allow("not_priv", [ADA], { enc: 2 });
  rig.allow("not_plain", [ADA]);
  const handlers = createDocHandlers(rig.server);
  const plain = toB64(edit([], 0, "hello"));
  await handlers["sync.doc.update"](ctx(ADA), { doc: "not_priv", update: toB64(new Uint8Array([9, 9, 9])), enc: 2 });
  await assert.rejects(handlers["sync.doc.update"](ctx(ADA), { doc: "not_priv", update: plain }), (e) => errCode(e) === "validation.bad_input");
  await assert.rejects(handlers["sync.doc.update"](ctx(ADA), { doc: "not_plain", update: toB64(new Uint8Array([9, 9, 9])), enc: 2 }), (e) => errCode(e) === "validation.bad_input");
  assert.deepEqual(await handlers["sync.doc.update"](ctx(ADA), { doc: "not_plain", update: plain }), { seq: 1 });
});
