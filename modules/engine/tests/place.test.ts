// engine.placement.decide, engine.pool.status and engine.warm (P-L2_23): thin wrappers over agent/src/placement and agent/src/pool, so these tests check the inputs they build and the answers they shape.
import test from "node:test";
import assert from "node:assert/strict";
import { placementDecide, poolStatus, warm } from "../handlers/place.ts";
import { bindOpener } from "../projections.ts";
import { harness } from "../fixtures/harness.ts";

const NOW = 1_760_000_000_000;
function ctxFor(threadKind: string, members: Array<{ kind: string; id: string }>, devices: unknown[], over: { hasComputer?: boolean } = {}) {
  const h = harness();
  const calls: Array<{ cap: string; input: unknown }> = [];
  const ctx = Object.assign(Object.create(h.ctx as object), {
    now: () => NOW,
    call: async (cap: string, input: unknown) => {
      calls.push({ cap, input });
      if (cap === "threads.get") return { thread: { kind: threadKind, members } };
      if (cap === "agents.get") return { agent: { hasComputer: over.hasComputer === true } };
      if (cap === "devices.mine") return { devices };
      throw new Error(`unexpected ${cap}`);
    },
  });
  return { ctx, calls };
}
const mac = { id: "dev_mac", class: "desktop", lastSeenAt: NOW - 1000 };

test("a private chat runs on the asker's computer when it is online; a channel runs on the host", async () => {
  const dm = ctxFor("chat", [{ kind: "person", id: "usr_dana" }, { kind: "agent", id: "agt_1" }], [mac]);
  assert.deepEqual(await placementDecide(dm.ctx, { threadId: "thr_1", agentId: "agt_1", kind: "message" }), { placement: "device", reason: "device" });
  const channel = ctxFor("channel", [{ kind: "person", id: "usr_dana" }, { kind: "person", id: "usr_ravi" }], [mac]);
  assert.deepEqual(await placementDecide(channel.ctx, { threadId: "thr_2", agentId: "agt_1", kind: "message" }), { placement: "host", reason: "shared_thread" });
});

test("a computer that is off waits with the line, and an agent with its own computer runs on the host", async () => {
  const off = ctxFor("chat", [{ kind: "person", id: "usr_dana" }], [{ ...mac, lastSeenAt: NOW - 10 * 60_000 }]);
  assert.deepEqual(await placementDecide(off.ctx, { threadId: "thr_1", agentId: "agt_1", kind: "message" }), { placement: "wait", reason: "device_off", wakeLine: "Your computer is off" });
  const computer = ctxFor("chat", [{ kind: "person", id: "usr_dana" }], [mac], { hasComputer: true });
  assert.equal((await placementDecide(computer.ctx, { threadId: "thr_1", agentId: "agt_1", kind: "message" })).reason, "agent_computer");
  const phone = ctxFor("chat", [{ kind: "person", id: "usr_dana" }], [{ id: "dev_ph", class: "phone", lastSeenAt: NOW }]);
  assert.equal((await placementDecide(phone.ctx, { threadId: "thr_1", agentId: "agt_1", kind: "message" })).reason, "no_daemon");
});

test("pool.status reports the opener's pool per driver, and an empty one before any engine is bound", () => {
  const h = harness();
  bindOpener(null);
  assert.deepEqual(poolStatus(h.ctx as never, {} as never), { sessions: [], totalWarm: 0 });
  bindOpener({ warm: () => undefined, pool: { status: () => ({ sessions: [{ driver: "claude_code", warm: 1, max: 4, hits: 3, misses: 1 }], totalWarm: 1 }) } });
  assert.deepEqual(poolStatus(h.ctx as never, {} as never), { sessions: [{ driver: "claude_code", warm: 1, max: 4, hits: 3, misses: 1 }], totalWarm: 1 });
  bindOpener(null);
});

test("warm answers at once, and warms the resolved account in the background; with nothing bound it answers false", async () => {
  const dm = ctxFor("chat", [{ kind: "person", id: "usr_dana" }], [mac]);
  const { ctx } = dm;
  bindOpener(null);
  assert.deepEqual(await warm(ctx as never, { threadId: "thr_1" }), { warm: false });
  const warmed: Array<{ threadId: string; asker: string; account?: { ref: string } }> = [];
  bindOpener({ warm: (s) => { warmed.push(s as never); }, pool: { status: () => ({ sessions: [], totalWarm: 0 }) } });
  const c2 = Object.assign(Object.create(ctx), {
    call: async (cap: string) => {
      if (cap === "threads.get") return { thread: { agents: [{ agentId: "agt_1" }] } };
      if (cap === "engine.account.resolve") return { accountRef: "#Dana_Claude", payer: "usr_dana", reason: "starter", allowed: true, itemId: "vit_1" };
      if (cap === "engine.accounts.list") return { accounts: [{ ref: "#Dana_Claude", driver: "claude_code", kind: "subscription" }] };
      throw new Error(`unexpected ${cap}`);
    },
  });
  assert.deepEqual(await warm(c2 as never, { threadId: "thr_1" }), { warm: true });
  for (let i = 0; i < 50 && warmed.length === 0; i++) await new Promise<void>((r) => setImmediate(r));
  assert.equal(warmed.length, 1);
  assert.deepEqual([warmed[0]!.threadId, warmed[0]!.asker, warmed[0]!.account?.ref], ["thr_1", "usr_dana", "#Dana_Claude"]);
  bindOpener(null);
});

// ---- the runs-on chip: where the person pinned a chat

import { placementOptions, placementSet } from "../handlers/place-pref.ts";
import { turnEnqueue, turnStart } from "../handlers/extra/turns.ts";

let lastHarness: ReturnType<typeof harness> | null = null;
function pinCtx(o: { members?: Array<{ kind: string; id: string }>; devices?: unknown[]; servers?: unknown[]; kind?: "team" | "personal"; principal?: { kind: "person"; id: string } } = {}) {
  const h = harness();
  lastHarness = h;
  const members = o.members ?? [{ kind: "person", id: "usr_dana" }, { kind: "agent", id: "agt_1" }];
  const ctx = Object.assign(Object.create(h.ctx as object), {
    now: () => NOW,
    principal: o.principal ?? { kind: "person", id: "usr_dana" },
    call: async (cap: string): Promise<unknown> => {
      if (cap === "threads.get") return { thread: { kind: "chat", members } };
      if (cap === "agents.get") return { agent: { hasComputer: false } };
      if (cap === "devices.mine") return { devices: o.devices ?? [mac] };
      if (cap === "network.my_computers") return { computers: o.servers ?? [{ serverId: "srv_home", name: "home-box", state: "healthy", enrollment: "approved" }] };
      if (cap === "spaces.matrix") return { kind: o.kind ?? "team" };
      throw new Error(`unexpected ${cap}`);
    },
  });
  return ctx;
}
const decide = (ctx: unknown) => placementDecide(ctx as never, { threadId: "thr_1", agentId: "agt_1", kind: "message" });

test("a chat pinned to a server of the person's routes to the Space's engine with that server, and to a stored turn", async () => {
  const ctx = pinCtx();
  assert.deepEqual(await placementSet(ctx, { threadId: "thr_1", target: "server", serverId: "srv_home" }), { target: "server", serverId: "srv_home" });
  assert.deepEqual(await decide(ctx), { placement: "host", reason: "chosen_server", nodeId: "srv_home" });
  const { qseq } = turnEnqueue(ctx as never, { threadId: "thr_1", agentId: "agt_1", kind: "message", messageId: "msg_1", from: "usr_dana" });
  const out = turnStart(ctx as never, { threadId: "thr_1", agentId: "agt_1", qseq, placement: "host", nodeId: "srv_home", engine: "claude_code", model: "m" });
  assert.equal(out.turn.state, "running");
  assert.deepEqual(lastHarness!.named("turn.started").map((e) => [e.payload["placement"], e.payload["nodeId"]]), [["host", "srv_home"]], "the turn is recorded as running there");
});

test("pinned to this computer it waits when the computer is off; pinned to the Space it runs on the Space; changing the pin changes the next turn", async () => {
  const off = pinCtx({ devices: [{ ...mac, lastSeenAt: NOW - 10 * 60_000 }] });
  await placementSet(off, { threadId: "thr_1", target: "device" });
  assert.deepEqual(await decide(off), { placement: "wait", reason: "device_off", wakeLine: "Your computer is off" });
  await placementSet(off, { threadId: "thr_1", target: "space" });
  assert.deepEqual(await decide(off), { placement: "host", reason: "chosen_space" });
  await placementSet(off, { threadId: "thr_1", target: "device" });
  assert.equal((await decide(off)).placement, "wait");
});

test("a server that is off waits under its own name; a server that was removed stops pinning the chat", async () => {
  const servers: unknown[] = [{ serverId: "srv_home", name: "home-box", state: "down", enrollment: "approved" }];
  const down = pinCtx({ servers });
  await placementSet(down, { threadId: "thr_1", target: "server", serverId: "srv_home" });
  assert.deepEqual(await decide(down), { placement: "wait", reason: "server_off", wakeLine: "home-box is off", nodeId: "srv_home" });
  servers.length = 0;
  assert.equal((await decide(down)).reason, "device", "the rules apply again");
});

test("a person's chat never runs on a teammate's machine: another person's server, an unknown one, the Space in a Personal Space and a shared chat are refused", async () => {
  const ctx = pinCtx();
  await assert.rejects(() => placementSet(ctx, { threadId: "thr_1", target: "server", serverId: "srv_theirs" }), (e) => (e as { error?: { code: string } }).error?.code === "permission.no_grant");
  await assert.rejects(() => placementSet(ctx, { threadId: "thr_1", target: "server" }), (e) => (e as { error?: { code: string } }).error?.code === "permission.no_grant");
  await assert.rejects(() => placementSet(pinCtx({ kind: "personal" }), { threadId: "thr_1", target: "space" }), (e) => (e as { error?: { code: string } }).error?.code === "validation.bad_input");
  const shared = pinCtx({ members: [{ kind: "person", id: "usr_dana" }, { kind: "person", id: "usr_ravi" }] });
  await assert.rejects(() => placementSet(shared, { threadId: "thr_1", target: "device" }), (e) => (e as { error?: { code: string } }).error?.code === "validation.precondition_failed");
  await assert.rejects(() => placementSet(pinCtx({ devices: [{ id: "dev_ph", class: "phone", lastSeenAt: NOW }] }), { threadId: "thr_1", target: "device" }), (e) => (e as { error?: { code: string } }).error?.code === "validation.precondition_failed");
});

test("the chip's options: this computer, the Space in a Team Space, each of the person's servers with why it is grey; where the chat runs now", async () => {
  const ctx = pinCtx({ devices: [{ ...mac, lastSeenAt: NOW - 10 * 60_000 }], servers: [{ serverId: "srv_home", name: "home-box", state: "healthy", enrollment: "approved" }, { serverId: "srv_off", name: "old-mac", state: "down", enrollment: "approved" }, { serverId: "srv_new", name: "new", state: "down", enrollment: "pending" }] });
  const out = await placementOptions(ctx, { threadId: "thr_1", agentId: "agt_1" });
  assert.deepEqual(out.options, [
    { target: "device", name: "This computer", online: false, reason: "Off" },
    { target: "space", name: "The Space", online: true },
    { target: "server", serverId: "srv_home", name: "home-box", online: true },
    { target: "server", serverId: "srv_off", name: "old-mac", online: false, reason: "Off" },
  ]);
  assert.equal(out.private, true);
  assert.deepEqual(out.effective, { target: "device" });
  await placementSet(ctx, { threadId: "thr_1", target: "server", serverId: "srv_home" });
  assert.deepEqual((await placementOptions(ctx, { threadId: "thr_1" })).effective, { target: "server", serverId: "srv_home" });
  const personal = await placementOptions(pinCtx({ kind: "personal" }), { threadId: "thr_1" });
  assert.deepEqual(personal.options.map((o) => o.target), ["device", "server"], "the Space is not a place of its own in a Personal Space");
  const shared = await placementOptions(pinCtx({ members: [{ kind: "person", id: "usr_dana" }, { kind: "person", id: "usr_ravi" }] }), { threadId: "thr_1" });
  assert.deepEqual([shared.private, shared.effective], [false, { target: "space" }]);
});

test("the Space menu's Chats run on: with engine.local_runs off a private chat does not start on the computer, and runs on the Space for someone who allows it", async () => {
  const mk = (localRuns: boolean) => {
    const base = ctxFor("chat", [{ kind: "person", id: "usr_dana" }], [mac]);
    const inner = base.ctx.call;
    return Object.assign(Object.create(base.ctx), { call: async (cap: string, input: unknown) => (cap === "settings.get" ? { row: { value: localRuns } } : inner(cap, input)) });
  };
  assert.equal((await placementDecide(mk(true), { threadId: "thr_1", agentId: "agt_1", kind: "message" })).placement, "device");
  assert.deepEqual(await placementDecide(mk(false), { threadId: "thr_1", agentId: "agt_1", kind: "message" }), { placement: "wait", reason: "local_runs_off", wakeLine: "Running chats on your computer is off" });
});
