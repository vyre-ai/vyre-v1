// @reads /modules/sync/migrations/0001_pull.sql
// P-L1_05, server side (ARCH 5.7): sync.epoch.bump raises the epoch, purges live sockets at once and makes older replicas purge on their next pull or hello; sync.acl.reindex makes the server look again
// at rows whose access changed, so devices holding them get hide frames. Real log, real pull, real live hub.
import test from "node:test";
import assert from "node:assert/strict";
import { memoryLink } from "../../../client/src/connection/index.ts";
import type { MemoryLink } from "../../../client/src/connection/index.ts";
import { parseFrame } from "../../../sync/src/protocol.ts";
import type { Frame } from "../../../sync/src/protocol.ts";
import type { LiveWho } from "../../../sync/src/live/index.ts";
import { payloadOf } from "../../../kernel/src/store/projection.ts";
import { RESCAN_SUMMARY_ROWS } from "../../../sync/src/purge/index.ts";
import { createPurgeHandlers, purgeDepsOf } from "../handlers/purge.ts";
import type { PullCtx } from "../handlers/index.ts";
import { ADA, BO, CY } from "../fixtures/world.ts";
import { liveRig, settle } from "./live.rig.test.ts";
import type { LiveRig } from "./live.rig.test.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const adminCtx = { trace: { traceId: TRACE }, principal: ADA };
const pullCtx = (person: string, device: string): PullCtx => ({ trace: { traceId: TRACE }, principal: person, deviceId: device, deviceClass: "desktop" });

interface Raw { link: MemoryLink; frames: Frame[]; send(f: unknown): void; ofType<T extends Frame["t"]>(t: T): Extract<Frame, { t: T }>[] }
function raw(rig: LiveRig, who: LiveWho): Raw {
  const link = memoryLink();
  const frames: Frame[] = [];
  link.client.onFrame((f) => { const p = parseFrame(f); assert.ok(p.ok, p.ok ? "" : p.error); if (p.ok) frames.push(p.value); });
  rig.hub.accept(link.server, who);
  return { link, frames, send: (f) => link.client.send(f), ofType: (t) => frames.filter((f): f is Extract<Frame, { t: typeof t }> => f.t === t) as never };
}
const who = (person: string, device: string): LiveWho => ({ person, device, deviceClass: "desktop" });
const hello = (device: string, over: Record<string, unknown> = {}) => ({ t: "hello", hello: { deviceId: device, deviceClass: "desktop", appVersion: "1.0.0", registryHash: "h1", cursor: 0, epoch: 0, replica: { entities: {} }, ...over } });
const admin = (rig: LiveRig) => createPurgeHandlers(purgeDepsOf(rig.r.s, rig.hub));
const errCode = (e: unknown): string | undefined => (e as { error?: { code?: string } }).error?.code;

test("sync.epoch.bump: the epoch rises by one, live sockets of the person get a purge frame and close, others stay, and the person's seen marks are dropped", async () => {
  const rig = liveRig();
  rig.row("c1");
  const bo1 = raw(rig, who(BO, "d1")), bo2 = raw(rig, who(BO, "d2")), ada = raw(rig, who(ADA, "d3"));
  bo1.send(hello("d1")); bo2.send(hello("d2")); ada.send(hello("d3"));
  await settle();
  const marks = (person: string): number => rig.r.s.host.tx.get<{ n: number }>("SELECT count(*) AS n FROM sync_seen_rows WHERE person = ?", person)?.n ?? 0;
  assert.ok(marks(BO) > 0, "bo holds a row, so the server marked it");
  const handlers = admin(rig);
  const res = await handlers["sync.epoch.bump"](adminCtx, { personId: BO, reason: "device_revoked", deviceId: "d1" });
  assert.deepEqual(res, { epoch: 1 });
  await settle();
  assert.deepEqual(bo1.ofType("purge").map((p) => p.epoch), [1]);
  assert.deepEqual(bo2.ofType("purge").map((p) => p.epoch), [1]);
  assert.equal(bo1.link.isOpen() || bo2.link.isOpen(), false);
  assert.equal(ada.link.isOpen(), true);
  assert.equal(ada.ofType("purge").length, 0);
  assert.equal(marks(BO), 0);
  assert.ok(marks(ADA) > 0, "other people keep theirs");

  // The second bump is the next number, and the event records who, why and which device.
  assert.deepEqual(await handlers["sync.epoch.bump"](adminCtx, { personId: BO, reason: "password_reset" }), { epoch: 2 });
  const events = rig.r.s.host.store.read({ type: "sync.epoch_bumped" });
  assert.deepEqual(events.map((e) => payloadOf<Record<string, unknown>>(e)), [
    { personId: BO, epoch: 1, reason: "device_revoked", deviceId: "d1" },
    { personId: BO, epoch: 2, reason: "password_reset" },
  ]);
  assert.equal(events[0]!.actor, ADA);
  assert.equal(events[0]!.trace_id, TRACE);
  rig.hub.close();
});

test("after a bump an older replica is told to purge by its next pull and its next hello; a current one is not", async () => {
  const rig = liveRig();
  rig.row("c1");
  await admin(rig)["sync.epoch.bump"](adminCtx, { personId: BO, reason: "removed" });
  const old = await rig.r.s.handlers["sync.pull"](pullCtx(BO, "d1"), { cursor: 0, epoch: 0 });
  assert.equal(old.reset, "purge");
  assert.equal(old.epoch, 1);
  assert.deepEqual([old.changes, old.hide], [[], []], "a purge answer carries no data");
  const current = await rig.r.s.handlers["sync.pull"](pullCtx(BO, "d1"), { cursor: 0, epoch: 1 });
  assert.equal(current.reset, undefined);
  const stale = raw(rig, who(BO, "d9"));
  stale.send(hello("d9", { epoch: 0 }));
  await settle();
  assert.equal(stale.ofType("hello_ok")[0]!.ok.mode, "purge");
  assert.deepEqual(stale.ofType("purge").map((p) => p.epoch), [1]);
  const fresh = raw(rig, who(BO, "d10"));
  fresh.send(hello("d10", { epoch: 1 }));
  await settle();
  assert.equal(fresh.ofType("hello_ok")[0]!.ok.mode, "live");
  rig.hub.close();
});

test("sync.acl.reindex: a revoked grant becomes a hide frame on a live socket, for the person who lost access and nobody else", async () => {
  const rig = liveRig();
  rig.row("c1");
  const bo = raw(rig, who(BO, "d1")), ada = raw(rig, who(ADA, "d3")), cy = raw(rig, who(CY, "d4"));
  bo.send(hello("d1")); ada.send(hello("d3")); cy.send(hello("d4"));
  await settle();
  assert.deepEqual(bo.ofType("ev").flatMap((e) => e.items.map((i) => i.id)), ["c1"]);
  const before = { ada: ada.ofType("ev").length, cy: cy.ofType("ev").length };

  rig.r.access.revokeGrant("gr_bo_record");
  const res = await admin(rig)["sync.acl.reindex"](adminCtx, { resourceType: "record", resourceId: "*" });
  assert.deepEqual(res, { changed: 1, scopeChanged: false });
  rig.hub.commit();
  await settle();
  assert.deepEqual(bo.ofType("ev").flatMap((e) => (e.hide ?? []).map((h) => `${h.entity}/${h.id}`)), ["contact/c1"]);
  assert.equal(bo.link.isOpen(), true, "a hide does not disconnect");
  assert.equal(ada.ofType("ev").length, before.ada, "ada still sees the row, nothing to tell her");
  assert.equal(cy.ofType("ev").length, before.cy);

  // Giving the grant back is the same path in the other direction: the row comes back whole.
  rig.r.access.putGrant({ id: "gr_bo_record", subject_kind: "actor", subject_id: BO, resource_type: "record", resource_id: null, level: "view", conditions: { hiddenFields: [] } });
  await admin(rig)["sync.acl.reindex"](adminCtx, { resourceType: "record", resourceId: "*" });
  rig.hub.commit();
  await settle();
  const back = bo.ofType("ev").flatMap((e) => e.items.filter((i) => i.op === "upsert").map((i) => i.id));
  assert.deepEqual(back, ["c1", "c1"], "first seen, then returned");
  rig.hub.close();
});

test("sync.acl.reindex: a big entity also announces the change (sync.scope_changed); a small one does not; an explicit entity limits the work", async () => {
  const rig = liveRig();
  for (let i = 0; i < RESCAN_SUMMARY_ROWS + 1; i++) rig.row(`c${i}`);
  rig.r.seed("other_thing", "o1", { name: "x" });
  const h = admin(rig);
  const small = await h["sync.acl.reindex"](adminCtx, { resourceType: "record", resourceId: "*", entity: "other_thing" });
  assert.deepEqual(small, { changed: 1, scopeChanged: false });
  assert.equal(rig.r.s.host.store.read({ type: "sync.scope_changed" }).length, 0);
  const big = await h["sync.acl.reindex"](adminCtx, { resourceType: "record", resourceId: "*", entity: "contact" });
  assert.deepEqual(big, { changed: RESCAN_SUMMARY_ROWS + 1, scopeChanged: true });
  const [ev] = rig.r.s.host.store.read({ type: "sync.scope_changed" });
  assert.deepEqual(payloadOf<Record<string, unknown>>(ev!), { entity: "contact", filter: { resourceType: "record", resourceId: "*" }, rows: RESCAN_SUMMARY_ROWS + 1 });
  // Without an entity every entity under the resource type is rescanned.
  const all = await h["sync.acl.reindex"](adminCtx, { resourceType: "record", resourceId: "*" });
  assert.equal(all.changed, RESCAN_SUMMARY_ROWS + 2);
  rig.hub.close();
});

test("both capabilities refuse bad input with validation.bad_input and change nothing", async () => {
  const rig = liveRig();
  const h = admin(rig);
  const head = rig.r.s.host.store.head.seq;
  for (const bad of [{ personId: "", reason: "removed" }, { personId: BO, reason: "because" }, { personId: BO, reason: "removed", deviceId: 4 }]) {
    await assert.rejects(h["sync.epoch.bump"](adminCtx, bad as never), (e: unknown) => errCode(e) === "validation.bad_input");
  }
  for (const bad of [{ resourceType: "", resourceId: "x" }, { resourceType: "record" }]) {
    await assert.rejects(h["sync.acl.reindex"](adminCtx, bad as never), (e: unknown) => errCode(e) === "validation.bad_input");
  }
  assert.equal(rig.r.s.host.store.head.seq, head, "nothing was appended");
  assert.equal(rig.r.s.host.tx.get<{ n: number }>("SELECT count(*) AS n FROM sync_epoch")?.n, 0, "and no epoch moved");
  rig.hub.close();
});

// P-L1_05 final run: this file shows its own ok line (purge.server.test.ts) in the run on the last commit.
