// Where a turn runs (ARCH 6.3, spec b8): private chats on the asker's own computer, group chats and everything the Space does on its own on the server.
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
    asker: { devices: [laptop, phone], localRuns: true, runtimeOptIn: false, ...over.asker },
  };
}

test("a private chat runs on the asker's own computer", () => {
  assert.deepEqual(placeTurn(input()), { placement: "device", reason: "device", deviceId: "dev_laptop" });
  assert.deepEqual(placeTurn(input({ thread: { kind: "helper" } })).placement, "device", "a helper chat is the parent's private chat");
  assert.deepEqual(placeTurn(input({ thread: { kind: "ask" } })).placement, "device", "an Ask pane on something only they can see is a private chat");
  assert.deepEqual(placeTurn(input({ item: { kind: "wake", origin: "message" } })).placement, "device", "a private chat's wake follows the same rule");
});

test("the most recently seen eligible device wins, and a device that cannot run the engine is passed over", () => {
  const a: PlaceDevice = { id: "dev_a", role: "daemon", online: true, engines: ["codex"], lastSeen: 500 };
  const b: PlaceDevice = { id: "dev_b", role: "daemon", online: true, engines: ["codex", "claude_code"], lastSeen: 300 };
  const c: PlaceDevice = { id: "dev_c", role: "daemon", online: true, engines: ["claude_code"], lastSeen: 300 };
  assert.equal(placeTurn(input({ asker: { devices: [a, b, c] } })).deviceId, "dev_b", "a is newest but does not run claude_code; b and c tie, the lower id wins");
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

test("routines, automations, Journeys, campaigns and background waits run on the server", () => {
  for (const origin of ["routine", "automation", "journey", "campaign", "wait"] as const) {
    assert.deepEqual(placeTurn(input({ item: { kind: "message", origin } })), { placement: "host", reason: "routine" }, origin);
  }
});

test("an agent with a computer runs on the server", () => {
  assert.deepEqual(placeTurn(input({ agent: { hasComputer: true } })), { placement: "host", reason: "agent_computer" });
});

test("a phone or web asker has no daemon: the chat runs on the server", () => {
  assert.deepEqual(placeTurn(input({ asker: { devices: [phone], runtimeOptIn: true } })), { placement: "host", reason: "no_daemon" });
  assert.deepEqual(placeTurn(input({ asker: { devices: [], runtimeOptIn: false } })), { placement: "host", reason: "no_daemon", needsRuntimeOptIn: true }, "the server needs the key the person's device wraps for it");
});

test("with the computer off a private chat continues on the server only for someone who opted in; otherwise it waits", () => {
  const off: PlaceDevice = { ...laptop, online: false };
  assert.deepEqual(placeTurn(input({ asker: { devices: [off, phone], runtimeOptIn: true } })), { placement: "host", reason: "device_off_runtime_opt_in" });
  assert.deepEqual(placeTurn(input({ asker: { devices: [off, phone], runtimeOptIn: false } })), { placement: "wait", reason: "device_off", wakeLine: DEVICE_OFF_LINE });
  assert.equal(DEVICE_OFF_LINE, "Your computer is off");
});

test("a computer that does not allow the engine counts as off", () => {
  const other: PlaceDevice = { ...laptop, engines: ["codex"] };
  assert.equal(placeTurn(input({ asker: { devices: [other], runtimeOptIn: false } })).placement, "wait");
  assert.equal(placeTurn(input({ asker: { devices: [other], runtimeOptIn: true } })).placement, "host");
});

test("'run my private chats on this computer' off sends the chat to the server or makes it wait, with its own line", () => {
  assert.deepEqual(placeTurn(input({ asker: { localRuns: false, runtimeOptIn: false } })), { placement: "wait", reason: "local_runs_off", wakeLine: LOCAL_RUNS_OFF_LINE });
  assert.deepEqual(placeTurn(input({ asker: { localRuns: false, runtimeOptIn: true } })), { placement: "host", reason: "device_off_runtime_opt_in" });
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
  const all = [input(), input({ thread: { persons: 2 } }), input({ asker: { devices: [], runtimeOptIn: false } }), input({ asker: { devices: [{ ...laptop, online: false }], runtimeOptIn: false } })].map(placeTurn);
  for (const p of all) {
    assert.ok(["host", "device", "wait"].includes(p.placement));
    assert.equal(typeof p.reason, "string");
    assert.equal(p.wakeLine !== undefined, p.placement === "wait", "only a waiting turn has a line");
    assert.equal(p.deviceId !== undefined, p.placement === "device", "only a device placement names a device");
  }
});
