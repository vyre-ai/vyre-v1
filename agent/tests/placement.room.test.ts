// Room left and placement by room (lane l-machines): a busy machine is skipped for the next one with room, the answer says why, and a pin is never moved.
import test from "node:test";
import assert from "node:assert/strict";
import { BUSY_BELOW, movedLine, placeTurn, roomLeft } from "../src/placement/index.ts";
import type { PlaceDevice, PlaceInput, PlaceRoom } from "../src/placement/index.ts";

const mac: PlaceDevice = { id: "dev_mac", role: "daemon", online: true, engines: ["claude_code"], lastSeen: 300, name: "Irfad's MacBook Pro" };
const mini: PlaceDevice = { id: "dev_mini", role: "daemon", online: true, engines: ["claude_code"], lastSeen: 200, name: "Irfad's Mac mini" };
const full: PlaceRoom = { score: 0, why: "4 of 4 turns" };
const free: PlaceRoom = { score: 70, why: "CPU at 30%" };

const input = (over: Partial<PlaceInput> & { asker?: Partial<PlaceInput["asker"]> } = {}): PlaceInput => ({
  thread: { kind: "chat", persons: 1, ...over.thread }, item: { kind: "message" }, agent: { hasComputer: false }, engine: "claude_code",
  asker: { devices: [mac, mini], servers: [{ serverId: "srv_berlin", name: "Berlin box", online: true }], localRuns: true, runtimeOptIn: true, current: "dev_mac", ...over.asker },
  ...(over.rooms ? { rooms: over.rooms } : {}), ...(over.space ? { space: over.space } : {}),
});

test("room left is the tightest of CPU, memory, the turn limit and disk; offline and draining are 0", () => {
  assert.deepEqual(roomLeft({ online: true, draining: false, cpuPct: 30, memPct: 40, turns: 1, maxTurns: 4 }), { score: 63, tightest: "memory", why: "memory at 40%" });
  assert.equal(roomLeft({ online: true, draining: false, cpuPct: 30, memPct: 40, turns: 4, maxTurns: 4 }).score, 0);
  assert.equal(roomLeft({ online: true, draining: false, cpuPct: 30, memPct: 40, turns: 4, maxTurns: 4 }).why, "4 of 4 turns");
  assert.equal(roomLeft({ online: true, draining: false, cpuPct: 97, turns: 0 }).tightest, "cpu");
  assert.equal(roomLeft({ online: true, draining: false, diskFreePct: 4, turns: 0 }).tightest, "disk");
  assert.equal(roomLeft({ online: true, draining: false, diskFreePct: 40, turns: 0 }).score, 100, "plenty of disk is not a limit");
  assert.deepEqual(roomLeft({ online: false, draining: false, turns: 0 }), { score: 0, tightest: "offline", why: "offline" });
  assert.deepEqual(roomLeft({ online: true, draining: true, turns: 0 }), { score: 0, tightest: "draining", why: "draining" });
  assert.equal(roomLeft({ online: true, draining: false, turns: 3 }).score, 100, "no limit and no numbers: all the room there is");
});

test("the computer in use is full: the turn goes to the next computer with room and says what it skipped", () => {
  const p = placeTurn(input({ rooms: { dev_mac: full, dev_mini: free } }));
  assert.deepEqual(p, { placement: "device", reason: "other_device", deviceId: "dev_mini", movedFrom: { id: "dev_mac", name: "Irfad's MacBook Pro", why: "busy: 4 of 4 turns" } });
  assert.equal(movedLine(p.movedFrom!), "Moved from Irfad's MacBook Pro because it was busy: 4 of 4 turns");
});

test("both computers full: the turn goes to the server, then to the Space server", () => {
  const rooms = { dev_mac: full, dev_mini: { score: 3, why: "CPU at 97%" }, srv_berlin: free };
  const p = placeTurn(input({ rooms }));
  assert.equal(p.reason, "own_server");
  assert.equal(p.nodeId, "srv_berlin");
  assert.equal(p.movedFrom?.id, "dev_mac");
  const q = placeTurn(input({ rooms: { ...rooms, srv_berlin: { score: 0, why: "draining" } } }));
  assert.equal(q.reason, "space");
  assert.equal(q.movedFrom?.id, "dev_mac");
});

test("nothing has room: the first machine of the order keeps the turn, and nothing is said to have moved", () => {
  const p = placeTurn(input({ rooms: { dev_mac: full, dev_mini: full, srv_berlin: full, space: full } }));
  assert.deepEqual(p, { placement: "device", reason: "device", deviceId: "dev_mac" });
});

test("a machine the room table does not list has room, and below the busy line counts as busy", () => {
  assert.equal(placeTurn(input({ rooms: { dev_mini: free } })).deviceId, "dev_mac");
  assert.equal(placeTurn(input({ rooms: { dev_mac: { score: BUSY_BELOW - 1, why: "memory at 99%" }, dev_mini: free } })).deviceId, "dev_mini");
  assert.equal(placeTurn(input({ rooms: { dev_mac: { score: BUSY_BELOW, why: "x" }, dev_mini: free } })).deviceId, "dev_mac");
});

test("a pin is never moved, and a shared thread or an agent computer does not look at room", () => {
  const rooms = { dev_mac: full, dev_mini: free, space: free };
  const pinned = placeTurn(input({ rooms, asker: { chosen: { target: "device", deviceId: "dev_mac" } } }));
  assert.equal(pinned.deviceId, "dev_mac");
  assert.equal("movedFrom" in pinned, false);
  assert.equal(placeTurn(input({ rooms, thread: { kind: "channel", persons: 3 } as never })).reason, "shared_thread");
});

test("the Space's server is skipped when full too, but only if something else of theirs has room", () => {
  const p = placeTurn(input({ asker: { devices: [], servers: [] }, rooms: { space: full } }));
  assert.deepEqual(p, { placement: "host", reason: "space" });
});
