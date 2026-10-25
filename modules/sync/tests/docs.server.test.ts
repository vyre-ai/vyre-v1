// @reads /modules/sync/migrations/0001_pull.sql
// P-L1_06, the document server and its live layer (ARCH 5.6): access on every call, bad updates, events without content, the 500-update and 10-minute folds, named history versions, suggestions as tracked changes,
// the ydoc frames, a revoked editor cut off mid session, and the hook the purge client uses to close a row's documents.
import test from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { BODY, MAX_UPDATE_BYTES, agreeSpan, attributedInsert, baseSnapshot, fromB64, headSeq, newDoc, spansOf, toB64, toMarkdown, updatesAfter, versions } from "../docs/index.ts";
import type { AccessSnapshot } from "../../../kernel/src/authorize/snapshot.ts";
import { ADA, AGENT, BO, CY, NOW, TRACE, ctx, docRig, edit } from "./docs.rig.test.ts";
import { buildAccess } from "../fixtures/world.ts";
import { createDocHandlers, snapshotDocAccess } from "../handlers/docs.ts";

const errCode = (e: unknown): string | undefined => (e as { error?: { code?: string } }).error?.code;
const u = (from: Uint8Array[], at: number, text: string): string => toB64(edit(from, at, text));
const OWNER = { entity: "note", id: "n1" };

test("update appends in order, the event carries the doc id and a size and never the text, and the capability answers with the seq", async () => {
  const rig = docRig();
  rig.allow("not_a", [ADA], { owner: OWNER });
  const h = createDocHandlers(rig.server);
  const first = edit([], 0, "alpha secret text");
  assert.deepEqual(await h["sync.doc.update"](ctx(ADA), { doc: "not_a", update: toB64(first) }), { seq: 1 });
  assert.deepEqual(await h["sync.doc.update"](ctx(ADA), { doc: "not_a", update: u([first], 0, "beta ") }), { seq: 2 });
  const ev = rig.events.filter((e) => e.type === "doc.updated");
  assert.equal(ev.length, 2);
  assert.deepEqual(Object.keys(ev[0]!.payload as object).sort(), ["actor", "bytes", "doc", "seq"]);
  assert.ok(!JSON.stringify(ev).includes("secret"));
  assert.equal(rig.server.open(ADA, { doc: "not_a" }, TRACE).md, "beta alpha secret text");
});

test("open: a new device gets the snapshot, a device with a state vector gets only what it lacks", async () => {
  const rig = docRig();
  rig.allow("not_a", [ADA]);
  const one = edit([], 0, "one ");
  rig.server.update(ADA, { doc: "not_a", update: toB64(one) }, TRACE);
  const have = new Y.Doc();
  const fresh = rig.server.open(ADA, { doc: "not_a" }, TRACE);
  assert.equal(fresh.updates.length, 0);
  Y.applyUpdate(have, fromB64(fresh.snapshot ?? ""));
  assert.equal(have.getText(BODY).toString(), "one ");
  rig.server.update(ADA, { doc: "not_a", update: u([one], 4, "two") }, TRACE);
  const diff = rig.server.open(ADA, { doc: "not_a", sv: toB64(Y.encodeStateVector(have)) }, TRACE);
  assert.equal(diff.snapshot, undefined);
  assert.equal(diff.updates.length, 1);
  Y.applyUpdate(have, fromB64(diff.updates[0]!));
  assert.equal(have.getText(BODY).toString(), "one two");
  assert.equal(diff.upto, 2);
  assert.equal(diff.enc, 0);
});

test("access is checked on every call: no grant, missing document, viewer who tries to edit, an editor revoked mid session", async () => {
  const rig = docRig();
  rig.allow("not_a", [ADA, BO], { viewOnly: [CY] });
  const h = createDocHandlers(rig.server);
  const first = edit([], 0, "hello");
  await h["sync.doc.update"](ctx(ADA), { doc: "not_a", update: toB64(first) });
  await assert.rejects(h["sync.doc.open"](ctx("usr_nobody"), { doc: "not_a" }), (e) => errCode(e) === "permission.no_grant");
  await assert.rejects(h["sync.doc.open"](ctx(ADA), { doc: "not_there" }), (e) => errCode(e) === "validation.not_found");
  assert.equal((await h["sync.doc.open"](ctx(CY), { doc: "not_a" })).md, "hello");
  await assert.rejects(h["sync.doc.update"](ctx(CY), { doc: "not_a", update: u([first], 5, "!") }), (e) => errCode(e) === "permission.revoked");
  await h["sync.doc.update"](ctx(BO), { doc: "not_a", update: u([first], 5, "!") });
  rig.revoke("not_a", BO, "edit");
  await assert.rejects(h["sync.doc.update"](ctx(BO), { doc: "not_a", update: u([first], 0, "x") }), (e) => errCode(e) === "permission.revoked");
  assert.equal((await h["sync.doc.open"](ctx(BO), { doc: "not_a" })).md, "hello!", "still allowed to read, and the refused edit is not in");
});

test("bad updates are refused before they can poison a rebuild: garbage, empty, too large, wrong encryption flag", async () => {
  const rig = docRig();
  rig.allow("not_a", [ADA]);
  const h = createDocHandlers(rig.server);
  for (const update of [toB64(new Uint8Array([255, 255, 255, 255])), "", "***not base64***"]) {
    await assert.rejects(h["sync.doc.update"](ctx(ADA), { doc: "not_a", update }), (e) => errCode(e) === "validation.bad_input");
  }
  await assert.rejects(h["sync.doc.update"](ctx(ADA), { doc: "not_a", update: toB64(new Uint8Array(MAX_UPDATE_BYTES + 1)) }), (e) => errCode(e) === "validation.bad_input");
  await assert.rejects(h["sync.doc.update"](ctx(ADA), { doc: "not_a", update: toB64(edit([], 0, "x")), enc: 1 }), (e) => errCode(e) === "validation.bad_input");
  assert.equal(headSeq(rig.s.host.tx, "not_a"), 0);
  // An empty Yjs update is accepted and stores nothing.
  assert.deepEqual(await h["sync.doc.update"](ctx(ADA), { doc: "not_a", update: toB64(new Uint8Array([0, 0])) }), { seq: 0 });
  assert.equal(updatesAfter(rig.s.host.tx, "not_a", 0).length, 0);
});

test("a fold happens at 500 updates (set low here): one snapshot with the Markdown projection, the owning row written, the next update keeps counting", () => {
  const rig = docRig({ compactEvery: 5 });
  rig.allow("not_a", [ADA], { owner: OWNER });
  const ups: Uint8Array[] = [];
  for (let i = 0; i < 5; i++) {
    const up = edit(ups, 0, `w${i} `);
    ups.push(up);
    rig.server.update(ADA, { doc: "not_a", update: toB64(up) }, TRACE);
  }
  const snap = baseSnapshot(rig.s.host.tx, "not_a");
  assert.equal(snap?.upto, 5);
  assert.equal(snap?.md, "w4 w3 w2 w1 w0 ");
  assert.equal(updatesAfter(rig.s.host.tx, "not_a", 0).length, 0);
  assert.deepEqual(rig.projected.at(-1), { owner: OWNER, md: "w4 w3 w2 w1 w0 ", doc: "not_a" });
  const next = rig.server.update(ADA, { doc: "not_a", update: u(ups, 0, "w5 ") }, TRACE);
  assert.equal(next.seq, 6);
  assert.equal(rig.server.open(ADA, { doc: "not_a" }, TRACE).md, "w5 w4 w3 w2 w1 w0 ");
});

test("the sweep folds a document after 10 minutes, and only then", () => {
  const rig = docRig();
  rig.allow("not_a", [ADA], { owner: OWNER });
  rig.server.update(ADA, { doc: "not_a", update: u([], 0, "quiet") }, TRACE);
  assert.equal(rig.server.sweep(TRACE), 0);
  rig.clock.t = NOW + 9 * 60_000;
  assert.equal(rig.server.sweep(TRACE), 0);
  rig.clock.t = NOW + 10 * 60_000 + 1;
  assert.equal(rig.server.sweep(TRACE), 1);
  assert.equal(baseSnapshot(rig.s.host.tx, "not_a")?.md, "quiet");
  assert.equal(rig.server.sweep(TRACE), 0, "nothing left to fold");
});

test("close writes a named history version only when the content changed since the last one", async () => {
  const rig = docRig();
  rig.allow("not_a", [ADA], { owner: OWNER });
  const h = createDocHandlers(rig.server);
  assert.deepEqual(await h["sync.doc.close"](ctx(ADA), { doc: "not_a" }), { versioned: false, upto: 0 });
  const one = edit([], 0, "v1 text");
  rig.server.update(ADA, { doc: "not_a", update: toB64(one) }, TRACE);
  assert.deepEqual(await h["sync.doc.close"](ctx(ADA), { doc: "not_a", name: "first draft" }), { versioned: true, upto: 1 });
  assert.deepEqual(await h["sync.doc.close"](ctx(ADA), { doc: "not_a" }), { versioned: false, upto: 1 });
  rig.server.update(ADA, { doc: "not_a", update: u([one], 7, " and more") }, TRACE);
  assert.equal((await h["sync.doc.close"](ctx(ADA), { doc: "not_a" })).versioned, true);
  const hist = rig.server.history(ADA, "not_a", TRACE);
  assert.equal(hist.length, 2);
  assert.equal(hist[1]?.named, "first draft");
  assert.equal(hist[1]?.md, "v1 text");
  assert.equal(hist[0]?.md, "v1 text and more");
  assert.equal(hist[0]?.named, new Date(NOW).toISOString());
  assert.equal(versions(rig.s.host.tx, "not_a").length, 2);
  // Later folds never delete a named version.
  rig.server.update(ADA, { doc: "not_a", update: u([one], 0, "x") }, TRACE);
  rig.server.compact(ADA, { doc: "not_a" }, TRACE);
  assert.equal(rig.server.history(ADA, "not_a", TRACE).length, 2);
});

test("suggestions are tracked changes: a fold stops before a pending one; accept lets it fold; reject removes exactly that change", () => {
  const rig = docRig();
  rig.allow("not_a", [ADA, AGENT]);
  const base = edit([], 0, "The deal closes Friday. ");
  rig.server.update(ADA, { doc: "not_a", update: toB64(base) }, TRACE);
  const sug = edit([base], 24, "Maybe Monday instead. ");
  const s = rig.server.update(AGENT, { doc: "not_a", update: toB64(sug), suggest: true }, TRACE);
  assert.equal(s.seq, 2);
  const mine = edit([base, sug], 0, "Note: ");
  rig.server.update(ADA, { doc: "not_a", update: toB64(mine) }, TRACE);
  assert.deepEqual(rig.server.attribution(ADA, "not_a", TRACE).map((a) => [a.seq, a.actor, a.suggest]), [[1, ADA, "agreed"], [2, AGENT, "pending"], [3, ADA, "agreed"]]);

  const r = rig.server.compact(ADA, { doc: "not_a" }, TRACE);
  assert.equal(r.upto, 1, "the fold stops before the pending suggestion");
  assert.equal(updatesAfter(rig.s.host.tx, "not_a", 0).length, 2);
  assert.equal(rig.server.open(ADA, { doc: "not_a" }, TRACE).md, "Note: The deal closes Friday. Maybe Monday instead. ");

  const rej = rig.server.rejectSuggestion(ADA, "not_a", 2, TRACE);
  assert.equal(rej.seq, 4);
  assert.equal(rig.server.open(ADA, { doc: "not_a" }, TRACE).md, "Note: The deal closes Friday. ", "only the suggestion is gone, the later human edit stays");
  assert.deepEqual(rig.server.attribution(ADA, "not_a", TRACE).map((a) => [a.seq, a.suggest]), [[2, "rejected"], [3, "agreed"], [4, "agreed"]]);
  assert.throws(() => rig.server.rejectSuggestion(ADA, "not_a", 2, TRACE), (e) => errCode(e) === "validation.not_found");

  const again = rig.server.update(AGENT, { doc: "not_a", update: u([base, sug, mine], 0, "Draft: "), suggest: true }, TRACE).seq;
  rig.server.acceptSuggestion(ADA, "not_a", again, TRACE);
  assert.equal(rig.server.compact(ADA, { doc: "not_a" }, TRACE).upto, headSeq(rig.s.host.tx, "not_a"));
});

test("a named version taken while a suggestion is pending never starts a rebuild", () => {
  const rig = docRig();
  rig.allow("not_a", [ADA, AGENT]);
  const base = edit([], 0, "base");
  rig.server.update(ADA, { doc: "not_a", update: toB64(base) }, TRACE);
  const sug = edit([base], 4, " + idea");
  rig.server.update(AGENT, { doc: "not_a", update: toB64(sug), suggest: true }, TRACE);
  assert.equal(rig.server.close(ADA, { doc: "not_a", name: "with idea" }, TRACE).versioned, true);
  assert.equal(rig.server.history(ADA, "not_a", TRACE)[0]?.md, "base + idea");
  assert.equal(baseSnapshot(rig.s.host.tx, "not_a"), undefined, "the named copy is not a fold: a rebuild still starts from the updates");
  rig.server.rejectSuggestion(ADA, "not_a", 2, TRACE);
  assert.equal(rig.server.open(ADA, { doc: "not_a" }, TRACE).md, "base");
});

test("attribution marks on text: an agent's span carries its author and suggest until a person agrees; the Markdown ignores both", () => {
  const y = newDoc();
  const t = y.getText(BODY);
  t.insert(0, "Human text. ");
  attributedInsert(t, t.length, "Agent idea.", AGENT, true);
  assert.deepEqual(spansOf(t), [{ index: 12, length: 11, author: AGENT, suggest: true }]);
  agreeSpan(t, 12, 11);
  assert.deepEqual(spansOf(t), [{ index: 12, length: 11, author: AGENT, suggest: false }]);
  assert.equal(toMarkdown(y), "Human text. Agent idea.");
});

test("snapshotDocAccess: view and edit come from the owning row's access, a hold or a missing row refuses, a private row is the owner's alone", () => {
  const access: AccessSnapshot = buildAccess({ boFilter: null });
  access.putResource({ id: "res_note", type: "record", parent_id: null, label: 0, owner_id: null, holds: 0 });
  const acl = snapshotDocAccess({
    snapshot: () => access,
    now: () => NOW,
    rowOf: (doc) => (doc === "not_x" ? { type: "record", resource: "res_note", owner: OWNER } : doc === "not_priv" ? { type: "record", resource: "res_note", enc: 2, ownerId: ADA } : undefined),
  });
  assert.deepEqual(acl.decide(ADA, "not_x", "edit"), { ok: true, enc: 0, owner: OWNER });
  assert.deepEqual(acl.decide(BO, "not_x", "view"), { ok: true, enc: 0, owner: OWNER });
  assert.deepEqual(acl.decide(BO, "not_x", "edit"), { ok: false, reason: "denied" });
  assert.deepEqual(acl.decide(CY, "not_x", "view"), { ok: false, reason: "denied" });
  assert.deepEqual(acl.decide(ADA, "not_nope", "view"), { ok: false, reason: "missing" });
  assert.deepEqual(acl.decide(ADA, "not_priv", "edit"), { ok: true, enc: 2 });
  assert.deepEqual(acl.decide(BO, "not_priv", "view"), { ok: false, reason: "denied" }, "a grant does not open a private note");
});

test("live frames: sync1 answers with sync2 and the server's vector, updates relay to the other subscribers, the writer gets an ack, awareness is relayed and never stored", async () => {
  const rig = docRig();
  rig.allow("not_l", [ADA, BO]);
  const seen: { to: string; t: string; data: Record<string, unknown> }[] = [];
  const peerA = { person: ADA, device: "dA" }, peerB = { person: BO, device: "dB" };
  const send = (to: string) => (f: { t: string; data?: unknown }): void => { seen.push({ to, t: f.t, data: (f.data ?? {}) as Record<string, unknown> }); };
  const detachA = rig.live.attach(peerA, send("A") as never);
  rig.live.attach(peerB, send("B") as never);
  const sv = toB64(Y.encodeStateVector(newDoc()));
  rig.live.onFrame(peerA, { t: "ydoc.sync1", doc: "not_l", data: { sv } });
  rig.live.onFrame(peerB, { t: "ydoc.sync1", doc: "not_l", data: { sv } });
  assert.deepEqual(seen.filter((s) => s.to === "A").map((s) => s.t), ["ydoc.sync2", "ydoc.sync1"]);
  assert.equal(rig.live.subscribers("not_l"), 2);
  seen.length = 0;
  rig.live.onFrame(peerA, { t: "ydoc.update", doc: "not_l", data: { update: u([], 0, "hi") } });
  assert.deepEqual(seen.map((s) => [s.to, s.t]), [["A", "ydoc.sync2"], ["B", "ydoc.update"]]);
  assert.deepEqual(seen[0]!.data, { ack: 1 });
  assert.equal(seen[1]!.data["seq"], 1);
  seen.length = 0;
  rig.live.onFrame(peerA, { t: "ydoc.awareness", doc: "not_l", data: { update: toB64(new Uint8Array([1])) } });
  assert.deepEqual(seen.map((s) => [s.to, s.t]), [["B", "ydoc.awareness"]]);
  assert.equal(headSeq(rig.s.host.tx, "not_l"), 1, "presence is not stored");
  detachA();
  assert.equal(rig.live.subscribers("not_l"), 1);
  seen.length = 0;
  rig.live.onFrame(peerA, { t: "ydoc.update", doc: "not_l", data: { update: u([], 0, "ignored") } });
  assert.deepEqual(seen, [], "a socket that detached is not served");
});

test("a revoked editor is cut off mid session: the refused edit reaches nobody and the editor is told; losing view drops the document from that device", async () => {
  const rig = docRig();
  rig.allow("not_l", [ADA, BO]);
  const a = rig.device(ADA), b = rig.device(BO);
  const dA = a.client.open("not_l"), dB = b.client.open("not_l");
  dA.text().insert(0, "shared. ");
  await rig.settle();
  assert.equal(dB.text().toString(), "shared. ");

  rig.revoke("not_l", BO, "edit");
  dB.text().insert(0, "sneaky ");
  await rig.settle();
  assert.deepEqual(b.problems, [{ doc: "not_l", code: "permission.revoked", dropped: false }]);
  assert.equal(dA.text().toString(), "shared. ", "the refused edit did not reach A");
  assert.ok(!rig.server.open(ADA, { doc: "not_l" }, TRACE).md?.includes("sneaky"));
  assert.equal(b.store.has("not_l"), true, "what B wrote stays on B's device");

  rig.revoke("not_l", BO, "all");
  assert.equal(rig.live.revalidate(), 1);
  await rig.settle();
  assert.equal(b.problems.at(-1)?.dropped, true);
  assert.equal(b.store.has("not_l"), false, "dropped: the document is removed from the device");
  dA.text().insert(0, "after. ");
  await rig.settle();
  assert.equal(b.client.openIds().length, 0);
  assert.deepEqual(rig.errors, []);
});

test("the purge client's hook: closeFor closes and forgets a row's documents (main and per field), closeAll closes every one", async () => {
  const rig = docRig();
  for (const d of ["note:n1", "note:n1:body", "note:n2", "task:n1"]) rig.allow(d, [ADA]);
  const a = rig.device(ADA);
  for (const d of ["note:n1", "note:n1:body", "note:n2", "task:n1"]) a.client.open(d).text().insert(0, d);
  await rig.settle();
  a.client.closeFor("note", "n1");
  assert.deepEqual(a.client.openIds().sort(), ["note:n2", "task:n1"]);
  assert.equal(a.store.has("note:n1"), false);
  assert.equal(a.store.has("note:n1:body"), false);
  assert.equal(a.store.has("note:n2"), true);
  a.client.closeAll();
  assert.deepEqual(a.client.openIds(), []);
});
