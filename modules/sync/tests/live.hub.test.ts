// @reads /modules/sync/migrations/0001_pull.sql
// The live hub (ARCH 5.9) spoken to with raw frames: hello modes, catch-up, fan-out in the commit tick, filtering, backpressure, heartbeat, purge.
import test from "node:test";
import assert from "node:assert/strict";
import { memoryLink } from "../../../client/src/connection/index.ts";
import type { MemoryLink } from "../../../client/src/connection/index.ts";
import { HEARTBEAT_DEAD_MS, HEARTBEAT_MS, parseFrame } from "../../../sync/src/protocol.ts";
import type { Frame } from "../../../sync/src/protocol.ts";
import type { LiveWho } from "../../../sync/src/live/index.ts";
import { ADA, BO, CY } from "../fixtures/world.ts";
import { liveRig, settle } from "./live.rig.test.ts";
import type { LiveRig } from "./live.rig.test.ts";

interface Raw { link: MemoryLink; frames: Frame[]; send(f: unknown): void; ofType<T extends Frame["t"]>(t: T): Extract<Frame, { t: T }>[] }

function raw(rig: LiveRig, who: LiveWho): Raw {
  const link = memoryLink();
  const frames: Frame[] = [];
  link.client.onFrame((f) => { const p = parseFrame(f); assert.ok(p.ok, p.ok ? "" : p.error); if (p.ok) frames.push(p.value); });
  rig.hub.accept(link.server, who);
  return { link, frames, send: (f) => link.client.send(f), ofType: (t) => frames.filter((f): f is Extract<Frame, { t: typeof t }> => f.t === t) as never };
}
const who = (person: string, device = "dev1"): LiveWho => ({ person, device, deviceClass: "desktop" });
const hello = (over: Record<string, unknown> = {}) => ({ t: "hello", hello: { deviceId: "dev1", deviceClass: "desktop", appVersion: "1.0.0", registryHash: "h1", cursor: 0, epoch: 0, replica: { entities: {} }, ...over } });

test("hello answers live, and the hub catches the device up from its cursor with filtered batches", async () => {
  const rig = liveRig();
  rig.row("c1"); rig.row("c2", { region: "us" });
  const ada = raw(rig, who(ADA)), bo = raw(rig, who(BO, "dev_bo")), cy = raw(rig, who(CY, "dev_cy"));
  for (const c of [ada, bo, cy]) c.send(hello());
  await settle();
  assert.equal(ada.ofType("hello_ok")[0]!.ok.mode, "live");
  const ids = (c: Raw) => c.ofType("ev").flatMap((e) => e.items.map((i) => i.id));
  assert.deepEqual(ids(ada), ["c1", "c2"]);
  assert.deepEqual(ids(bo), ["c1"], "bo sees region eu only");
  assert.equal(bo.ofType("ev")[0]!.items[0]!.fields["phone"], undefined, "and not the phone field");
  assert.deepEqual(ids(cy), []);
  assert.equal(cy.ofType("ev").length, 0, "nothing visible, nothing sent");
  assert.ok(ada.ofType("ev")[0]!.seq >= ada.ofType("ev")[0]!.items[0]!.seq);
  rig.hub.close();
});

test("a device that says hello with its cursor gets only what is after it", async () => {
  const rig = liveRig();
  const s1 = rig.row("c1");
  rig.row("c2");
  const c = raw(rig, who(ADA));
  c.send(hello({ cursor: s1 }));
  await settle();
  assert.deepEqual(c.ofType("ev").flatMap((e) => e.items.map((i) => i.id)), ["c2"]);
  rig.hub.close();
});

test("a commit reaches live sessions in the same tick, numbered, and only those who may see it", async () => {
  const rig = liveRig();
  const ada = raw(rig, who(ADA)), bo = raw(rig, who(BO, "dev_bo"));
  ada.send(hello()); bo.send(hello());
  await settle();
  const before = ada.ofType("ev").length;
  const seq = rig.row("c9", { region: "us" });
  rig.hub.commit();
  await settle();
  const evs = ada.ofType("ev").slice(before);
  assert.equal(evs.length, 1);
  assert.equal(evs[0]!.seq, seq);
  assert.equal(evs[0]!.items[0]!.id, "c9");
  assert.equal(bo.ofType("ev").length, 0, "bo may not see region us");
  rig.hub.close();
});

test("a row leaving a person's view arrives as hide in a batch, once", async () => {
  const rig = liveRig();
  rig.row("c1");
  const bo = raw(rig, who(BO, "dev_bo"));
  bo.send(hello());
  await settle();
  bo.send({ t: "ack", seq: bo.ofType("ev").at(-1)!.seq });
  await settle();
  const seq = rig.patch("c1", { region: "us" });
  rig.hub.commit();
  await settle();
  const ev = bo.ofType("ev").at(-1)!;
  assert.deepEqual(ev.hide, [{ entity: "contact", id: "c1", seq }]);
  assert.deepEqual(ev.items, []);
  rig.hub.commit();
  await settle();
  assert.equal(bo.ofType("ev").length, 2, "a second commit with nothing new sends nothing");
  rig.hub.close();
});

test("backpressure: with `window` batches unacked the hub sends one pull_hint and waits; an ack resumes the stream", async () => {
  const rig = liveRig({ window: 2, batch: 1 });
  const c = raw(rig, who(ADA));
  c.send(hello());
  await settle();
  for (let i = 0; i < 5; i++) rig.row(`c${i}`);
  rig.hub.commit();
  rig.hub.commit();
  await settle();
  assert.equal(c.ofType("ev").length, 2, "two batches in flight, no more");
  assert.equal(c.ofType("pull_hint").length, 1, "one hint, not one per commit");
  const [first, second] = c.ofType("ev");
  c.send({ t: "ack", seq: first!.seq });
  await settle();
  assert.equal(c.ofType("ev").length, 3, "an ack frees a slot");
  c.send({ t: "ack", seq: second!.seq });
  await settle();
  assert.equal(c.ofType("ev").length, 4);
  rig.hub.close();
});

test("hello modes: an older client is read-only, a cursor ahead of the log is a resync, a lower epoch is a purge", async () => {
  const rig = liveRig({ olderRegistryHashes: ["h0"] });
  rig.row("c1");
  const old = raw(rig, who(ADA, "d1"));
  old.send(hello({ registryHash: "h0" }));
  const ahead = raw(rig, who(ADA, "d2"));
  ahead.send(hello({ cursor: 9999 }));
  rig.r.s.setEpoch(ADA, 4);
  const stale = raw(rig, who(ADA, "d3"));
  stale.send(hello({ epoch: 1 }));
  await settle();
  assert.equal(old.ofType("hello_ok")[0]!.ok.mode, "update_required");
  assert.equal(old.ofType("ev").length, 0, "no events to a read-only client");
  assert.equal(ahead.ofType("hello_ok")[0]!.ok.mode, "resync");
  assert.equal(ahead.ofType("ev").length, 0);
  assert.equal(stale.ofType("hello_ok")[0]!.ok.mode, "purge");
  assert.deepEqual(stale.ofType("purge").map((p) => p.epoch), [4]);
  assert.equal(stale.link.isOpen(), false, "a purged device is disconnected");
  rig.hub.close();
});

test("heartbeat: the hub sends hb every 15 s and answers a client hb with the head; a silent client is closed at 40 s", async () => {
  const rig = liveRig();
  const quiet = raw(rig, who(ADA, "quiet")), chatty = raw(rig, who(ADA, "chatty"));
  quiet.send(hello()); chatty.send(hello());
  await settle();
  chatty.send({ t: "hb", seq: 0 });
  await settle();
  assert.equal(chatty.ofType("hb").length, 1, "answered");
  for (let t = 0; t < HEARTBEAT_DEAD_MS + HEARTBEAT_MS; t += HEARTBEAT_MS) { rig.sched.advance(HEARTBEAT_MS); chatty.send({ t: "hb", seq: 0 }); await settle(); }
  assert.ok(chatty.ofType("hb").length >= 4);
  assert.equal(quiet.link.isOpen(), false, "no frame for 40 s");
  assert.equal(chatty.link.isOpen(), true);
  assert.equal(rig.hub.sessions(), 1);
  rig.hub.close();
});

test("a link that never says hello, sends a frame before hello, or sends garbage is closed", async () => {
  const rig = liveRig();
  const silent = raw(rig, who(ADA, "s1"));
  const early = raw(rig, who(ADA, "s2"));
  early.send({ t: "ack", seq: 1 });
  const bad = raw(rig, who(ADA, "s3"));
  bad.link.client.send({ nonsense: true });
  await settle();
  assert.equal(early.link.isOpen(), false);
  assert.equal(bad.link.isOpen(), false);
  assert.equal(silent.link.isOpen(), true);
  rig.sched.advance(10_001); await settle();
  assert.equal(silent.link.isOpen(), false, "10 s without a hello");
  rig.hub.close();
});

test("purge: every connection of the person gets the frame and is closed; other people stay", async () => {
  const rig = liveRig();
  const a1 = raw(rig, who(ADA, "d1")), a2 = raw(rig, who(ADA, "d2")), b = raw(rig, who(BO, "d3"));
  for (const c of [a1, a2, b]) c.send(hello());
  await settle();
  assert.equal(rig.hub.purge(ADA, 7), 2);
  await settle();
  assert.deepEqual(a1.ofType("purge").map((p) => p.epoch), [7]);
  assert.deepEqual(a2.ofType("purge").map((p) => p.epoch), [7]);
  assert.equal(a1.link.isOpen() || a2.link.isOpen(), false);
  assert.equal(b.link.isOpen(), true);
  rig.hub.close();
});

test("a device holds at most two connections: the third closes the oldest", async () => {
  const rig = liveRig();
  const links = [raw(rig, who(ADA)), raw(rig, who(ADA)), raw(rig, who(ADA))];
  for (const l of links) { l.send(hello()); await settle(); }
  assert.equal(rig.hub.sessionsOf(ADA, "dev1"), 2);
  assert.equal(links[0]!.link.isOpen(), false);
  assert.equal(links[2]!.link.isOpen(), true);
  rig.hub.close();
});

test("an acked seq moves the session's acked mark; an older ack changes nothing", async () => {
  const rig = liveRig();
  rig.row("c1"); rig.row("c2");
  const link = memoryLink();
  const s = rig.hub.accept(link.server, who(ADA));
  link.client.send(hello());
  await settle();
  assert.equal(s.mode(), "live");
  const sent = s.sent();
  assert.ok(sent > 0);
  assert.equal(s.acked(), 0);
  link.client.send({ t: "ack", seq: sent });
  await settle();
  assert.equal(s.acked(), sent);
  link.client.send({ t: "ack", seq: 1 });
  await settle();
  assert.equal(s.acked(), sent);
  rig.hub.close();
});
