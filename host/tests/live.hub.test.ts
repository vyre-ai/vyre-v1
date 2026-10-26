// The host live socket on sync's purge path (P-L1_17, ARCH 5.7, 5.9): sync.setLiveHub takes the host hub (purge, purgeDevice), so a revoke closes the revoked device's socket
// with a purge frame while the person's other device keeps receiving. Real sockets over node:http, the real sync purge handler over a real sync store.
// @reads /host/src/ws.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { EventEnvelope } from "../../packages/contracts/src/envelope.ts";
import { createLiveHub } from "../src/ws.ts";
import { createSyncLiveHub } from "../../modules/sync/handlers/live.ts";
import { systemClock } from "../../sync/src/live/transport.ts";
import { createConnection, endpoint } from "../../client/src/connection/index.ts";
import type { EventBatch, Mode, Transport } from "../../client/src/connection/index.ts";

import { createPurgeHandlers, purgeDepsOf } from "../../modules/sync/handlers/purge.ts";
import { pushRig } from "../../modules/sync/tests/push.rig.test.ts";

const SPACE = "spc_1";
const OLIVIA = "usr_olivia";
const TOKENS: Record<string, { person: string; device: string }> = {
  phone: { person: OLIVIA, device: "dev_phone" }, laptop: { person: OLIVIA, device: "dev_laptop" }, ada: { person: "usr_ada", device: "dev_ada" },
};
const TRACE = "a".repeat(32);

async function connect(port: number, token: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/sync/v1/ws?token=${token}`);
  const frames: Record<string, unknown>[] = [];
  const waiting: Array<{ t: string; resolve: (f: Record<string, unknown>) => void }> = [];
  let closed: number | null = null;
  const onClose: Array<(c: number) => void> = [];
  ws.addEventListener("message", (m) => {
    const f = JSON.parse(String(m.data)) as Record<string, unknown>;
    const i = waiting.findIndex((w) => w.t === f["t"]);
    if (i >= 0) waiting.splice(i, 1)[0]!.resolve(f); else frames.push(f);
  });
  ws.addEventListener("close", (e) => { closed = e.code; for (const f of onClose) f(e.code); });
  await new Promise<void>((resolve, reject) => { ws.addEventListener("open", () => resolve()); ws.addEventListener("error", () => reject(new Error("could not connect"))); });
  ws.send(JSON.stringify({ t: "hello", cursor: 0 }));
  const frame = (t: string, ms = 2000): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    const i = frames.findIndex((f) => f["t"] === t);
    if (i >= 0) { resolve(frames.splice(i, 1)[0]!); return; }
    const timer = setTimeout(() => reject(new Error(`no ${t} frame`)), ms);
    waiting.push({ t, resolve: (f) => { clearTimeout(timer); resolve(f); } });
  });
  const closedWith = (ms = 2000): Promise<number> => new Promise((resolve, reject) => {
    if (closed !== null) { resolve(closed); return; }
    const timer = setTimeout(() => reject(new Error("socket stayed open")), ms);
    onClose.push((c) => { clearTimeout(timer); resolve(c); });
  });
  await frame("hello_ok");
  return { frame, closedWith, isOpen: () => closed === null, close: () => ws.close() };
}

async function boot() {
  const rig = pushRig();
  rig.access.putPrincipal({ id: OLIVIA, kind: "person", status: "active", name: OLIVIA });
  rig.access.addPrincipalRole({ holder: OLIVIA, role: "owner" });
  const hub = createLiveHub({
    session: (_h, url) => { const t = TOKENS[url.searchParams.get("token") ?? ""]; return t ? { space: SPACE, principal: { kind: "person", id: t.person }, device: t.device } : null; },
    head: () => 0,
  });
  const port = await hub.listen();
  // what sync.setLiveHub receives on the host: the hub itself
  const admin = createPurgeHandlers(purgeDepsOf(rig.s, hub));
  const event = (seq: number): EventEnvelope => ({ seq, traceId: TRACE, type: "example.said" } as unknown as EventEnvelope);
  return { hub, port, admin, event, close: () => hub.close() };
}
const bump = (w: Awaited<ReturnType<typeof boot>>, input: Parameters<ReturnType<typeof createPurgeHandlers>["sync.epoch.bump"]>[1]) =>
  w.admin["sync.epoch.bump"]({ trace: { traceId: TRACE }, principal: "svc_host" }, input);

test("revoking a device closes its open socket within a second and the other device keeps receiving", async (t) => {
  const w = await boot();
  t.after(w.close);
  const phone = await connect(w.port, "phone");
  const laptop = await connect(w.port, "laptop");
  const ada = await connect(w.port, "ada");
  assert.equal(w.hub.connections(SPACE).length, 3);

  const t0 = Date.now();
  const { epoch } = await bump(w, { personId: OLIVIA, reason: "device_revoked", deviceId: "dev_phone" });
  const purge = await phone.frame("purge");
  assert.equal(purge["epoch"], epoch, "the purge frame carries the new epoch");
  assert.equal(await phone.closedWith(), 4003);
  assert.ok(Date.now() - t0 < 1000, "closed within a second");

  assert.deepEqual(w.hub.connections(SPACE).map((c) => c.device).sort(), ["dev_ada", "dev_laptop"]);
  w.hub.publish(SPACE, [w.event(1)]);
  assert.equal((await laptop.frame("ev"))["seq"], 1, "the person's other device keeps receiving");
  assert.equal((await ada.frame("ev"))["seq"], 1);
  assert.ok(laptop.isOpen() && ada.isOpen());
});

test("an epoch bump for a person (no device) closes every socket of theirs and nobody else's", async (t) => {
  const w = await boot();
  t.after(w.close);
  const phone = await connect(w.port, "phone");
  const laptop = await connect(w.port, "laptop");
  const ada = await connect(w.port, "ada");
  await bump(w, { personId: OLIVIA, reason: "suspended" });
  assert.equal(await phone.closedWith(), 4004);
  assert.equal(await laptop.closedWith(), 4004);
  assert.ok((await phone.frame("purge"))["epoch"] !== undefined);
  assert.ok(ada.isOpen());
  assert.equal(w.hub.purge(OLIVIA, 9), 0, "nothing left to close");
});

// ---- the real client manager against the host socket on sync's hub

async function bootSync() {
  const rig = pushRig();
  rig.access.putPrincipal({ id: OLIVIA, kind: "person", status: "active", name: OLIVIA });
  rig.access.addPrincipalRole({ holder: OLIVIA, role: "owner" });
  for (const type of ["record", "thread", "space", "file", "number"]) rig.access.putGrant({ id: `gr_olivia_${type}`, subject_kind: "actor", subject_id: OLIVIA, resource_type: type, resource_id: null, level: "manage" });
  const syncHub = createSyncLiveHub(rig.s.deps, { clock: systemClock, registryHash: "h1" });
  const hub = createLiveHub({
    session: (_h, url) => { const t = TOKENS[url.searchParams.get("token") ?? ""]; return t ? { space: SPACE, principal: { kind: "person", id: t.person }, device: t.device } : null; },
    head: () => 0, sync: syncHub,
  });
  const port = await hub.listen();
  const admin = createPurgeHandlers(purgeDepsOf(rig.s, hub));
  const dial = (token: string) => async (ep: { url: string }): Promise<Transport> => {
    const ws = new WebSocket(`${ep.url}/sync/v1/ws?token=${token}`);
    await new Promise<void>((resolve, reject) => { ws.addEventListener("open", () => resolve()); ws.addEventListener("error", () => reject(new Error("could not connect"))); });
    return {
      send: (f) => ws.send(JSON.stringify(f)),
      close: () => ws.close(),
      onFrame: (cb) => ws.addEventListener("message", (m) => cb(JSON.parse(String(m.data)))),
      onClose: (cb) => ws.addEventListener("close", () => cb("closed")),
    };
  };
  const client = (token: string, device: string, epoch = 0) => {
    const state = { cursor: 0, batches: [] as EventBatch[], modes: [] as Mode[], purged: [] as number[], statuses: [] as string[] };
    const conn = createConnection({
      space: SPACE, endpoints: [endpoint("direct", `ws://127.0.0.1:${port}`)], dial: dial(token),
      hello: () => ({ deviceId: device, deviceClass: "desktop", appVersion: "1.0.0", registryHash: "h1", epoch, replica: { entities: {} } }),
      cursor: { get: () => state.cursor, set: (n) => { state.cursor = n; } },
      apply: (b) => { state.batches.push(b); },
      on: { status: (st) => state.statuses.push(st), mode: (m) => state.modes.push(m), purge: (e) => state.purged.push(e) },
    });
    return { conn, state };
  };
  return { rig, hub, port, admin, client, close: () => hub.close() };
}
const until = async (ok: () => boolean, ms = 2000): Promise<void> => { const t0 = Date.now(); while (!ok()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 10)); } };

test("the real client manager completes a hello against the host socket and reaches live, then receives a committed row", async (t) => {
  const w = await bootSync();
  t.after(w.close);
  const laptop = w.client("laptop", "dev_laptop");
  t.after(() => laptop.conn.stop());
  laptop.conn.start();
  await until(() => laptop.conn.status() === "live");
  assert.deepEqual(laptop.state.modes, [], "mode live is not reported as an exception");
  const seq = w.rig.seed("contact", "c1", { name: "Ann", email: "a@example.com", phone: "+1", region: "eu", stage: "lead", owner: OLIVIA });
  w.hub.publish(SPACE, []);   // the log committed
  await until(() => laptop.state.batches.length > 0);
  assert.equal(laptop.state.batches[0]?.items[0]?.id, "c1");
  await until(() => laptop.state.cursor >= seq);
});

test("revoking a device on the sync hub: the real client of that device is told to purge, the other keeps its live link", async (t) => {
  const w = await bootSync();
  t.after(w.close);
  const phone = w.client("phone", "dev_phone");
  const laptop = w.client("laptop", "dev_laptop");
  t.after(() => { phone.conn.stop(); laptop.conn.stop(); });
  phone.conn.start(); laptop.conn.start();
  await until(() => phone.conn.status() === "live" && laptop.conn.status() === "live");
  const t0 = Date.now();
  const { epoch } = await w.admin["sync.epoch.bump"]({ trace: { traceId: TRACE }, principal: "svc_host" }, { personId: OLIVIA, reason: "device_revoked", deviceId: "dev_phone" });
  await until(() => phone.state.purged.length > 0, 1000);
  assert.equal(phone.state.purged[0], epoch);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(laptop.conn.status(), "live");
  assert.deepEqual(laptop.state.purged, []);
});
