// engine.placement.decide, engine.pool.status and engine.warm (P-L2_23): thin wrappers over agent/src/placement and agent/src/pool, so these tests check the inputs they build and the answers they shape.
import test from "node:test";
import assert from "node:assert/strict";
import { placementDecide, poolStatus, warm } from "../handlers/place.ts";
import { runtimeOptIn } from "../handlers/extra/config.ts";
import { bindOpener, ensure } from "../projections.ts";
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
  assert.deepEqual(await placementDecide(dm.ctx, { threadId: "thr_1", agentId: "agt_1", kind: "message" }), { placement: "device", reason: "other_device", deviceId: "dev_mac" });
  const channel = ctxFor("channel", [{ kind: "person", id: "usr_dana" }, { kind: "person", id: "usr_ravi" }], [mac]);
  assert.deepEqual(await placementDecide(channel.ctx, { threadId: "thr_2", agentId: "agt_1", kind: "message" }), { placement: "host", reason: "shared_thread" });
});

test("a computer that is off: Automatic runs on the Space's server (allowed by default, owner rulings 3 Nov), and waits with the line for a person who turned that off; an agent with its own computer runs on the host", async () => {
  const offMac = { ...mac, lastSeenAt: NOW - 10 * 60_000 };
  const byDefault = ctxFor("chat", [{ kind: "person", id: "usr_dana" }], [offMac]);
  assert.deepEqual(await placementDecide(byDefault.ctx, { threadId: "thr_1", agentId: "agt_1", kind: "message" }), { placement: "host", reason: "space" });
  const off = ctxFor("chat", [{ kind: "person", id: "usr_dana" }], [offMac]);
  runtimeOptIn(off.ctx, { enabled: false });
  assert.deepEqual(await placementDecide(off.ctx, { threadId: "thr_1", agentId: "agt_1", kind: "message" }), { placement: "wait", reason: "device_off", wakeLine: "Your computer is off" });
  runtimeOptIn(off.ctx, { enabled: true, wrappedRuntimeKey: "ciphertext" });
  assert.equal((await placementDecide(off.ctx, { threadId: "thr_1", agentId: "agt_1", kind: "message" })).placement, "host", "the fallback reads the setting each time");
  const computer = ctxFor("chat", [{ kind: "person", id: "usr_dana" }], [mac], { hasComputer: true });
  assert.equal((await placementDecide(computer.ctx, { threadId: "thr_1", agentId: "agt_1", kind: "message" })).reason, "agent_computer");
  const phone = ctxFor("chat", [{ kind: "person", id: "usr_dana" }], [{ id: "dev_ph", class: "phone", lastSeenAt: NOW }]);
  assert.equal((await placementDecide(phone.ctx, { threadId: "thr_1", agentId: "agt_1", kind: "message" })).reason, "space");
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
  assert.deepEqual(await placementSet(off, { threadId: "thr_1", target: "device" }), { target: "device", deviceId: "dev_mac" }, "the computer is named in the pin");
  assert.deepEqual(await decide(off), { placement: "wait", reason: "device_off", deviceId: "dev_mac", wakeLine: "Your computer is off" });
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
  assert.equal((await decide(down)).reason, "other_device", "the rules apply again");
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
    { target: "device", deviceId: "dev_mac", name: "Your computer", online: false, reason: "Off" },
    { target: "space", name: "The Space", online: true },
    { target: "server", serverId: "srv_home", name: "home-box", online: true },
    { target: "server", serverId: "srv_off", name: "old-mac", online: false, reason: "Off" },
  ]);
  assert.equal(out.private, true);
  await placementSet(ctx, { threadId: "thr_1", target: "server", serverId: "srv_home" });
  assert.deepEqual((await placementOptions(ctx, { threadId: "thr_1" })).effective, { target: "server", serverId: "srv_home" });
  const personal = await placementOptions(pinCtx({ kind: "personal" }), { threadId: "thr_1" });
  assert.deepEqual(personal.options.map((o) => o.target), ["device", "server"], "the Space is not a place of its own in a Personal Space");
  const here = await placementOptions(Object.assign(Object.create(pinCtx()), { device: "dev_mac" }), { threadId: "thr_1" });
  assert.deepEqual(here.options[0], { target: "device", deviceId: "dev_mac", current: true, name: "This computer", online: true }, "the computer the person chooses from is This computer");
  const shared = await placementOptions(pinCtx({ members: [{ kind: "person", id: "usr_dana" }, { kind: "person", id: "usr_ravi" }] }), { threadId: "thr_1" });
  assert.deepEqual([shared.private, shared.effective], [false, { target: "space" }]);
});

test("the Space menu's Chats run on: with engine.local_runs off a private chat does not start on the computer; a Space that keeps its server makes it wait", async () => {
  const mk = (localRuns: boolean) => {
    const base = ctxFor("chat", [{ kind: "person", id: "usr_dana" }], [mac]);
    const inner = base.ctx.call;
    return Object.assign(Object.create(base.ctx), { call: async (cap: string, input: unknown) => (cap === "settings.get" ? { row: { value: localRuns } } : inner(cap, input)) });
  };
  assert.equal((await placementDecide(mk(true), { threadId: "thr_1", agentId: "agt_1", kind: "message" })).placement, "device");
  assert.deepEqual(await placementDecide(mk(false), { threadId: "thr_1", agentId: "agt_1", kind: "message" }), { placement: "wait", reason: "device_off", wakeLine: "Running chats on your computer is off" }, "both settings off: nothing may run it");
});

test("a crew teammate's thread runs on the host even with the asker's computer online: its repository copy is on the host", async () => {
  const c = ctxFor("helper", [{ kind: "person", id: "usr_dana" }], [mac]);
  assert.equal((await placementDecide(c.ctx, { threadId: "thr_mate", agentId: "agt_1", kind: "message" })).placement, "device", "a plain helper thread follows the device");
  ensure(c.ctx.db);
  c.ctx.db.run("INSERT INTO engine_crew_job (job_id, thread_id, lead_thread_id, project_id, agent_id, asker, title, branch, base_branch, repo_path, state, started_at) VALUES ('crw_1', 'thr_mate', 'thr_lead', 'prj_1', 'agt_1', 'usr_dana', 'T', 'crew/a-1', 'main', '/r', 'working', 1)");
  assert.deepEqual(await placementDecide(c.ctx, { threadId: "thr_mate", agentId: "agt_1", kind: "message" }), { placement: "host", reason: "crew" });
});

test("Automatic takes the pin off, the rules decide again, and the options say whether it is pinned", async () => {
  const ctx = pinCtx();
  assert.equal((await placementOptions(ctx, { threadId: "thr_1" })).pinned, false, "a chat starts on Automatic");
  await placementSet(ctx, { threadId: "thr_1", target: "server", serverId: "srv_home" });
  assert.equal((await placementOptions(ctx, { threadId: "thr_1" })).pinned, true);
  assert.deepEqual(await placementSet(ctx, { threadId: "thr_1", target: "auto" }), { target: "auto" });
  assert.equal((await placementOptions(ctx, { threadId: "thr_1" })).pinned, false);
  assert.notEqual((await decide(ctx)).reason, "chosen_server", "the next turn goes by the rules");
});

// Lane l-runson: with the host's relay bound, a computer is on only while its link to the Space is up, the one in use is where the person's last message came from, and a server counts while connected.
test("with a relay, the live link decides: the computer in use first, then another of theirs, then their own server, then the Space; options never say on for a computer that is not linked", async () => {
  const { bindRelay } = await import("../relay.ts");
  const { setUsing } = await import("../node-turns.ts");
  const links: Array<{ nodeId: string; deviceId: string; person: string; name?: string; engines: string[] }> = [];
  const connected = new Set<string>(["srv_home"]);
  bindRelay({ spawn: () => Promise.reject(new Error("no")), connected: (n) => connected.has(n), secure: () => true, devices: (p) => links.filter((l) => p === undefined || l.person === p) });
  try {
    const desk = { id: "dev_desk", class: "desktop", name: "Desk", lastSeenAt: NOW };
    const ctx = pinCtx({ devices: [mac, desk] });
    assert.deepEqual(await decide(ctx), { placement: "host", reason: "own_server", nodeId: "srv_home" }, "a fresh last-seen time is not a link: no computer is on, so their own server runs it");
    links.push({ nodeId: "device:dev_desk", deviceId: "dev_desk", person: "usr_dana", name: "Desk", engines: ["claude_code"] });
    assert.deepEqual(await decide(ctx), { placement: "device", reason: "other_device", deviceId: "dev_desk" });
    links.push({ nodeId: "device:dev_mac", deviceId: "dev_mac", person: "usr_dana", name: "Mac", engines: ["claude_code"] });
    setUsing(ctx.db, "thr_1", "usr_dana", "dev_mac", NOW);
    assert.deepEqual(await decide(ctx), { placement: "device", reason: "device", deviceId: "dev_mac" }, "the computer the message came from wins");
    links.push({ nodeId: "device:dev_ravi", deviceId: "dev_ravi", person: "usr_ravi", name: "Ravi's", engines: ["claude_code"] });
    links.splice(0, 2);
    connected.clear();
    assert.deepEqual(await decide(ctx), { placement: "host", reason: "space" }, "a teammate's linked computer is never theirs");
    const opts = await placementOptions(Object.assign(Object.create(ctx), { device: "dev_mac" }), { threadId: "thr_1", agentId: "agt_1" });
    assert.deepEqual(opts.automatic, { target: "space" }, "Automatic would run it on the Space now");
    assert.deepEqual(opts.options.filter((o) => o.target === "device").map((o) => [o.name, o.online]), [["This computer", false], ["Desk", false]]);
    assert.deepEqual(opts.options.find((o) => o.target === "server"), { target: "server", serverId: "srv_home", name: "home-box", online: false, reason: "Off" }, "a server that is not connected is off");
  } finally { bindRelay(null); }
});
