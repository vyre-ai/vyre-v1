// The chat composer's agent controls against the engine (rc.8): mode through threads.set_mode (threads.set_plan_mode on an older server), model, effort and account through
// threads.agent.configure (engine.set_model on an older server), usage from engine.usage.get for the account picked (percent read as percent, nulls left out), and only the
// accounts the person connected, by the names they gave them.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom, mount, find, press, flush, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { ChatBrain, configureAgent, connectedAccounts, isMissingCap, modeOf, panelUsage, prettyModel, resetMissing, setChatMode, stripAgents } from "./brain.tsx";
import type { ConversationData } from "./data.tsx";
import type { Thread } from "./model.ts";

type Call = { cap: string; input: Record<string, unknown> };
function stub(answers: Record<string, (input: Record<string, unknown>) => unknown>): { data: ConversationData; calls: Call[]; said: string[] } {
  const calls: Call[] = [];
  const data = {
    threadId: "thr_1",
    async call(cap: string, input: unknown) {
      calls.push({ cap, input: input as Record<string, unknown> });
      const a = answers[cap];
      if (!a) throw Object.assign(new Error("There is no such capability."), { code: "validation.unknown_capability" });
      return a(input as Record<string, unknown>);
    },
    nav: { openAgent() {}, openThread() {}, togglePane() {}, openBeside() {}, openAiSetup() { calls.push({ cap: "nav.openAiSetup", input: {} }); } },
  } as unknown as ConversationData;
  return { data, calls, said: [] };
}

const thread = { threadId: "thr_1", kind: "chat", listed: true, planMode: false, members: [], createdAt: 0, agents: [{ agentId: "agt_intake", mode: "lead", model: "claude-sonnet-5-5", provider: "anthropic", effort: "high", accountRef: "#cl_work" }] } as unknown as Thread;
const ROWS = [
  { ref: "#cl_personal", driver: "claude_code", kind: "subscription", title: "Claude", name: "Personal", status: "ok", mine: true },
  { ref: "#cl_work", driver: "claude_code", kind: "subscription", title: "Claude", name: "MLA work", status: "ok", mine: true },
  { ref: "#gone", driver: "codex", kind: "subscription", title: "ChatGPT", status: "expired", mine: true },
  { ref: "#key", driver: "openai", kind: "api_key", title: "OpenAI key", status: "untested", mine: true },
];

test("only connected accounts are offered, by the name the person gave (the provider's title when none); the strip names the account when one provider has two", () => {
  const accts = connectedAccounts(ROWS);
  assert.deepEqual(accts.map((a) => a.name), ["Personal", "MLA work", "OpenAI key"]);
  assert.equal(accts[2]!.plan, "API key");
  const [a] = stripAgents(thread, () => "Intake", accts, new Map([["agt_intake", { used: 9, window: 10 }]]));
  assert.deepEqual([a!.modelTitle, a!.accountName, a!.effort, a!.provider, a!.context], ["Sonnet 5.5", "MLA work", "high", "anthropic", { used: 9, window: 10 }]);
  const [solo] = stripAgents(thread, () => "Intake", accts.filter((x) => x.ref !== "#cl_personal"), new Map());
  assert.equal(solo!.accountName, undefined, "one account of the provider: no name on the strip");
  assert.equal(prettyModel("gpt-5"), "GPT 5");
  assert.equal(prettyModel("opus"), "Opus");
});

test("engine.usage.get percent becomes the panel's fraction; a meter it did not report stays null", () => {
  assert.deepEqual(panelUsage({ account: null, context: { used: 84_000, window: 200_000 }, session: { pct: 88, resetsAt: 5 }, week: null, source: "provider" }), { context: { used: 84_000, window: 200_000 }, session: { pct: 0.88, resetsAt: 5 }, week: null });
  assert.deepEqual(panelUsage({ account: null, context: null, session: null, week: null, source: "none" }), { context: null, session: null, week: null });
  assert.equal(panelUsage(null), null);
});

test("mode goes through threads.set_mode, and through threads.set_plan_mode when the server has no set_mode", async () => {
  resetMissing();
  const now = stub({ "threads.set_mode": () => ({ thread: {} }) });
  assert.equal(await setChatMode(now.data, "auto"), "mode");
  assert.deepEqual(now.calls[0], { cap: "threads.set_mode", input: { threadId: "thr_1", mode: "auto" } });
  resetMissing();
  const old = stub({ "threads.set_plan_mode": () => ({ planMode: true }) });
  assert.equal(await setChatMode(old.data, "plan"), "plan_mode");
  assert.deepEqual(old.calls.map((c) => c.cap), ["threads.set_mode", "threads.set_plan_mode"]);
  assert.deepEqual(old.calls[1]!.input, { threadId: "thr_1", planMode: true });
  assert.equal(modeOf({ ...thread, mode: "auto" } as Thread), "auto");
  assert.equal(modeOf({ ...thread, planMode: true }), "plan");
  assert.ok(isMissingCap(new Error("no write for threads.set_mode")));
  assert.ok(!isMissingCap(Object.assign(new Error("denied"), { code: "permission.denied" })));
  resetMissing();
});

test("an agent's model, effort and account go through threads.agent.configure with the scope; engine.set_model (and agents.update for the agent's default) on an older server", async () => {
  resetMissing();
  const now = stub({ "threads.agent.configure": () => ({ thread: {} }) });
  await configureAgent(now.data, "agt_intake", { model: "opus", provider: "claude_code", accountRef: "#cl_work" }, "agent");
  assert.deepEqual(now.calls[0], { cap: "threads.agent.configure", input: { threadId: "thr_1", agentId: "agt_intake", model: "opus", provider: "claude_code", accountRef: "#cl_work", scope: "agent" } });
  resetMissing();
  const old = stub({ "engine.set_model": (i) => i, "agents.update": () => ({ agent: {} }) });
  await configureAgent(old.data, "agt_intake", { model: "opus" }, "agent");
  assert.deepEqual(old.calls.map((c) => c.cap), ["threads.agent.configure", "engine.set_model", "agents.update"]);
  assert.deepEqual(old.calls[2]!.input, { agentId: "agt_intake", patch: { model: "opus" } });
  resetMissing();
});

test("the wired panel: usage is asked for the account in use and again for the account picked; effort is written for this chat; the switch toggle is the agent's switchOnLimit", async () => {
  resetMissing();
  const restore = installDom();
  try {
    const s = stub({
      "engine.models.list": (i) => ({ models: i["accountRef"] === "#key" ? [{ provider: "openai", model: "gpt-5", title: "GPT-5", driver: "openai", contextTokens: 400_000, allowed: true }] : [{ provider: "anthropic", model: "claude-sonnet-5-5", title: "Sonnet 5.5", driver: "claude_code", contextTokens: 200_000, allowed: true }] }),
      "engine.usage.get": (i) => (i["accountRef"] === "#key" ? { account: null, context: { used: 1000, window: 400_000 }, session: null, week: null, source: "none" } : { account: null, context: { used: 84_000, window: 200_000 }, session: { pct: 30 }, week: { pct: 12 }, source: "provider" }),
      "agents.get": () => ({ agent: { switchOnLimit: true } }),
      "agents.update": (i) => ({ agent: i }),
      "threads.agent.configure": () => ({ thread: {} }),
    });
    const said: string[] = [];
    const accounts = connectedAccounts(ROWS);
    const root = await mount(createRoot, <ChatBrain data={s.data} thread={thread} agent={{ id: "agt_intake", name: "Intake" }} accounts={accounts} mode="ask" onMode={() => undefined} close={() => undefined} narrow={false} say={(t) => said.push(t)} />);
    await flush();
    assert.ok(s.calls.some((c) => c.cap === "engine.usage.get" && c.input["accountRef"] === "#cl_work"), "usage for the account the agent runs on");
    assert.match(textOf(find(root, "meter-session")), /30%/);
    await press(find(root, "model-more-row"));
    assert.equal(find(root, "model-fallback")!.props["aria-checked"], true);
    await press(find(root, "model-account"));
    await press(find(root, "row-model-account-#key"));
    await flush();
    assert.ok(s.calls.some((c) => c.cap === "threads.agent.configure" && c.input["accountRef"] === "#key"));
    assert.equal(find(root, "meter-session"), null, "an API key reports no session: no meter");
    assert.ok(find(root, "row-model-gpt-5"), "the models of the new account");
    await press(find(root, "model-effort-high"));
    await press(find(root, "model-more-row"));
    await press(find(root, "model-fallback"));
    await flush();
    const cfg = s.calls.filter((c) => c.cap === "threads.agent.configure").at(-1)!;
    assert.deepEqual(cfg.input, { threadId: "thr_1", agentId: "agt_intake", effort: "high", scope: "chat" });
    assert.deepEqual(s.calls.filter((c) => c.cap === "agents.update").at(-1)!.input, { agentId: "agt_intake", patch: { switchOnLimit: false } });
    await press(find(root, "model-scope"));
    await press(find(root, "model-account"));
    await press(find(root, "model-add-provider"));
    assert.ok(s.calls.some((c) => c.cap === "nav.openAiSetup"), "Add another AI provider opens the AI setup when there is no connect host");
  } finally { restore(); resetMissing(); }
});
