// Where a turn runs (ARCH 6.3, spec b8, owner order of 3 Nov): private chats on the asker's own computers or servers, else the Space's server; group chats and everything the Space does on its own on the server.
import test from "node:test";
import assert from "node:assert/strict";
import { DEVICE_OFF_LINE, LOCAL_RUNS_OFF_LINE, isPrivate, placeTurn } from "../src/placement/index.ts";
import type { PlaceDevice, PlaceInput } from "../src/placement/index.ts";

const laptop: PlaceDevice = { id: "dev_laptop", role: "daemon", online: true, engines: ["claude_code", "anthropic"], lastSeen: 100 };
const phone: PlaceDevice = { id: "dev_phone", role: "client", online: true, engines: [], lastSeen: 200 };

type Over = Omit<Partial<PlaceInput>, "thread" | "asker"> & { thread?: Partial<PlaceInput["thread"]>; asker?: Partial<PlaceInput["asker"]> };

function input(over: Over = {}): PlaceInput {
  return {
    thread: { kind: "chat", persons: 1, ...over.thread },
    item: over.item ?? { kind: "message" },
    agent: over.agent ?? { hasComputer: false },
    engine: over.engine ?? "claude_code",
    asker: { devices: [laptop, phone], localRuns: true, runtimeOptIn: true, ...over.asker },
    ...(over.space ? { space: over.space } : {}),
  };
}

test("a private chat runs on the asker's own computer", () => {
  assert.deepEqual(placeTurn(input()), { placement: "device", reason: "other_device", deviceId: "dev_laptop" }, "the person is not on it, but it is theirs and awake");
  assert.deepEqual(placeTurn(input({ asker: { current: "dev_laptop" } })), { placement: "device", reason: "device", deviceId: "dev_laptop" });
  assert.deepEqual(placeTurn(input({ thread: { kind: "helper" } })).placement, "device", "a helper chat is the parent's private chat");
  assert.deepEqual(placeTurn(input({ thread: { kind: "ask" } })).placement, "device", "an Ask pane on something only they can see is a private chat");
  assert.deepEqual(placeTurn(input({ item: { kind: "wake", origin: "message" } })).placement, "device", "a private chat's wake follows the same rule");
});

test("the most recently seen eligible device wins, and a device that cannot run the engine is passed over", () => {
  const a: PlaceDevice = { id: "dev_a", role: "daemon", online: true, engines: ["codex"], lastSeen: 500 };
  const b: PlaceDevice = { id: "dev_b", role: "daemon", online: true, engines: ["codex", "claude_code"], lastSeen: 300 };
  const c: PlaceDevice = { id: "dev_c", role: "daemon", online: true, engines: ["claude_code"], lastSeen: 300 };
  assert.equal(placeTurn(input({ asker: { devices: [a, b, c] } })).deviceId, "dev_b", "a is newest but does not run claude_code; b and c tie, the lower id wins");
  assert.equal(placeTurn(input({ asker: { devices: [a, b, c], current: "dev_c" } })).deviceId, "dev_c", "the one in use wins the tie and the age");
  assert.equal(placeTurn(input({ engine: "codex", asker: { devices: [a, b, c] } })).deviceId, "dev_a");
});

test("group chats, channels, run chats and Ask on a shared record run on the server, whatever devices are online", () => {
  assert.deepEqual(placeTurn(input({ thread: { persons: 2 } })), { placement: "host", reason: "shared_thread" });
  assert.deepEqual(placeTurn(input({ thread: { kind: "channel", persons: 1 } })), { placement: "host", reason: "shared_thread" });
  assert.deepEqual(placeTurn(input({ thread: { kind: "run" } })), { placement: "host", reason: "shared_thread" });
  assert.deepEqual(placeTurn(input({ thread: { kind: "ask", onSharedRecord: true } })), { placement: "host", reason: "shared_thread" });
  assert.deepEqual(placeTurn(input({ thread: { kind: "thread", persons: 3 } })), { placement: "host", reason: "shared_thread" });
  assert.deepEqual(placeTurn(input({ thread: { kind: "channel" }, item: { kind: "wake" } })), { placement: "host", reason: "wake_shared" });
});

test("routines, automations, Journeys and background waits run on the server", () => {
  for (const origin of ["routine", "automation", "journey", "wait"] as const) {
    assert.deepEqual(placeTurn(input({ item: { kind: "message", origin } })), { placement: "host", reason: "routine" }, origin);
  }
});

test("an agent with a computer runs on the server", () => {
  assert.deepEqual(placeTurn(input({ agent: { hasComputer: true } })), { placement: "host", reason: "agent_computer" });
});

test("a phone or web asker has no computer joined: the chat runs on the Space's server, which is allowed by default", () => {
  assert.deepEqual(placeTurn(input({ asker: { devices: [phone] } })), { placement: "host", reason: "space" });
  assert.deepEqual(placeTurn(input({ asker: { devices: [] } })), { placement: "host", reason: "space" });
});

test("Automatic follows one order: the computer in use, another awake computer of theirs, a server of their own, the Space's server", () => {
  const desk: PlaceDevice = { id: "dev_desk", role: "daemon", online: true, engines: ["claude_code"], lastSeen: 900 };
  const off: PlaceDevice = { ...laptop, online: false };
  const home = { serverId: "srv_home", name: "home-box", online: true };
  // 1. the one in use wins over a more recently seen one
  assert.deepEqual(placeTurn(input({ asker: { devices: [laptop, desk], current: "dev_laptop" } })), { placement: "device", reason: "device", deviceId: "dev_laptop" });
  // 2. the one in use is off (or is a phone): another awake computer of theirs
  assert.deepEqual(placeTurn(input({ asker: { devices: [off, desk, phone], current: "dev_laptop" } })), { placement: "device", reason: "other_device", deviceId: "dev_desk" });
  assert.deepEqual(placeTurn(input({ asker: { devices: [desk, phone], current: "dev_phone" } })), { placement: "device", reason: "other_device", deviceId: "dev_desk" });
  // 3. no computer awake: their own server
  assert.deepEqual(placeTurn(input({ asker: { devices: [off], servers: [home] } })), { placement: "host", reason: "own_server", nodeId: "srv_home" });
  assert.deepEqual(placeTurn(input({ asker: { devices: [off], servers: [{ ...home, online: false }] } })), { placement: "host", reason: "space" }, "a server that is off is passed over");
  // 4. nothing of theirs: the Space's server, when the Space allows it
  assert.deepEqual(placeTurn(input({ asker: { devices: [off] } })), { placement: "host", reason: "space" });
  assert.deepEqual(placeTurn(input({ asker: { devices: [off] }, space: { shared: false } })), { placement: "wait", reason: "device_off", wakeLine: DEVICE_OFF_LINE }, "a Space that keeps its server for itself makes the turn wait");
  assert.deepEqual(placeTurn(input({ asker: { devices: [off], runtimeOptIn: false } })), { placement: "wait", reason: "device_off", wakeLine: DEVICE_OFF_LINE }, "so does a person who turned off letting the Space continue their chats");
  assert.equal(DEVICE_OFF_LINE, "Your computer is off");
});

test("a Personal Space has no step 4: its host is the person's own computer", () => {
  const off: PlaceDevice = { ...laptop, online: false };
  const personal = { shared: false, hostIsAsker: true };
  assert.deepEqual(placeTurn(input({ asker: { devices: [off] }, space: personal })), { placement: "host", reason: "own_host" });
  assert.deepEqual(placeTurn(input({ asker: { devices: [laptop], current: "dev_laptop" }, space: personal })), { placement: "device", reason: "device", deviceId: "dev_laptop" });
});

test("a computer that does not run the engine is passed over", () => {
  const other: PlaceDevice = { ...laptop, engines: ["codex"] };
  assert.equal(placeTurn(input({ asker: { devices: [other] } })).reason, "space");
  assert.equal(placeTurn(input({ asker: { devices: [other] }, space: { shared: false } })).placement, "wait");
});

test("'run my private chats on my computers' off skips them, with its own line when nothing else may run it", () => {
  assert.deepEqual(placeTurn(input({ asker: { localRuns: false } })), { placement: "host", reason: "space" });
  assert.deepEqual(placeTurn(input({ asker: { localRuns: false }, space: { shared: false } })), { placement: "wait", reason: "device_off", wakeLine: LOCAL_RUNS_OFF_LINE });
});

test("what makes a thread private", () => {
  assert.equal(isPrivate({ kind: "chat", persons: 1 }), true);
  assert.equal(isPrivate({ kind: "chat", persons: 0 }), true, "a chat with only agents");
  assert.equal(isPrivate({ kind: "chat", persons: 2 }), false);
  assert.equal(isPrivate({ kind: "channel", persons: 1 }), false);
  assert.equal(isPrivate({ kind: "run", persons: 1 }), false);
  assert.equal(isPrivate({ kind: "ask", persons: 1, onSharedRecord: true }), false);
  assert.equal(isPrivate({ kind: "ask", persons: 1 }), true);
});

test("the answer has the shape of engine.placement.decide", () => {
  const all = [input(), input({ thread: { persons: 2 } }), input({ asker: { devices: [] } }), input({ asker: { devices: [{ ...laptop, online: false }] }, space: { shared: false } })].map(placeTurn);
  for (const p of all) {
    assert.ok(["host", "device", "wait"].includes(p.placement));
    assert.equal(typeof p.reason, "string");
    assert.equal(p.wakeLine !== undefined, p.placement === "wait", "only a waiting turn has a line");
    assert.equal(p.deviceId !== undefined, p.placement === "device", "only a device placement names a device (here: no pinned computer)");
  }
});

test("a chat pinned to the Space runs on the Space; pinned to one of their servers it runs there while the server is on, and waits with its name when it is off", () => {
  assert.deepEqual(placeTurn(input({ asker: { chosen: { target: "space" } } })), { placement: "host", reason: "chosen_space" });
  const on = { target: "server" as const, serverId: "srv_home", online: true, name: "home-box" };
  assert.deepEqual(placeTurn(input({ asker: { chosen: on } })), { placement: "host", reason: "chosen_server", nodeId: "srv_home" });
  assert.deepEqual(placeTurn(input({ asker: { chosen: { ...on, online: false } } })), { placement: "wait", reason: "server_off", nodeId: "srv_home", wakeLine: "home-box is off" }, "never moved to another machine");
  assert.equal(placeTurn(input({ asker: { chosen: { target: "server", serverId: "srv_x", online: false } } })).wakeLine, "Your server is off");
});

test("a chat pinned to a computer runs there and waits for it when it is off, even when the Space may run it; the pin wins over an agent's own computer but never over what the Space runs by itself or a shared chat", () => {
  const off = { ...laptop, online: false };
  const desk: PlaceDevice = { id: "dev_desk", role: "daemon", online: true, engines: ["claude_code"], lastSeen: 900 };
  assert.deepEqual(placeTurn(input({ asker: { chosen: { target: "device", deviceId: "dev_laptop" }, devices: [off, desk] } })), { placement: "wait", reason: "device_off", deviceId: "dev_laptop", wakeLine: DEVICE_OFF_LINE }, "never moved to the other computer or the Space");
  assert.deepEqual(placeTurn(input({ asker: { chosen: { target: "device", deviceId: "dev_laptop" }, devices: [laptop, desk] } })), { placement: "device", reason: "chosen_device", deviceId: "dev_laptop" });
  assert.deepEqual(placeTurn(input({ asker: { chosen: { target: "device" }, devices: [off] } })), { placement: "wait", reason: "device_off", wakeLine: DEVICE_OFF_LINE });
  assert.equal(placeTurn(input({ asker: { devices: [off] } })).placement, "host", "unpinned, Automatic moves it to the Space");
  assert.equal(placeTurn(input({ agent: { hasComputer: true }, asker: { chosen: { target: "device" } } })).placement, "device");
  assert.equal(placeTurn(input({ agent: { hasComputer: true } })).reason, "agent_computer");
  assert.equal(placeTurn(input({ item: { kind: "message", origin: "routine" }, asker: { chosen: { target: "device" } } })).reason, "routine");
  assert.equal(placeTurn(input({ thread: { persons: 2 }, asker: { chosen: { target: "device" } } })).reason, "shared_thread");
});

test("a crew teammate's thread runs on the host, whatever device is online and wherever the chat was pinned", () => {
  const device = { id: "dev_a", role: "daemon" as const, online: true, engines: ["claude_code"], lastSeen: 1 };
  const base = input({ asker: { devices: [device], chosen: { target: "device" } } });
  assert.equal(placeTurn(base).placement, "device", "an ordinary private chat runs on the device");
  assert.deepEqual(placeTurn({ ...base, thread: { ...base.thread, crew: true } }), { placement: "host", reason: "crew" });
});

test("Automatic skips a busy machine for the next one with room and says where it would have gone and why not", () => {
  const busy: PlaceDevice = { ...laptop, name: "Irfad's MacBook Pro", busy: true, busyWhy: "it was busy, 4 of 4 turns running" };
  const mini: PlaceDevice = { id: "dev_mini", role: "daemon", online: true, engines: ["claude_code"], lastSeen: 50, name: "Irfad's Mac mini" };
  assert.deepEqual(placeTurn(input({ asker: { devices: [busy, mini] } })), { placement: "device", reason: "other_device", deviceId: "dev_mini", moved: { from: "Irfad's MacBook Pro", why: "it was busy, 4 of 4 turns running" } }, "the order is kept, the busy one is passed over");
  assert.equal(placeTurn(input({ asker: { devices: [laptop, mini] } })).moved, undefined, "nothing moved when the first has room");
  const server = { serverId: "srv_box", name: "Berlin box", online: true };
  assert.deepEqual(placeTurn(input({ asker: { devices: [busy], servers: [server] } })), { placement: "host", reason: "own_server", nodeId: "srv_box", moved: { from: "Irfad's MacBook Pro", why: "it was busy, 4 of 4 turns running" } }, "then their servers");
  assert.deepEqual(placeTurn(input({ asker: { devices: [busy], servers: [{ ...server, busy: true, busyWhy: "its disk was nearly full" }] } })), { placement: "host", reason: "space", moved: { from: "Irfad's MacBook Pro", why: "it was busy, 4 of 4 turns running" } }, "then the Space's server");
  const all = placeTurn(input({ asker: { devices: [busy], servers: [{ ...server, busy: true }] }, space: { shared: true, busy: true } }));
  assert.deepEqual([all.placement, all.deviceId, all.moved], ["device", "dev_laptop", undefined], "every one busy: the first in the order takes it and the turn queues there");
  assert.equal(placeTurn(input({ asker: { devices: [{ ...busy, busy: true }], chosen: { target: "device", deviceId: "dev_laptop" } } })).reason, "chosen_device", "a pin is never moved, busy or not");
});
