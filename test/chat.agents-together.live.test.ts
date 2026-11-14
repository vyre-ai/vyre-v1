// Agents asked together run together (ARCH 6.2, changed 14 Nov 2026), on a booted daemon with the real engine and a scripted model: two agents and three agents tagged in one message start at once and
// answer in the order they finish, one failing does not stop the other, Stop on one agent stops that agent only, Stop everyone stops all, a message that tags nobody steers every agent working,
// a restart in the middle of a round brings each agent back once, and a chat with one agent behaves as before.
import test from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import { boot, call, connect, makeAgent, scriptedModel, seededDir, waitFor } from "./support/live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { OpenSession } from "../agent/src/turn-engine/types.ts";

type Msg = { author: { kind: string; id: string }; body?: string };
const nameOf = new Map<string, string>(); // agent id -> the short name a plan acts on
const who_ = (input: any): string => nameOf.get(String(input.agent?.id)) ?? "";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const messages = async (d: Daemon, threadId: string): Promise<Msg[]> =>
  (await call(d, "chat.messages.list", { threadId })).data.messages as Msg[];
const agentReplies = async (d: Daemon, threadId: string): Promise<string[]> =>
  (await messages(d, threadId)).filter((m) => m.author.kind === "agent").map((m) => m.author.id);
const roundOf = async (d: Daemon, threadId: string, messageId: string): Promise<Record<string, string>> => {
  const r = (await call(d, "engine.round.get", { threadId, messageIds: [messageId] })).data.rounds[0]?.agents as
    | { agentId: string; state: string }[]
    | undefined;
  return Object.fromEntries((r ?? []).map((a) => [a.agentId, a.state]));
};

/** A chat in Auto with these agents, and the message that tags `who` (all of them when omitted). */
async function round(d: Daemon, key: string, names: string[], who?: string[]) {
  const ids: string[] = [];
  for (const n of names) {
    const id = await makeAgent(d, `${n}${key}`);
    nameOf.set(id, n);
    ids.push(id);
  }
  const started = await call(d, "chat.start", { kind: "chat", agentIds: ids, idempotencyKey: `${key}-start` });
  const threadId = started.data.thread.threadId as string;
  await call(d, "threads.set_mode", { threadId, mode: "auto", idempotencyKey: `${key}-auto` });
  const tagged = who ? who.map((n) => ids[names.indexOf(n)]!) : ids;
  const posted = await call(d, "chat.post", {
    threadId,
    body: "look at this",
    mentions: tagged.map((id) => ({ kind: "agent", id })),
    idempotencyKey: `${key}-post`,
  });
  return { ids, threadId, messageId: posted.data.message.messageId as string };
}
async function withDaemon(model: OpenSession, f: (d: Daemon) => Promise<void>): Promise<void> {
  const dir = seededDir();
  const d = await boot(dir, model);
  try {
    await connect(d);
    await f(d);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("two agents tagged together: both work at once, the quick one answers first, the slow one still answers", async () => {
  const begun = new Map<string, number>();
  const model = scriptedModel(async function* (input: any) {
    const who = who_(input);
    begun.set(who, Date.now());
    await sleep(who.startsWith("Slow") ? 1800 : 100);
    yield { type: "text", text: `${who} done` };
  });
  await withDaemon(model, async (d) => {
    const { ids, threadId, messageId } = await round(d, "a", ["Slow", "Quick"]);
    const seen = await waitFor(async () => {
      const r = await roundOf(d, threadId, messageId);
      return Object.keys(r).length === 2 ? r : null;
    }, 10_000);
    assert.ok(
      Object.values(seen).every((s) => s === "working" || s === "replied"),
      JSON.stringify(seen),
    );
    await waitFor(async () => ((await agentReplies(d, threadId)).length === 2 ? true : null), 20_000);
    assert.deepEqual(await agentReplies(d, threadId), [ids[1], ids[0]], "replies follow in finishing order");
    const [t1, t2] = [...begun.values()];
    assert.ok(Math.abs(t1! - t2!) < 1000, `both began within a beat (${Math.abs(t1! - t2!)} ms apart)`);
    await sleep(1500);
    assert.equal((await agentReplies(d, threadId)).length, 2, "nobody else answered");
  });
});

test("three agents tagged together all answer once", async () => {
  const turns = new Map<string, number>();
  const model = scriptedModel(async function* (input: any) {
    const who = who_(input);
    turns.set(who, (turns.get(who) ?? 0) + 1);
    await sleep(300);
    yield { type: "text", text: `${who} done` };
  });
  await withDaemon(model, async (d) => {
    const { threadId } = await round(d, "b", ["One", "Two", "Three"]);
    await waitFor(async () => ((await agentReplies(d, threadId)).length === 3 ? true : null), 20_000);
    await sleep(1500);
    assert.equal((await agentReplies(d, threadId)).length, 3);
    assert.deepEqual([...turns.values()], [1, 1, 1]);
  });
});

test("one agent fails while the other finishes", async () => {
  const model = scriptedModel(async function* (input: any) {
    const who = who_(input);
    await sleep(200);
    if (who.startsWith("Bad")) {
      yield { type: "error", code: "provider.boom", message: "the provider said no" };
      return;
    }
    yield { type: "text", text: "all fine" };
  });
  await withDaemon(model, async (d) => {
    const { ids, threadId } = await round(d, "c", ["Bad", "Good"]);
    await waitFor(async () => ((await agentReplies(d, threadId)).includes(ids[1]!) ? true : null), 20_000);
    assert.ok(!(await messages(d, threadId)).some((m) => m.author.id === ids[0] && m.body === "all fine"));
  });
});

test("Stop on one agent stops that agent only; Stop everyone stops the rest", async () => {
  const model = scriptedModel(async function* (input: any) {
    const who = who_(input);
    if (who.startsWith("Held")) await new Promise<void>(() => undefined);
    await sleep(2500);
    yield { type: "text", text: `${who} done` };
  });
  await withDaemon(model, async (d) => {
    const { ids, threadId, messageId } = await round(d, "d", ["Held1", "Held2", "Free"]);
    await waitFor(async () => (Object.keys(await roundOf(d, threadId, messageId)).length === 3 ? true : null), 10_000);
    const one = await call(d, "engine.stop", { threadId, agentId: ids[0], idempotencyKey: "d-stop1" });
    assert.equal(one.data.stopped, 1);
    const r = await roundOf(d, threadId, messageId);
    assert.equal(r[ids[0]!], "stopped");
    assert.notEqual(r[ids[1]!], "stopped", "the other held agent is still working");
    assert.notEqual(r[ids[2]!], "stopped", "so is the free one");
    await waitFor(async () => ((await agentReplies(d, threadId)).includes(ids[2]!) ? true : null), 20_000);
    const all = await call(d, "engine.stop_all", { threadId, idempotencyKey: "d-stopall" });
    assert.equal(all.status, 200);
    assert.equal((await roundOf(d, threadId, messageId))[ids[1]!], "stopped");
    const said = (await messages(d, threadId)).filter((m) => m.author.kind === "agent" && /done/.test(m.body ?? ""));
    assert.deepEqual(
      said.map((m) => m.author.id),
      [ids[2]],
      "only the agent that was not stopped said its answer",
    );
  });
});

test("a message that tags nobody, sent while several agents work, reaches every one of them and starts no new turn", async () => {
  const turns = new Map<string, number>();
  const injected: string[] = [];
  const inner = scriptedModel(async function* (input: any, run: any) {
    const who = who_(input);
    turns.set(who, (turns.get(who) ?? 0) + 1);
    await sleep(500);
    yield* run("engine.pool.status", {}); // a step boundary: the steering message is read here
    await sleep(500);
    yield { type: "text", text: `${who} done` };
  });
  const model: OpenSession = async (spec) => {
    const s = await inner(spec);
    const inject = s.inject.bind(s);
    s.inject = (m) => {
      injected.push(`${nameOf.get(spec.agent.id)}:${m.body}`);
      inject(m);
    };
    return s;
  };
  await withDaemon(model, async (d) => {
    const { threadId } = await round(d, "e", ["Aa", "Bb"]);
    await waitFor(async () => (turns.size === 2 ? true : null), 10_000);
    await call(d, "chat.post", { threadId, body: "also check the dates", mentions: [], idempotencyKey: "e-steer" });
    await waitFor(async () => ((await agentReplies(d, threadId)).length === 2 ? true : null), 20_000);
    await sleep(1500);
    assert.deepEqual(injected.sort(), ["Aa:also check the dates", "Bb:also check the dates"]);
    assert.deepEqual([...turns.values()], [1, 1], "steering started no new turn");
    assert.equal((await agentReplies(d, threadId)).length, 2);
  });
});

test("a restart in the middle of a round: each agent comes back once and answers once", async () => {
  const dir = seededDir();
  const phase = { restarted: false };
  const turns = new Map<string, number>();
  const model = scriptedModel(async function* (input: any) {
    const who = who_(input);
    turns.set(
      `${phase.restarted ? "after" : "before"}:${who}`,
      (turns.get(`${phase.restarted ? "after" : "before"}:${who}`) ?? 0) + 1,
    );
    if (!phase.restarted) await new Promise<void>(() => undefined);
    yield { type: "text", text: `${who} done` };
  });
  let d = await boot(dir, model);
  try {
    await connect(d);
    const { ids, threadId } = await round(d, "f", ["Pa", "Pb"]);
    await waitFor(async () => (turns.size === 2 ? true : null), 10_000);
    await d.stop();
    phase.restarted = true;
    d = await boot(dir, model);
    await connect(d).catch(() => undefined);
    await waitFor(async () => ((await agentReplies(d, threadId)).length === 2 ? true : null), 40_000);
    await sleep(1500);
    assert.deepEqual((await agentReplies(d, threadId)).sort(), [...ids].sort());
    assert.equal(turns.get("after:Pa"), 1);
    assert.equal(turns.get("after:Pb"), 1);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a chat with one agent behaves as before: one turn, one reply", async () => {
  let turns = 0;
  const model = scriptedModel(async function* () {
    turns++;
    yield { type: "text", text: "hello" };
  });
  await withDaemon(model, async (d) => {
    const { ids, threadId } = await round(d, "g", ["Solo"]);
    await waitFor(async () => ((await agentReplies(d, threadId)).length === 1 ? true : null), 20_000);
    await sleep(1000);
    assert.deepEqual(await agentReplies(d, threadId), [ids[0]]);
    assert.equal(turns, 1);
  });
});
