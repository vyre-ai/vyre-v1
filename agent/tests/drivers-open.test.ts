// @nocache  (these tests start real processes and read a fixture file that is not an import, so a pass is never reused from the cache)
// The real session opener behind the turn engine (P-L2_23c): a turn runs on the account the accounts module resolved, through the API or CLI driver that account names, with the key
// filled in by the Vault at the last moment. The CLI is a real process (host/tests/fixtures/fake-cli-driver/fake-cli.mjs); the engine is the real turn engine; only the Vault, the MCP
// minting and the provider's HTTP are fakes. The host half of the same packet (vault lookup and MCP minting through invoke) is host/tests/engine.turns.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalLauncher } from "../src/drivers/cli/index.ts";
import type { Launcher } from "../src/drivers/cli/index.ts";
import { createSessionOpener } from "../src/drivers/open/index.ts";
import type { McpPort, OpenAccount, SessionOpener, SessionOpenerDeps } from "../src/drivers/open/index.ts";
import { ctx, chunked, fakeClock, fakeFetch, fixture } from "../src/drivers/api/testing.ts";
import { createTurnEngine } from "../src/turn-engine/index.ts";
import type { ToolRunner } from "../src/turn-engine/index.ts";
import { createApiTools } from "../src/drivers/open/index.ts";
import { makeSession } from "../src/tools/harness.ts";
import type { EngineAgent, SessionSpec, TurnRow } from "../src/turn-engine/index.ts";
import type { Lookup, ValueSource } from "../src/vault-use/index.ts";

const FAKE_CLI = fileURLToPath(new URL("../../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const SECRET = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
const API_KEY = "sk-ant-api03-APIkeyVALUE9876543210zyxwvuts"; // secret-scan: fake
const ACCESS = "codex-access-token-LIVE-0123456789abcdef"; // secret-scan: fake
const GROK_TOKEN = "grok-session-token-LIVE-0123456789abcdef"; // secret-scan: fake
const CODEX_FILES = JSON.stringify({ ".codex/auth.json": JSON.stringify({ tokens: { access_token: ACCESS, refresh_token: "refresh-token-LIVE-0123456789" } }) });
const GROK_FILES = JSON.stringify({ ".grok/auth.json": JSON.stringify({ token: GROK_TOKEN }) });
const SIGNIN_CLI = fileURLToPath(new URL("../../host/tests/fixtures/fake-cli-driver/fake-signin-cli.mjs", import.meta.url));
const TRACE = "a".repeat(32);

const value = (v: string, itemId: string): Lookup => ({ kind: "value", itemId, value: v, spaceOnly: false, injectIntoDeployments: false });

/** What the Vault knows, by handle. The subscription account names the item; the engine's setup-token field is the handle that is filled. */
const VAULT: Record<string, Lookup> = {
  "#Dana_Claude.setup_token": value(SECRET, "vit_claude"),
  "#Team_Anthropic_Key": value(API_KEY, "vit_api"),
  "#CodexSignin.credentials": value(CODEX_FILES, "vit_codex"),
  "#GrokSignin.credentials": value(GROK_FILES, "vit_grok"),
  "#Denied.setup_token": { kind: "denied", reason: "no_access" },
  "#Labeled.setup_token": { kind: "denied", reason: "provider_label" },
};

const ACCOUNTS: Record<string, OpenAccount> = {
  "#Dana_Claude": { ref: "#Dana_Claude", driver: "claude_code", kind: "subscription", payer: "dana" },
  "#Gone": { ref: "#Gone", driver: "claude_code", kind: "subscription", payer: "dana" },
  "#Denied": { ref: "#Denied", driver: "claude_code", kind: "subscription", payer: "dana" },
  "#Labeled": { ref: "#Labeled", driver: "claude_code", kind: "subscription", payer: "dana" },
  "#CodexSub": { ref: "#CodexSub", driver: "codex", kind: "subscription", payer: "dana" },
  "#CodexSignin": { ref: "#CodexSignin", driver: "codex", kind: "subscription", payer: "dana" },
  "#GrokSignin": { ref: "#GrokSignin", driver: "grok", kind: "subscription", payer: "dana" },
  "#Nowhere": { ref: "#Nowhere", driver: "nonesuch", kind: "api_key", payer: "dana" },
  "#Team_Anthropic_Key": { ref: "#Team_Anthropic_Key", driver: "anthropic", kind: "api_key", payer: "dana" },
};

interface Rig {
  opener: SessionOpener;
  engine: ReturnType<typeof createTurnEngine>;
  launches: string[][];
  envs: Array<Readonly<Record<string, string>>>;
  pids: number[];
  minted: Array<{ principal: string; actingFor: string; threadId: string; traceId: string; sessionId: string; token: string }>;
  closed: string[];
  misses: unknown[];
  used: unknown[];
}

function rig(over: Partial<SessionOpenerDeps> = {}, callTool?: ToolRunner): Rig {
  const r = { launches: [] as string[][], envs: [] as Array<Readonly<Record<string, string>>>, pids: [] as number[], minted: [] as Rig["minted"], closed: [] as string[], misses: [] as unknown[], used: [] as unknown[] };
  const local = createLocalLauncher({ wrap: (argv) => { r.launches.push([...argv]); return [process.execPath, FAKE_CLI, ...argv]; }, baseEnv: { PATH: process.env["PATH"] ?? "" } });
  const launcher: Launcher = {
    async spawn(spec) {
      r.envs.push(spec.env);
      const p = await local.spawn(spec);
      if (p.pid !== undefined) r.pids.push(p.pid);
      return p;
    },
  };
  const source: ValueSource = { lookup: async (h) => VAULT[h] ?? { kind: "unknown" } };
  let n = 0;
  const mcp: McpPort = {
    async mint(i) {
      n += 1;
      const row = { ...i, sessionId: `ses_${n}`, token: `vys_token_${n}_0123456789abcdef0123456789` };
      r.minted.push(row);
      return { sessionId: row.sessionId, sessionToken: row.token, url: "http://127.0.0.1:41800/mcp", expiresAt: 9_999_999_999_999 };
    },
    async close(id) { r.closed.push(id); },
  };
  const opener = createSessionOpener({
    source, reportMiss: (m) => { r.misses.push(m); }, launcher, mcp, apiContext: () => ctx(), cli: { graceMs: 400 },
    onUsed: (e) => { r.used.push(e.used); }, ...over,
  });
  // The engine's side of the contract: the account the accounts module resolved, and the turn's ids, ride on the spec.
  const engine = createTurnEngine({
    holder: "host:s",
    ...(callTool ? { callTool } : {}),
    openSession: (spec: SessionSpec) => {
      const account = spec.agent.accountRef === undefined ? undefined : ACCOUNTS[spec.agent.accountRef];
      return opener.openSession({ ...spec, ...(account ? { account } : {}), turnId: "turn_1", traceId: TRACE } as SessionSpec);
    },
  });
  return { ...r, opener, engine };
}

const agent = (accountRef: string | undefined, over: Partial<EngineAgent> = {}): EngineAgent => ({ id: "intake", mode: "lead", model: "sonnet", ...(accountRef ? { accountRef } : {}), ...over });

async function ask(g: Rig, body: string, a: EngineAgent, thread = "T1", starter = "dana"): Promise<{ turn: TurnRow; reply: string }> {
  g.engine.openThread({ id: thread, kind: "chat", starter, agents: [a] });
  g.engine.receive({ threadId: thread, author: { kind: "person", id: starter }, body });
  await g.engine.idle(thread);
  const turn = g.engine.turns(thread).at(-1);
  assert.ok(turn, "a turn ran");
  const reply = g.engine.messages(thread).filter((m) => m.author.kind === "agent").at(-1)?.body ?? "";
  return { turn, reply };
}

const everything = (g: Rig, threads: string[]): string =>
  JSON.stringify({ events: g.engine.events(), turns: g.engine.turns(), messages: threads.map((t) => g.engine.messages(t)), misses: g.misses, used: g.used, minted: g.minted.map((m) => ({ ...m, token: undefined })) });

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("until: condition never became true");
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("a CLI turn on a subscription account streams the engine's reply into the thread", async () => {
  const g = rig();
  const { turn, reply } = await ask(g, "hello", agent("#Dana_Claude"));
  assert.equal(turn.state, "completed");
  assert.equal(reply, "Hello from the fake engine.");
  assert.equal(turn.tokensIn, 11);
  assert.equal(turn.tokensOut, 7);
  assert.equal(turn.asker, "dana");
  assert.ok(g.engine.events("T1").some((e) => e.type === "turn.block" && e.kind === "text"), "the reply left as blocks while it streamed");
  assert.ok(g.engine.events("T1").some((e) => e.type === "turn.completed"));
  await g.opener.close();
});

test("the key reaches the engine process through its environment and nowhere else; the MCP token is minted for this session and travels the same way", async () => {
  process.env["HOST_SENTINEL"] = "must-not-reach-the-engine";
  const g = rig();
  const { reply } = await ask(g, "envcheck", agent("#Dana_Claude"));
  delete process.env["HOST_SENTINEL"];
  const seen = JSON.parse(reply) as { keys: string[]; argvHoldsKey: boolean; mcpTokenInEnv: boolean; mcpTokenInArgv: boolean; mcpUrl: string; mcpAuth: string; env: string[] };
  assert.deepEqual(seen.keys, [`CLAUDE_CODE_OAUTH_TOKEN:${SECRET.length}`], "the setup-token variable, and no other key variable");
  assert.equal(seen.argvHoldsKey, false);
  assert.equal(seen.mcpTokenInEnv, true);
  assert.equal(seen.mcpTokenInArgv, false);
  assert.equal(seen.mcpUrl, "http://127.0.0.1:41800/mcp");
  assert.equal(seen.mcpAuth, "Bearer ${VYRE_MCP_TOKEN}", "the command line names the variable; it never holds the token");
  assert.ok(!seen.env.includes("HOST_SENTINEL"), "the host's own environment is not passed through");

  assert.equal(g.launches.length, 1);
  for (const word of g.launches[0] ?? []) { assert.ok(!word.includes(SECRET)); assert.ok(!word.includes(g.minted[0]?.token ?? "?")); }
  assert.equal(g.envs[0]?.["CLAUDE_CODE_OAUTH_TOKEN"], SECRET, "the one place the value exists is the process environment");
  assert.equal(g.envs[0]?.["VYRE_MCP_TOKEN"], g.minted[0]?.token);

  assert.equal(g.minted.length, 1);
  assert.deepEqual({ ...g.minted[0], sessionId: undefined, token: undefined }, { principal: "intake", actingFor: "dana", threadId: "T1", traceId: TRACE, sessionId: undefined, token: undefined });
  assert.deepEqual(g.used, [[{ handle: "#Dana_Claude.setup_token", itemId: "vit_claude" }]], "the audit gets the item id and the handle");
  await g.opener.close();
});

test("the key is absent from events, messages, turn rows, miss reports and errors, even when the engine itself prints it", async () => {
  const g = rig();
  const leaked = await ask(g, "leak", agent("#Dana_Claude"), "T1");
  assert.equal(leaked.turn.state, "completed");
  assert.equal(leaked.reply, "The key is [#Dana_Claude.setup_token] ok", "the value became the handle's marker while it was still a stream");
  const died = await ask(g, "die", agent("#Dana_Claude"), "T2");
  assert.equal(died.turn.state, "failed");
  assert.match(died.turn.error?.message ?? "", /boom: the engine crashed with \[#Dana_Claude\.setup_token\]/);
  const all = everything(g, ["T1", "T2"]);
  for (const forbidden of [SECRET, Buffer.from(SECRET).toString("base64"), ...g.minted.map((m) => m.token)]) assert.ok(!all.includes(forbidden), "no secret in anything the engine, the thread or the audit kept");
  assert.deepEqual(g.misses, [], "the scrubber caught every spelling, so there is nothing to report");
  await g.opener.close();
});

test("a turn ends by giving its session back warm; the next turn on the thread reuses the process and the MCP token; closing the opener ends both", async () => {
  const g = rig();
  await ask(g, "hello", agent("#Dana_Claude"));
  const first = g.opener.pool.status().sessions.find((s) => s.driver === "claude_code");
  assert.deepEqual({ warm: first?.warm, busy: first?.busy }, { warm: 1, busy: 0 }, "no session is left leased after the turn");
  assert.equal(g.closed.length, 0, "a warm session keeps its MCP token");

  g.engine.receive({ threadId: "T1", author: { kind: "person", id: "dana" }, body: "hello" });
  await g.engine.idle("T1");
  assert.equal(g.engine.turns("T1").length, 2);
  assert.equal(g.launches.length, 1, "the same process answered both turns");
  assert.equal(g.minted.length, 1);
  assert.equal(g.opener.pool.status().sessions.find((s) => s.driver === "claude_code")?.hits, 1);

  const pid = g.pids[0];
  assert.ok(pid !== undefined && alive(pid));
  await g.opener.close();
  await until(() => !alive(pid));
  assert.deepEqual(g.closed, [g.minted[0]?.sessionId], "the token is revoked when the session closes");
});

test("two people never share a warm session, even on the same account and agent", async () => {
  const g = rig();
  const spec = (asker: string): SessionSpec => ({ threadId: "T1", agent: agent("#Dana_Claude"), asker, account: ACCOUNTS["#Dana_Claude"], turnId: "t", traceId: TRACE } as SessionSpec);
  const a = await g.opener.openSession(spec("dana"));
  await a.close();
  const b = await g.opener.openSession(spec("sam"));
  await b.close();
  assert.equal(g.launches.length, 2);
  assert.deepEqual(g.minted.map((m) => m.actingFor), ["dana", "sam"]);
  await g.opener.close();
});

test("a failing engine is a clear error state with a code the accounts module understands, never a hang", async () => {
  const g = rig();
  const bad = await ask(g, "authfail", agent("#Dana_Claude"), "T1");
  assert.equal(bad.turn.state, "failed");
  assert.equal(bad.turn.error?.code, "provider.auth_failed");
  assert.match(bad.turn.error?.message ?? "", /Invalid API key/);
  assert.ok(g.engine.events("T1").some((e) => e.type === "turn.failed" && e.code === "provider.auth_failed"));
  assert.equal(g.engine.messages("T1").filter((m) => m.author.kind === "agent").length, 0, "a failed turn posts no reply");

  const crashed = await ask(g, "die", agent("#Dana_Claude"), "T2");
  assert.equal(crashed.turn.state, "failed");
  assert.equal(crashed.turn.error?.code, "engine.cli_error");
  await g.opener.close();
});

const REFUSED: Array<[string, string | undefined, string]> = [
  ["an account the Vault does not know", "#Gone", "engine.account_unavailable"],
  ["an account the asker has no access to", "#Denied", "permission.no_grant"],
  ["a key the label rule keeps from this provider", "#Labeled", "permission.provider_label"],
  ["a driver that does not exist", "#Nowhere", "engine.unknown_driver"],
  ["a turn with no account at all", undefined, "engine.no_account"],
];
for (const [what, ref, code] of REFUSED) {
  test(`${what}: the turn fails with ${code} before any engine process starts`, async () => {
    const g = rig();
    const { turn } = await ask(g, "hello", agent(ref));
    assert.equal(turn.state, "failed");
    assert.equal(turn.error?.code, code);
    assert.equal(g.launches.length, 0);
    assert.deepEqual(g.minted.map((m) => m.sessionId).sort(), g.closed.slice().sort(), "a token minted for a session that never started is revoked");
    await g.opener.close();
  });
}

test("an API-key account runs on the HTTP driver; the key is in the request header and nowhere in the thread", async () => {
  const f = fakeFetch(() => ({ chunks: chunked(fixture("anthropic-text"), 64) }));
  const g = rig({ fetch: f.fetch, clock: fakeClock() });
  const { turn, reply } = await ask(g, "who are my newest leads?", agent("#Team_Anthropic_Key", { model: "claude-sonnet-5-5" }));
  assert.equal(turn.state, "completed");
  assert.equal(reply, "Hello there, Dana. Café ready.");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0]?.headers["x-api-key"], API_KEY);
  assert.equal(g.launches.length, 0, "an API account starts no process");
  assert.equal(g.minted.length, 0, "and needs no loopback MCP session");
  assert.ok(!everything(g, ["T1"]).includes(API_KEY));
  assert.deepEqual(g.used, [[{ handle: "#Team_Anthropic_Key", itemId: "vit_api" }]]);
  await g.opener.close();
});

function toolRig(rules?: { deny?: string[] }) {
  const t = makeSession();
  const name = [...t.loaded.defaults].find((n) => { const d = t.loaded.catalog.byName(n); return d !== undefined && d.effects === "read" && d.local === "none" && n !== "tool_search"; });
  assert.ok(name, "the default tool set has a plain read tool");
  const tools = createApiTools({ session: t.session, space: "spc_1", system: () => [{ text: "You are Intake.", stable: true }], ...(rules ? { rules: () => rules } : {}) });
  const f = fakeFetch((_r, n) => ({ chunks: chunked(fixture(n === 0 ? "anthropic-tool" : "anthropic-tool-answer").replaceAll("records_list", name), 64) }));
  const g = rig({ fetch: f.fetch, clock: fakeClock(), apiContext: tools.context }, tools.runner);
  return { g, f, name, invokes: t.calls };
}

test("an API-key turn is offered the agent's tools, runs a call as the agent for the asker, and gives the model the result", async () => {
  const { g, f, name, invokes } = toolRig();
  const { turn, reply } = await ask(g, "who are my newest leads?", agent("#Team_Anthropic_Key", { model: "claude-sonnet-5-5" }));
  assert.equal(turn.state, "completed");
  assert.equal(reply, "Let me look.Found 3 leads.");
  assert.ok(((f.requests[0]?.body as { tools?: Array<{ name: string }> }).tools ?? []).some((x) => x.name === name), "the tool was advertised");
  assert.equal(invokes.length, 1);
  assert.deepEqual({ principal: invokes[0]?.principal, actingFor: invokes[0]?.actingFor }, { principal: "intake", actingFor: "dana" });
  assert.equal(f.requests.length, 2, "the result went back to the model");
  assert.ok(g.engine.events("T1").some((e) => e.type === "turn.block" && e.kind === "tool_call"), "the call shows as a tool block");
  await g.opener.close();
});

test("a tool the agent may not use is refused in the pipeline's words and never invoked; the turn goes on", async () => {
  const probe = toolRig();
  const { g, f, invokes } = toolRig({ deny: [probe.name] });
  const { turn } = await ask(g, "who are my newest leads?", agent("#Team_Anthropic_Key", { model: "claude-sonnet-5-5" }));
  assert.equal(turn.state, "completed");
  assert.equal(invokes.length, 0);
  assert.match(JSON.stringify(f.requests[1]?.body), /agent_denied/);
  await g.opener.close();
});

// ---- Codex and Grok run on the sign-in files their Vault item holds

/** The engine side of a sign-in kept in files, in one place: the files in VYRE_CRED_FILES go in a home for this process, the variable is removed, and the stand-in CLI reads them from there. */
function filesLauncher(seen: Array<Readonly<Record<string, string>>>, homes: string[]): Launcher {
  const base = createLocalLauncher({ wrap: (argv) => [process.execPath, SIGNIN_CLI, ...argv], baseEnv: { PATH: process.env["PATH"] ?? "" } });
  return {
    async spawn(spec) {
      seen.push(spec.env);
      const { VYRE_CRED_FILES: files, ...env } = spec.env as Record<string, string>;
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-open-home-"));
      homes.push(home);
      for (const [rel, text] of Object.entries(JSON.parse(files ?? "{}") as Record<string, string>)) { fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true }); fs.writeFileSync(path.join(home, rel), text, { mode: 0o600 }); }
      return base.spawn({ ...spec, argv: spec.argv, env: { ...env, HOME: home } });
    },
  };
}

for (const [driver, ref, token, tool] of [["codex", "#CodexSignin", ACCESS, "codex"], ["grok", "#GrokSignin", GROK_TOKEN, "grok"]] as const) {
  test(`a ${driver} turn runs on its sign-in: the files are filled from the Vault into VYRE_CRED_FILES, the engine finds them, and the token is in no reply`, async () => {
    const seen: Array<Readonly<Record<string, string>>> = [];
    const homes: string[] = [];
    const g = rig({ launcher: filesLauncher(seen, homes) });
    const found = await ask(g, "authcheck", agent(ref, { model: driver === "codex" ? "gpt-5-codex" : "grok-4" }));
    assert.equal(found.turn.state, "completed", JSON.stringify(found.turn.error));
    assert.match(found.reply, new RegExp(`^${tool} signed in as [0-9]+:.{4} mode 600 env none$`));
    assert.equal(seen[0]?.["VYRE_CRED_FILES"], driver === "codex" ? CODEX_FILES : GROK_FILES, "the one place the value exists on the way in is the launcher's environment");
    assert.equal(seen[0]?.["CODEX_API_KEY"] ?? seen[0]?.["XAI_API_KEY"], undefined, "no API key variable is set for a sign-in");
    assert.equal(everything(g, ["T1"]).includes(token), false, "the token is in no event, turn, message or record");
    await g.opener.close();
    for (const h of homes) fs.rmSync(h, { recursive: true, force: true });
  });

  test(`a ${driver} engine that prints its token is scrubbed, inside the reply and on stderr`, async () => {
    const homes: string[] = [];
    const g = rig({ launcher: filesLauncher([], homes) });
    const leaked = await ask(g, "leak", agent(ref, { model: driver === "codex" ? "gpt-5-codex" : "grok-4" }));
    assert.equal(leaked.reply.includes(token), false);
    assert.equal(everything(g, ["T1"]).includes(token), false);
    await g.opener.close();
    for (const h of homes) fs.rmSync(h, { recursive: true, force: true });
  });
}

test("a Codex sign-in whose files the Vault does not hold fails the turn with engine.account_unavailable and starts no engine", async () => {
  const g = rig();
  const { turn } = await ask(g, "hello", agent("#CodexSub", { model: "gpt-5-codex" }));
  assert.equal(turn.state, "failed");
  assert.equal(turn.error?.code, "engine.account_unavailable");
  assert.equal(g.launches.length, 0);
  await g.opener.close();
  assert.deepEqual(g.minted.map((m) => m.sessionId).sort(), g.closed.slice().sort(), "a token minted for a session that never started is revoked");
});
