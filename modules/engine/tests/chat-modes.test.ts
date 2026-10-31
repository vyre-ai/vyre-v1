// What a chat says about how its agents answer reaches the turn: the mode, the model, the effort and the account (per chat and per agent), and a turn that hits a limit moves to the next account.
import test from "node:test";
import assert from "node:assert/strict";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { createTurnEngine, scriptedProvider } from "../../../agent/src/turn-engine/index.ts";
import type { AccountQuery, EngineAgent, OpenThread, ResolvedAccount, SessionSpec } from "../../../agent/src/turn-engine/index.ts";
import { chatSettings, withChatSettings } from "../chat-settings.ts";
import { LIMIT_REST_MS, createLimitSwitch } from "../switch-on-limit.ts";
import { accountResolve } from "../handlers/accounts.ts";
import type { AgentPost } from "../handlers/bridge.ts";

type Call = (cap: string, input: unknown, as?: string) => Promise<unknown>;
const threadOut = (over: Record<string, unknown> = {}, agent: Record<string, unknown> = {}) => ({ thread: { mode: "ask", planMode: false, agents: [{ agentId: "agt_1", mode: "lead", ...agent }], ...over } });
const callOf = (routes: Record<string, (input: any) => unknown>): { call: Call; seen: Array<{ cap: string; as: string | undefined }> } => {
  const seen: Array<{ cap: string; as: string | undefined }> = [];
  return { seen, call: async (cap, input, as) => { seen.push({ cap, as }); const f = routes[cap]; if (!f) throw new Error(`no ${cap}`); return f(input); } };
};
const spec = (over: Partial<SessionSpec> = {}): SessionSpec => ({ threadId: "thr_1", agent: { id: "agt_1", mode: "lead", model: "claude-sonnet-5-5" }, asker: "usr_dana", turnId: "t1", traceId: "tr", ...over });

// ---- the mode, model and effort of the chat are read for every turn

test("each turn's session spec carries the chat's mode and the agent's model and effort in this chat, read as the asker", async () => {
  const opened: SessionSpec[] = [];
  const { call, seen } = callOf({ "threads.get": () => threadOut({ mode: "auto" }, { model: "claude-opus-5-5", effort: "max", provider: "anthropic" }) });
  const open = withChatSettings(async (s) => { opened.push(s); return {} as never; }, call);
  await open(spec());
  assert.equal(opened[0]!.mode, "auto");
  assert.deepEqual([opened[0]!.agent.model, opened[0]!.agent.effort], ["claude-opus-5-5", "max"]);
  assert.deepEqual(seen, [{ cap: "threads.get", as: "usr_dana" }]);
});

test("the next turn follows a change made in between; an agent with no choice keeps the engine's model; an old thread with only planMode is Plan", async () => {
  let out: unknown = threadOut({ mode: "ask" }, { effort: "low" });
  const opened: SessionSpec[] = [];
  const { call } = callOf({ "threads.get": () => out });
  const open = withChatSettings(async (s) => { opened.push(s); return {} as never; }, call);
  await open(spec());
  out = threadOut({ mode: "plan" }, { effort: "high" });
  await open(spec());
  assert.deepEqual(opened.map((s) => [s.mode, s.agent.effort, s.agent.model]), [["ask", "low", "claude-sonnet-5-5"], ["plan", "high", "claude-sonnet-5-5"]]);
  out = { thread: { planMode: true, agents: [{ agentId: "agt_1", mode: "lead" }] } };
  await open(spec());
  assert.deepEqual([opened[2]!.mode, opened[2]!.agent.effort], ["plan", undefined]);
});

test("a thread that cannot be read, and a session with no tools (an automation step), run as before: no mode, nothing changed", async () => {
  const opened: SessionSpec[] = [];
  const down = callOf({});
  await withChatSettings(async (s) => { opened.push(s); return {} as never; }, down.call)(spec());
  assert.equal(opened[0]!.mode, undefined);
  assert.equal(opened[0]!.agent.effort, undefined);
  const step = callOf({ "threads.get": () => threadOut({ mode: "auto" }) });
  await withChatSettings(async (s) => { opened.push(s); return {} as never; }, step.call)(spec({ tools: "none" }));
  assert.equal(opened[1]!.mode, undefined);
  assert.equal(step.seen.length, 0, "an automation's step never reads a chat");
  assert.deepEqual(await chatSettings(callOf({ "threads.get": () => threadOut({ mode: "bogus" }, { effort: "turbo" }) }).call, "thr_1", "agt_1", "usr_dana"), {});
});

// ---- the account of the chat, and the agent's default

type Prov = { id: string; providerKey: string; name: string; connection: string; scope: string; handle?: string; itemId: string; engine: string; spaceMayUse: boolean; state: string };
const prov = (o: Partial<Prov> & { id: string; handle: string }): Prov => ({ providerKey: "anthropic", name: o.handle, connection: "api_key", scope: "mine", itemId: `vit_${o.id}`, engine: "anthropic", spaceMayUse: false, state: "ok", ...o });
function resolverCtx(providers: Prov[], member: Record<string, unknown>, agent: Record<string, unknown>): Ctx {
  const routes: Record<string, (i: unknown) => unknown> = {
    "providers.list": () => ({ providers }),
    "threads.get": () => ({ thread: { starter: "usr_dana", agents: [{ agentId: "agt_1", model: "claude-sonnet-5-5", ...member }] } }),
    "agents.get": () => ({ agent: { accountPolicy: "asker", ...agent } }),
    "engine.policy.get": () => ({ allowedAccounts: "any" }),
    "engine.defaults.get": () => ({ fallback: [] }),
    "engine.placement.decide": () => ({ placement: "host" }),
    "spaces.get": () => ({ space: { kind: "team" } }),
  };
  return {
    space: "spc_1", principal: { kind: "agent", id: "agt_1" }, actingFor: "usr_dana", trace: { traceId: "t".repeat(32), spanId: "s" }, origin: "agent", depth: 0, now: () => 1,
    call: async (cap: string, input: unknown) => { const f = routes[cap]; if (!f) throw new Error(cap); return f(input); },
  } as unknown as Ctx;
}
const accounts = [prov({ id: "prv_1", handle: "#Dana_Anthropic" }), prov({ id: "prv_2", handle: "#Dana_Second" }), prov({ id: "prv_3", handle: "#Team_Key", scope: "shared" })];

test("the account chosen for this chat (the member's accountRef, set by threads.agent.configure) pays before the asker's own and before the agent's default", async () => {
  const chat = resolverCtx(accounts, { accountRef: "#Dana_Second" }, { accountPolicy: "key", accountKey: "#Team_Key" });
  assert.equal((await accountResolve(chat, { threadId: "thr_1", agentId: "agt_1" })).accountRef, "#Dana_Second");
  const none = resolverCtx(accounts, {}, { accountPolicy: "key", accountKey: "#Team_Key" });
  assert.equal((await accountResolve(none, { threadId: "thr_1", agentId: "agt_1" })).accountRef, "#Team_Key", "the agent's default account, when the chat chose none");
  const plain = resolverCtx(accounts, {}, {});
  assert.equal((await accountResolve(plain, { threadId: "thr_1", agentId: "agt_1" })).accountRef, "#Dana_Anthropic", "neither: the asker's own");
  const fell = resolverCtx([prov({ id: "prv_1", handle: "#Dana_Anthropic" }), prov({ id: "prv_2", handle: "#Dana_Second", state: "failing" })], { accountRef: "#Dana_Second" }, {});
  assert.equal((await accountResolve(fell, { threadId: "thr_1", agentId: "agt_1" })).accountRef, "#Dana_Anthropic", "a chat account that is signed out does not stop the chat");
});

// ---- switch when limits run out

const acct = (ref: string, provider = "anthropic"): ResolvedAccount => ({ ref, driver: provider, provider, kind: "api_key", payer: "usr_dana", reason: "starter" });
const query = (over: Partial<AccountQuery> = {}): AccountQuery => ({ threadId: "thr_1", agentId: "agt_1", askerId: "usr_dana", ...over });

function switchRig(o: { switchOnLimit?: boolean; order?: string[]; post?: (id: string, p: AgentPost) => Promise<unknown>; clock?: { t: number } } = {}) {
  const order = o.order ?? ["#A", "#B"];
  const posts: Array<{ agent: string; post: AgentPost }> = [];
  const asked: AccountQuery[] = [];
  const clock = o.clock ?? { t: 1000 };
  const { call } = callOf({
    "agents.get": () => ({ agent: { ...(o.switchOnLimit === undefined ? {} : { switchOnLimit: o.switchOnLimit }) } }),
    "threads.get": () => threadOut({}, { model: "claude-opus-5-5", effort: "high" }),
  });
  const sw = createLimitSwitch({
    call, now: () => clock.t,
    accountFor: async (q) => { asked.push(q); const ref = order.find((r) => !(q.unavailable ?? []).includes(r)); return ref ? acct(ref, ref === "#B" ? "openai" : "anthropic") : null; },
    postAs: o.post ?? (async (agent, post) => { posts.push({ agent, post }); }),
    providerOf: async (ref) => (ref === "#A" ? "anthropic" : "openai"),
  });
  return { sw, posts, asked, clock };
}

test("a limit moves the turn to the next account and the chat is told with a model_switch block that names where it came from and where it went", async () => {
  const r = switchRig();
  const to = await r.sw.next(query({ unavailable: ["#A"] }));
  assert.equal(to?.ref, "#B");
  assert.equal(r.posts.length, 1);
  const post = r.posts[0]!;
  assert.equal(post.agent, "agt_1");
  assert.equal(post.post.actingFor, "usr_dana");
  assert.ok(post.post.clientId.startsWith("msg_brg"), "the bridge does not feed its own post back to the engine");
  assert.equal(post.post.blocks[0]!.type, "model_switch");
  assert.deepEqual((post.post.blocks[0]!.data as { from: unknown; to: unknown; scope: string }), {
    ...(post.post.blocks[0]!.data as object), scope: "thread",
    from: { provider: "anthropic", model: "claude-opus-5-5", effort: "high" }, to: { provider: "openai", model: "claude-opus-5-5", effort: "high" },
  });
});

test("an agent set to keep to its account does not switch, and nothing is posted", async () => {
  const r = switchRig({ switchOnLimit: false });
  assert.equal(await r.sw.next(query({ unavailable: ["#A"] })), null);
  assert.equal(r.posts.length, 0);
  assert.equal(r.asked.length, 0, "no other account was even looked for");
  const on = switchRig({ switchOnLimit: true });
  assert.equal((await on.sw.next(query({ unavailable: ["#A"] })))?.ref, "#B");
});

test("nothing left to switch to is null; a chat that cannot post still switches", async () => {
  const r = switchRig({ order: ["#A"] });
  assert.equal(await r.sw.next(query({ unavailable: ["#A"] })), null);
  assert.equal(r.posts.length, 0);
  const noPost = switchRig({ post: async () => { throw new Error("chat is down"); } });
  assert.equal((await noPost.sw.next(query({ unavailable: ["#A"] })))?.ref, "#B");
});

test("the account that ran out rests for a while in that chat, so the next message does not pay for the same failure; when nothing else is left it is tried again", async () => {
  const r = switchRig();
  await r.sw.next(query({ unavailable: ["#A"] }));
  assert.equal((await r.sw.resolve(query()))?.ref, "#B", "the next message goes straight to the account that worked");
  assert.deepEqual(r.asked.at(-1)!.unavailable, ["#A"]);
  assert.equal((await r.sw.resolve(query({ threadId: "thr_other" })))?.ref, "#A", "another chat is not affected");
  r.clock.t += LIMIT_REST_MS + 1;
  assert.equal((await r.sw.resolve(query()))?.ref, "#A", "the limit has had time to reset");
  const lone = createLimitSwitch({ call: callOf({ "agents.get": () => ({ agent: {} }), "threads.get": () => threadOut() }).call, accountFor: async (q) => ((q.unavailable ?? []).includes("#A") ? null : acct("#A")), now: () => 1 });
  await lone.next(query({ unavailable: ["#X"] }));   // nothing to rest: next() needs an account to move to
  assert.equal((await lone.resolve(query()))?.ref, "#A");
});

test("end to end in the turn engine: a rate limit before any output retries the same turn on the next account, and the person sees one answer", async () => {
  const limited = new Set(["#A"]);
  const specs: string[] = [];
  const provider = scriptedProvider({
    script: (_i, s) => { specs.push(`${s.account?.ref}|${s.mode}|${s.agent.effort}`); return limited.has(s.account!.ref) ? [{ type: "error" as const, code: "provider.rate_limited", message: "usage limit reached" }] : [{ type: "text" as const, text: "Hello." }, { type: "done" as const }]; },
  });
  const r = switchRig({ order: ["#A", "#B"] });
  const engine = createTurnEngine({
    holder: "host:s", openSession: withChatSettings(provider.openSession, callOf({ "threads.get": () => threadOut({ mode: "auto" }, { effort: "medium" }) }).call),
    resolveAccount: (q) => r.sw.resolve(q), nextAccount: (q) => r.sw.next(q),
  });
  const agents: EngineAgent[] = [{ id: "agt_1", mode: "lead" }];
  const thread: OpenThread = { id: "thr_1", kind: "chat", starter: "usr_dana", agents };
  engine.openThread(thread);
  engine.receive({ threadId: "thr_1", author: { kind: "person", id: "usr_dana" }, body: "hi" });
  await engine.idle("thr_1");
  assert.deepEqual(specs, ["#A|auto|medium", "#B|auto|medium"], "the retry keeps the chat's mode and effort");
  assert.deepEqual(engine.turns("thr_1").map((t) => t.state), ["completed"]);
  assert.equal(r.posts.length, 1);
});

// ---- the agent is told the mode in its own context, whatever the driver

test("the agent is told the chat's mode: Ask first waits for a yes, Auto acts but the Gate still holds what leaves Vyre, Plan only plans; an old thread with planMode alone is Plan", async () => {
  const { createContextBuilder } = await import("../context.ts");
  const where = async (thread: Record<string, unknown>): Promise<string> => {
    const call: Call = async (cap) => {
      if (cap === "threads.get") return { thread: { kind: "chat", members: [], agents: [{ agentId: "agt_1", mode: "lead" }], ...thread } };
      throw new Error(`no ${cap}`);
    };
    const ctx = await createContextBuilder({ call, now: () => Date.UTC(2026, 9, 29) }).build({
      threadId: "thr_1", turnId: "t1", agent: { id: "agt_1", mode: "lead" }, trigger: null, history: [], listeners: [], asker: "usr_dana",
    });
    return ctx.sections.find((s) => s.id === "where")?.text ?? "";
  };
  assert.match(await where({ mode: "ask" }), /Mode: Ask first\. Before you change or send anything, say what you are about to do\./);
  assert.match(await where({ mode: "auto" }), /Mode: Auto\. Act on your own without asking\. Anything that leaves Vyre .* is still held for a yes\./);
  assert.match(await where({ mode: "plan" }), /Mode: Plan\. Read and plan, change nothing/);
  assert.match(await where({ planMode: true }), /Mode: Plan\./);
  assert.doesNotMatch(await where({ mode: "auto", planMode: false }), /Mode: (Ask first|Plan)/);
});
