// The host live socket on sync's purge path (P-L1_17, ARCH 5.7, 5.9): sync.setLiveHub takes the host hub (purge, purgeDevice), so a revoke closes the revoked device's socket
// with a purge frame while the person's other device keeps receiving. Real sockets over node:http, the real sync purge handler over a real sync store.
// @reads /host/src/ws.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { EventEnvelope } from "../../packages/contracts/src/envelope.ts";
import { createLiveHub } from "../src/ws.ts";
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
