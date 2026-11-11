// The chat composer's agent controls against the engine (rc.8): mode through threads.set_mode (threads.set_plan_mode on an older server), model, effort and account through
// threads.agent.configure (engine.set_model on an older server), usage from engine.usage.get for the account picked (percent read as percent, nulls left out), and only the
// accounts the person connected, by the names they gave them.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom, mount, find, press, flush, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { ChatBrain, configureAgent, connectedAccounts, withLastPick, isMissingCap, modeOf, panelUsage, prettyModel, resetMissing, setChatMode, stripAgents } from "./brain.tsx";
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

test("choosing the account already in use writes nothing and says nothing; choosing another one does both (rc.22 bug 14)", async () => {
  resetMissing();
  const restore = installDom();
  try {
    const s = stub({
      "engine.models.list": () => ({ models: [] }),
      "engine.usage.get": () => null,
      "agents.get": () => ({ agent: {} }),
      "agents.update": (i) => ({ agent: i }),
      "threads.agent.configure": () => ({ thread: {} }),
    });
    const said: string[] = [];
    const root = await mount(createRoot, <ChatBrain data={s.data} thread={thread} agent={{ id: "agt_intake", name: "Intake" }} accounts={connectedAccounts(ROWS)} mode="ask" onMode={() => undefined} close={() => undefined} narrow={false} say={(t) => said.push(t)} />);
    await flush();
    await press(find(root, "model-account"));
    await press(find(root, "row-model-account-#cl_work"));   // the account this chat already runs on
    await flush();
    assert.equal(s.calls.filter((c) => c.cap === "threads.agent.configure").length, 0, "nothing written");
    assert.deepEqual(said, [], "nothing said");
    await press(find(root, "model-account"));
    await press(find(root, "row-model-account-#key"));
    await flush();
    assert.equal(s.calls.filter((c) => c.cap === "threads.agent.configure").length, 1);
    assert.equal(said.length, 1, "a real change says so once");
    assert.ok(!said[0]!.includes("@"), "and never an email");
  } finally { restore(); resetMissing(); }
});

test("the model menu shows the saved list at once, then the vendor's new model by its own name, its default marked, an alias pick checked, and a quiet line on freshness", async () => {
  resetMissing();
  const restore = installDom();
  try {
    const row = (model: string, title: string, o: Record<string, unknown> = {}) => ({ provider: "claude-code", model, title, driver: "claude_code", allowed: true, ...o });
    const lists: unknown[] = [];
    const s = stub({
      "engine.models.list": (i) => {
        lists.push(i);
        return i["wait"] === true
          ? { models: [row("claude-opus-6", "Opus 6", { alias: "opus", isDefault: true }), row("claude-sonnet-5-5", "Sonnet 5.5", { alias: "sonnet", allowed: false, reason: "usage_limit" })], listed: { source: "live", updatedAt: 1, refreshing: false, failed: false } }
          : { models: [row("claude-opus-5-5", "Opus 5.5", { alias: "opus", isDefault: true }), row("claude-sonnet-5-5", "Sonnet 5.5", { alias: "sonnet" })], listed: { source: "saved", updatedAt: 1, refreshing: true, failed: false } };
      },
      "engine.usage.get": () => null,
      "agents.get": () => ({ agent: {} }),
    });
    const onOpus = { ...thread, agents: [{ ...thread.agents[0]!, model: "opus" }] } as Thread;
    const root = await mount(createRoot, <ChatBrain data={s.data} thread={onOpus} agent={{ id: "agt_intake", name: "Intake" }} accounts={connectedAccounts(ROWS)} mode="ask" onMode={() => undefined} close={() => undefined} narrow={false} say={() => undefined} />);
    await flush();
    await flush();
    assert.deepEqual(lists.map((i) => [(i as Record<string, unknown>)["refresh"] ?? null, (i as Record<string, unknown>)["wait"] ?? null]), [[true, null], [null, true]], "a refresh as the menu opens, then one quiet wait");
    await press(find(root, "model-model"));
    assert.match(textOf(find(root, "row-model-claude-opus-6")), /Opus 6/);
    assert.match(textOf(find(root, "row-model-claude-opus-6")), /Default/);
    assert.equal(find(root, "row-model-claude-opus-5-5"), null, "the saved list was replaced by the fresh one");
    assert.match(textOf(find(root, "row-model-claude-sonnet-5-5")), /Out of usage/, "usage greying is kept");
    assert.match(textOf(find(root, "model-models-line")), /Updated just now/);
    assert.match(textOf(find(root, "model-model")), /Opus 6/, "a pick saved as the alias shows the model it means today");
    assert.doesNotMatch(textOf(find(root, "model-models")), /Latest/);
  } finally { restore(); resetMissing(); }
});

test("the composer offers only accounts that can run a chat here: one the list marks unusable for the place is left out", () => {
  const rows = [
    { ref: "#Mine", driver: "claude_code", kind: "subscription", title: "Claude Code", status: "ok", usable: true },
    { ref: "#Team", driver: "anthropic", kind: "api_key", title: "Team key", status: "ok", usable: false, why: "An admin has not kept this account for this kind of work." },
    { ref: "#Old", driver: "codex", kind: "subscription", title: "Codex", status: "expired" },
    { ref: "#Plain", driver: "openai", kind: "api_key", title: "OpenAI", status: "ok" },
  ];
  assert.deepEqual(connectedAccounts(rows).map((a) => a.ref), ["#Mine", "#Plain"]);
});

test("the account notice never prints an email address", async () => {
  const { plainAccountName } = await import("./brain.tsx");
  assert.equal(plainAccountName("techmanager@mylegalacademy.com"), "that account");
  assert.equal(plainAccountName(undefined), "that account");
  assert.equal(plainAccountName("MLA work"), "MLA work");
});

test("the person's own accounts are listed, shown and pinned before a Space account (owner, 6 Nov)", () => {
  const rows = [
    { ref: "#space_oc", driver: "opencode-go", kind: "api_key", title: "OpenCode Go", name: "Space OpenCode", status: "ok", mine: false },
    { ref: "#mine_oc", driver: "opencode-go", kind: "api_key", title: "OpenCode Go", name: "My OpenCode", status: "ok", mine: true },
    { ref: "#mine_cl", driver: "claude_code", kind: "subscription", title: "Claude", name: "Claude", status: "ok", mine: true },
  ];
  assert.deepEqual(connectedAccounts(rows).map((a) => a.ref), ["#mine_oc", "#mine_cl", "#space_oc"]);
});

test("a chat with no pick of its own shows the last pick before its first turn; a pick of its own is kept; Auto counts", () => {
  const bare = { ...thread, agents: [{ agentId: "agt_intake", mode: "lead" }] } as unknown as Thread;
  assert.equal(withLastPick(bare, null), bare);
  const shown = withLastPick(bare, { model: "glm-5", provider: "opencode-go", effort: "high" });
  assert.deepEqual([shown.agents[0]!.model, shown.agents[0]!.provider, shown.agents[0]!.effort], ["glm-5", "opencode-go", "high"]);
  assert.equal(withLastPick(thread, { model: "glm-5" }).agents[0]!.model, "claude-sonnet-5-5", "its own pick wins");
  assert.equal(withLastPick(bare, { model: "auto" }).agents[0]!.model, "auto");
});

test("a model reads the way its provider names it everywhere: the listed title wins, and GLM and GPT keep their capitals", async () => {
  const { menuModels } = await import("./live-models.ts");
  assert.equal(prettyModel("glm-5"), "GLM 5");
  menuModels({ models: [{ model: "k2-thinking", title: "Kimi K2 Thinking", allowed: true }] });
  assert.equal(prettyModel("k2-thinking"), "Kimi K2 Thinking");
});
