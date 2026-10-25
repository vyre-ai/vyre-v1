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
