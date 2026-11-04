// The hooks layer around Vyre's own tools, the turn and each kind of driver (lane l-hooks). Fakes only: a recording port, a scripted provider.
import test from "node:test";
import assert from "node:assert/strict";
import { createTurnEngine, scriptedProvider } from "../src/turn-engine/index.ts";
import type { EngineAgent, OpenThread, ResolvedAccount } from "../src/turn-engine/index.ts";
import { NO_VERDICT } from "../src/tools/hooks.ts";
import type { HookFire, HookVerdict, HooksPort } from "../src/tools/hooks.ts";
import { ctx, makeSession } from "../src/tools/harness.ts";
import { claudeCode } from "../src/drivers/cli/claude.ts";
import { codex } from "../src/drivers/cli/codex.ts";
import { grok } from "../src/drivers/cli/grok.ts";
import { codexHash, hookFiles, hooksJson, shimCommand } from "../src/drivers/cli/hooks-config.ts";

const recorder = (answer: (f: HookFire) => HookVerdict = () => NO_VERDICT): { port: HooksPort; seen: HookFire[] } => {
  const seen: HookFire[] = [];
  return { seen, port: { fire: async (f) => { seen.push(f); return answer(f); } } };
};
const person = { kind: "person" as const, id: "dana" };
const agents = (): EngineAgent[] => [{ id: "intake", mode: "lead" }];
const account = (driver: string): ResolvedAccount => ({ ref: `#Dana_${driver}`, driver, provider: driver, kind: "api_key", payer: "dana", reason: "starter" });
const say = [{ type: "text" as const, text: "Hi." }, { type: "usage" as const, inputTokens: 10, outputTokens: 4 }, { type: "done" as const }];

for (const driver of ["anthropic", "claude_code", "codex", "grok"]) {
  const engineName = driver === "anthropic" ? "api" : driver;
  test(`a ${driver} turn fires session.start, prompt.submit and turn.end once each, in order`, async () => {
    const r = recorder();
    const p = scriptedProvider({ script: () => say });
    const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, hooks: r.port, resolveAccount: async () => account(driver) });
    engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: agents() });
    engine.receive({ threadId: "T", author: person, body: "hello there" });
    await engine.idle("T");
    assert.deepEqual(r.seen.map((f) => f.event), ["session.start", "prompt.submit", "turn.end"]);
    assert.ok(r.seen.every((f) => f.engine === engineName && f.threadId === "T" && f.agentId === "intake" && f.asker === "dana"));
    assert.equal(r.seen[1]!.prompt, "hello there");
  });
}

test("a helper's turn also fires helper.start and helper.end once", async () => {
  const r = recorder();
  const p = scriptedProvider({ script: () => say });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, hooks: r.port, resolveAccount: async () => account("codex") });
  const th: OpenThread = { id: "H", kind: "helper", starter: "dana", agents: agents() };
  engine.openThread(th);
  engine.receive({ threadId: "H", author: person, body: "go" });
  await engine.idle("H");
  assert.deepEqual(r.seen.map((f) => f.event), ["session.start", "helper.start", "prompt.submit", "turn.end", "helper.end"]);
});

test("a hook that blocks the prompt stops the turn with hook_blocked, and nothing is sent to the model", async () => {
  const r = recorder((f) => (f.event === "prompt.submit" ? { block: { reason: "no client names here", hookId: "hok_1", by: "usr_admin", scope: "space" }, notes: [], ran: 1 } : NO_VERDICT));
  const p = scriptedProvider({ script: () => say });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, hooks: r.port });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: agents() });
  engine.receive({ threadId: "T", author: person, body: "hello" });
  await engine.idle("T");
  const t = engine.turns("T")[0]!;
  assert.equal(t.state, "failed");
  assert.equal(t.error?.code, "hook_blocked");
  assert.match(t.error?.message ?? "", /no client names here/);
});

test("a hook note reaches the model as the turn's notice", async () => {
  const r = recorder((f) => (f.event === "prompt.submit" ? { block: null, notes: ["The client is in Lahore"], ran: 1 } : NO_VERDICT));
  const inputs: Array<{ notice?: string }> = [];
  const engine = createTurnEngine({
    holder: "host:s", hooks: r.port,
    openSession: async () => ({ warm: true, send: (i: { notice?: string }) => { inputs.push(i); return (async function* () { yield* say; })(); }, sendToolResult() {}, inject() {}, async cancel() {}, async close() {} }) as never,
  });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: agents() });
  engine.receive({ threadId: "T", author: person, body: "hello" });
  await engine.idle("T");
  assert.equal(inputs[0]?.notice, "The client is in Lahore");
});

test("a hook port that throws never fails the turn", async () => {
  const p = scriptedProvider({ script: () => say });
  const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, hooks: { fire: async () => { throw new Error("down"); } } });
  engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: agents() });
  engine.receive({ threadId: "T", author: person, body: "hello" });
  await engine.idle("T");
  assert.equal(engine.turns("T")[0]!.state, "completed");
});

test("Vyre's own tools: tool.before then tool.after once; an outward tool also asks outward.before; for every engine alike", async () => {
  for (const engine of ["api", "claude_code", "codex", "grok"]) {
    const r = recorder();
    const { session, loaded } = makeSession({ hooks: { fire: async (c, f) => r.port.fire({ ...f, agentId: c.agentId, asker: c.asker, threadId: c.thread.threadId, engine }) } });
    const read = loaded.catalog.all.find((t) => t.effects === "read" && t.toolset !== "engineer" && loaded.defaults.has(t.name))!;
    const out = loaded.catalog.all.find((t) => t.effects === "outward" && t.toolset !== "engineer")!;
    session.preload("T1", [read.name, out.name]);
    await session.call(ctx(), read.name, {});
    await new Promise((ok) => setImmediate(ok));
    assert.deepEqual(r.seen.map((f) => f.event), ["tool.before", "tool.after"], engine);
    r.seen.length = 0;
    await session.call(ctx(), out.name, {});
    assert.deepEqual(r.seen.slice(0, 2).map((f) => f.event), ["tool.before", "outward.before"], engine);
  }
});

test("a tool.before block reaches the model as the error, and the tool does not run; a note rides on the result", async () => {
  const block: HookVerdict = { block: { reason: "the address is not in Contacts", hookId: "hok_9", by: "agt_intake", scope: "chat" }, notes: [], ran: 1 };
  const { session, calls, loaded } = makeSession({ hooks: { fire: async (_c, f) => (f.event === "tool.before" ? block : NO_VERDICT) } });
  const read = loaded.catalog.all.find((t) => t.effects === "read" && loaded.defaults.has(t.name) && t.toolset !== "engineer")!;
  const r = await session.call(ctx(), read.name, {});
  assert.equal(r.kind, "error");
  assert.match(JSON.stringify(r.result.content), /the address is not in Contacts/);
  assert.equal(calls.length, 0, "the call never reached the pipeline");
  const noted = makeSession({ hooks: { fire: async (_c, f) => (f.event === "tool.before" ? { block: null, notes: ["Ask for the full name"], ran: 1 } : NO_VERDICT) } });
  const ok = await noted.session.call(ctx(), read.name, {});
  assert.equal(ok.kind, "result");
  assert.deepEqual((ok.result.content as { hookNotes?: string[] }).hookNotes, ["Ask for the full name"]);
});

test("a hooks layer that throws lets the tool run", async () => {
  const { session, calls, loaded } = makeSession({ hooks: { fire: async () => { throw new Error("down"); } } });
  const read = loaded.catalog.all.find((t) => t.effects === "read" && loaded.defaults.has(t.name) && t.toolset !== "engineer")!;
  assert.equal((await session.call(ctx(), read.name, {})).kind, "result");
  assert.equal(calls.length, 1);
});

const stdio = { command: "/usr/bin/node", args: ["/work/mcp-shim.mjs", "/work/mcp.sock"] };
const opts = { model: null, resume: null, mcpUrl: "http://127.0.0.1:1/mcp", mcpStdio: stdio, planMode: false, workFolder: "/work", system: null };

test("Claude Code is handed a generated hooks config whose commands call the vyre-hook shim", () => {
  const argv = claudeCode.command(opts);
  const i = argv.indexOf("--settings");
  assert.ok(i > 0);
  const cfg = JSON.parse(argv[i + 1]!) as ReturnType<typeof hooksJson>;
  assert.deepEqual(Object.keys(cfg.hooks), ["PreToolUse", "PostToolUse", "SubagentStart", "SubagentStop"]);
  assert.equal(cfg.hooks["PreToolUse"]![0]!.hooks[0]!.command, shimCommand(stdio, "PreToolUse"));
  assert.match(cfg.hooks["PreToolUse"]![0]!.hooks[0]!.command, /mcp-shim\.mjs" "\/work\/mcp\.sock" hook PreToolUse$/);
  assert.equal(claudeCode.command({ ...opts, noTools: true }).includes("--settings"), false, "no tools, no hooks config");
  assert.equal(claudeCode.command({ ...opts, lean: true }).includes("--settings"), false);
  assert.ok(!argv.join(" ").includes("VYRE_MCP_TOKEN="), "no token in the command line");
});

test("Codex gets the same file and a trusted hash for each hook, as Codex records it", () => {
  const argv = codex.command(opts);
  const trust = argv.filter((a) => a.startsWith("hooks.state."));
  assert.equal(trust.length, 4);
  assert.ok(trust.some((a) => a.includes("/work/.codex/hooks.json:pre_tool_use:0:0") && a.includes(codexHash("PreToolUse", shimCommand(stdio, "PreToolUse")))));
  // the hash recipe reproduces a hash a real Codex wrote for a hook of ~/.codex/hooks.json
  assert.equal(codexHash("pre_compact", "python3 '/Users/irfad/Claude/.codex/hooks/journal.py'", 15), "sha256:e118ef3121a2e4aaa5660d749a199e647e5fcc599a35970745354ba1963b134d");
  const files = hookFiles("codex", { workFolder: "/work", stdio });
  assert.deepEqual(Object.keys(files), ["/work/.codex/hooks.json"]);
});

test("Grok reads the file from its project and home hook folders", () => {
  const files = hookFiles("grok", { workFolder: "/work", stdio, home: "/home/x" });
  assert.deepEqual(Object.keys(files).sort(), ["/home/x/.grok/hooks/vyre.json", "/work/.grok/hooks/vyre.json"]);
  assert.deepEqual(JSON.parse(files["/work/.grok/hooks/vyre.json"]!), hooksJson(stdio));
  assert.ok(grok.command(opts).length > 0);
  assert.deepEqual(hookFiles("claude_code", { workFolder: "/work", stdio }), {});
});

test("a turn stopped by a hook that then says nothing still ends with an agent message saying what happened; one that spoke is left alone", async () => {
  const silent = [{ type: "done" as const }];
  for (const [said, expectReply] of [[silent, true], [[{ type: "text" as const, text: "I was stopped." }, { type: "done" as const }], false]] as const) {
    const p = scriptedProvider({ script: () => said as never });
    const port: HooksPort = { fire: async () => NO_VERDICT, stoppedSince: (t) => (t === "T" ? "the address is not in Contacts" : undefined) };
    const engine = createTurnEngine({ holder: "host:s", openSession: p.openSession, hooks: port });
    engine.openThread({ id: "T", kind: "chat", starter: "dana", agents: agents() });
    engine.receive({ threadId: "T", author: person, body: "send it" });
    await engine.idle("T");
    const replies = engine.messages("T").filter((m) => m.author.kind === "agent").map((m) => m.body);
    if (expectReply) assert.deepEqual(replies, ["I did not do that. A hook stopped it: the address is not in Contacts"]);
    else assert.deepEqual(replies, ["I was stopped."]);
  }
});
