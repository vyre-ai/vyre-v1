// Chat modes (Ask first, Auto, Plan) and effort reach each driver: the flag or setting each CLI and API takes, the tool session's hold for Ask first, and the Gate in every mode.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { CLI_ADAPTERS, createCliDriver } from "../src/drivers/cli/index.ts";
import type { CommandOptions } from "../src/drivers/cli/index.ts";
import { classifyCli } from "../src/drivers/cli/errors.ts";
import { anthropic, takesEffort } from "../src/drivers/api/anthropic.ts";
import { openai, openrouter } from "../src/drivers/api/openai.ts";
import type { CallRequest } from "../src/drivers/api/types.ts";
import { createToolSession } from "../src/tools/call.ts";
import type { Invoke } from "../../host/src/invoke.ts";
import { ctx, loadGenerated, thread } from "../src/tools/harness.ts";
import { driverDeps, newSpy, specOf } from "../fixtures/golden-streams/rig.ts";

const BASE: CommandOptions = { model: null, resume: null, mcpUrl: "http://127.0.0.1:4100/mcp", planMode: false, workFolder: "/work/acme", system: null };
const after = (argv: readonly string[], flag: string): string | undefined => argv[argv.indexOf(flag) + 1];
const allowedOf = (argv: readonly string[]): string[] => argv.slice(argv.indexOf("--allowedTools") + 1, argv.indexOf("--add-dir"));
const VYRE_AND_FOLDER = ["mcp__vyre__*", "Read", "Edit", "Write", "Glob", "Grep", "Bash"];

// ---- Claude Code: --permission-mode and --effort (both checked against `claude --help`, 2.1.314)

test("claude: Ask first is default and allows only the tools that change nothing; Auto is acceptEdits with every folder tool named; Plan is plan with the reading tools", () => {
  const cmd = (o: Partial<CommandOptions>) => CLI_ADAPTERS.claude_code.command({ ...BASE, ...o });
  const ask = cmd({ mode: "ask" });
  assert.equal(after(ask, "--permission-mode"), "default");
  assert.deepEqual(allowedOf(ask), ["mcp__vyre__*", "Read", "Glob", "Grep"], "Edit, Write and Bash would prompt, which a headless run cannot answer: they are withheld");
  const auto = cmd({ mode: "auto" });
  assert.equal(after(auto, "--permission-mode"), "acceptEdits");
  assert.deepEqual(allowedOf(auto), VYRE_AND_FOLDER);
  const plan = cmd({ mode: "plan" });
  assert.equal(after(plan, "--permission-mode"), "plan");
  assert.deepEqual(allowedOf(plan), ["mcp__vyre__*", "Read", "Glob", "Grep"]);
  // no mode (a step, a one-shot job): the older rule, plan mode alone is told apart
  assert.equal(after(cmd({}), "--permission-mode"), "default");
  assert.deepEqual(allowedOf(cmd({})), VYRE_AND_FOLDER);
  assert.equal(after(cmd({ planMode: true }), "--permission-mode"), "plan");
  for (const argv of [ask, auto, plan]) for (const banned of ["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "bypassPermissions"]) assert.equal(argv.includes(banned), false, banned);
});

test("claude: effort is --effort with the same four names, and absent when none was chosen", () => {
  for (const e of ["low", "medium", "high", "max"] as const) assert.equal(after(CLI_ADAPTERS.claude_code.command({ ...BASE, effort: e }), "--effort"), e);
  assert.equal(CLI_ADAPTERS.claude_code.command(BASE).includes("--effort"), false);
  assert.equal(CLI_ADAPTERS.claude_code.command({ ...BASE, effort: null }).includes("--effort"), false);
});

// ---- Codex: sandbox and approval policy through -c (codex-cli 0.164: -s takes read-only | workspace-write | danger-full-access; -a takes on-request | never), model_reasoning_effort

test("codex: Ask first and Plan run read-only, Auto runs workspace-write in a granted folder; the approval policy is never (a headless run cannot ask); the sandbox is never lifted", () => {
  const cmd = (o: Partial<CommandOptions>) => CLI_ADAPTERS.codex.command({ ...BASE, ...o });
  const conf = (argv: readonly string[], key: string): string | undefined => argv.find((a) => a.startsWith(`${key}=`));
  assert.equal(conf(cmd({ mode: "ask" }), "sandbox_mode"), 'sandbox_mode="read-only"');
  assert.equal(conf(cmd({ mode: "plan" }), "sandbox_mode"), 'sandbox_mode="read-only"');
  assert.equal(conf(cmd({ mode: "auto" }), "sandbox_mode"), 'sandbox_mode="workspace-write"');
  assert.equal(conf(cmd({ mode: "auto", workFolder: null }), "sandbox_mode"), 'sandbox_mode="read-only"', "no folder, nothing to write in");
  assert.equal(conf(cmd({ mode: "auto", noTools: true }), "sandbox_mode"), 'sandbox_mode="read-only"');
  for (const mode of ["ask", "auto", "plan"] as const) assert.equal(conf(cmd({ mode }), "approval_policy"), 'approval_policy="never"', mode);
  // no mode: the older rule and no approval key
  assert.equal(conf(cmd({}), "sandbox_mode"), 'sandbox_mode="workspace-write"');
  assert.equal(conf(cmd({ planMode: true }), "sandbox_mode"), 'sandbox_mode="read-only"');
  assert.equal(conf(cmd({}), "approval_policy"), undefined);
  for (const mode of ["ask", "auto", "plan"] as const) for (const banned of ["danger-full-access", "--dangerously-bypass-approvals-and-sandbox"]) assert.equal(cmd({ mode }).join(" ").includes(banned), false, banned);
});

test("codex: effort is model_reasoning_effort; max is high", () => {
  const eff = (e: "low" | "medium" | "high" | "max") => CLI_ADAPTERS.codex.command({ ...BASE, effort: e }).find((a) => a.startsWith("model_reasoning_effort="));
  assert.deepEqual(["low", "medium", "high", "max"].map((e) => eff(e as "low")), ['model_reasoning_effort="low"', 'model_reasoning_effort="medium"', 'model_reasoning_effort="high"', 'model_reasoning_effort="high"']);
  assert.equal(CLI_ADAPTERS.codex.command(BASE).some((a) => a.startsWith("model_reasoning_effort=")), false);
});

// ---- Grok: --permission-mode (default | acceptEdits | auto | dontAsk | bypassPermissions | plan) and --reasoning-effort (checked against `grok --help`, 1.0.70)

test("grok: Ask first is default, Auto is acceptEdits, Plan is plan; never bypassPermissions or --always-approve; effort is --reasoning-effort", () => {
  const cmd = (o: Partial<CommandOptions>) => CLI_ADAPTERS.grok.command({ ...BASE, ...o });
  assert.equal(after(cmd({ mode: "ask" }), "--permission-mode"), "default");
  assert.equal(after(cmd({ mode: "auto" }), "--permission-mode"), "acceptEdits");
  assert.equal(after(cmd({ mode: "plan" }), "--permission-mode"), "plan");
  assert.equal(cmd({}).includes("--permission-mode"), false, "no mode, no flag: as before");
  assert.equal(after(cmd({ planMode: true }), "--permission-mode"), "plan");
  for (const mode of ["ask", "auto", "plan"] as const) for (const banned of ["--always-approve", "bypassPermissions", "dontAsk"]) assert.equal(cmd({ mode }).includes(banned), false, banned);
  assert.deepEqual(["low", "medium", "high", "max"].map((e) => after(cmd({ effort: e as "low" }), "--reasoning-effort")), ["low", "medium", "high", "high"]);
  assert.equal(cmd({}).includes("--reasoning-effort"), false);
});

// ---- the session spec carries the mode and the agent's effort down to the process that is started

test("a Claude session opened for a chat in Auto at high effort is started with both", async () => {
  const spy = newSpy();
  const folder = mkdtempSync(join(tmpdir(), "vyre-modes-"));
  const driver = createCliDriver(CLI_ADAPTERS.claude_code, driverDeps(spy, { workFolder: () => folder }));
  const spec = specOf({ effort: "high" });
  const session = await driver.open({ ...spec, mode: "auto" });
  await session.close();
  const argv = spy.launches[0]!;
  assert.equal(after(argv, "--permission-mode"), "acceptEdits");
  assert.equal(after(argv, "--effort"), "high");
  assert.equal(after(argv, "--add-dir"), folder);
  assert.deepEqual(argv.slice(argv.indexOf("--allowedTools") + 1, argv.indexOf("--add-dir")), VYRE_AND_FOLDER);
});

test("a session opened in Plan is plan whatever the older planMode callback says", async () => {
  const spy = newSpy();
  const driver = createCliDriver(CLI_ADAPTERS.claude_code, driverDeps(spy, { planMode: () => false }));
  await (await driver.open({ ...specOf(), mode: "plan" })).close();
  assert.equal(after(spy.launches[0]!, "--permission-mode"), "plan");
});

test("a limit message from a CLI is a rate limit, so the turn can move to the next account", () => {
  for (const m of ["Claude AI usage limit reached|1761000000", "You've hit your limit", "You have hit your weekly limit. Resets Friday", "429 Too Many Requests", "rate_limit_error"]) assert.equal(classifyCli(m), "provider.rate_limited", m);
  assert.equal(classifyCli("Invalid API key"), "provider.auth_failed");
});

// ---- API drivers: effort

const REQ: CallRequest = { model: "claude-opus-5-5", system: [{ text: "s", stable: true }], tools: [], messages: [{ role: "user", text: "hi" }], maxOutputTokens: 1000, prefixHash: "h" };

test("anthropic: effort is output_config.effort for the models that take it, and left out for older ones", () => {
  for (const e of ["low", "medium", "high", "max"] as const) assert.deepEqual((anthropic.request({ ...REQ, effort: e }).body as { output_config?: unknown }).output_config, { effort: e });
  assert.equal("output_config" in (anthropic.request(REQ).body as object), false, "none chosen, none sent");
  for (const m of ["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-4-6", "claude-fable-5-1", "claude-haiku-5-5"]) assert.equal(takesEffort(m), true, m);
  for (const m of ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5", "claude-3-5-sonnet"]) {
    assert.equal(takesEffort(m), false, m);
    assert.equal("output_config" in (anthropic.request({ ...REQ, model: m, effort: "high" }).body as object), false, `${m} would refuse the field`);
  }
  assert.equal("thinking" in (anthropic.request({ ...REQ, effort: "max" }).body as object), false, "thinking is untouched");
});

test("openai: reasoning_effort for its reasoning models only; openrouter: reasoning.effort for any routed model; max is high", () => {
  const body = (a: typeof openai, model: string, effort: "low" | "max") => a.request({ ...REQ, model, effort }).body as Record<string, unknown>;
  assert.equal(body(openai, "gpt-5", "low")["reasoning_effort"], "low");
  assert.equal(body(openai, "o4-mini", "max")["reasoning_effort"], "high");
  assert.equal("reasoning_effort" in body(openai, "gpt-4o", "low"), false);
  assert.deepEqual(body(openrouter, "anthropic/claude-sonnet-5-5", "max")["reasoning"], { effort: "high" });
  assert.equal("reasoning" in (openai.request({ ...REQ, model: "gpt-5" }).body as object), false);
});

// ---- the tool session: Ask first holds what changes or sends; Auto holds nothing extra; the Gate stands in every mode

function rig() {
  const { catalog, defaults } = loadGenerated();
  const seen: Array<{ cap: string; askFirst: boolean | undefined; approval: string | undefined }> = [];
  const invoke: Invoke = async (cap, _input, seed) => {
    seen.push({ cap, askFirst: seed.askFirst, approval: seed.approval });
    // the pipeline: a call marked askFirst is parked unless approved; a declared Gate parks an agent's call unless approved
    const gated = catalog.all.find((t) => t.cap === cap)?.gated === true;
    if (seed.approval === undefined && (seed.askFirst === true || gated)) return { status: "held", taskId: "tsk_1", traceId: "t" };
    return { status: "ok", output: { cap }, traceId: "t" };
  };
  const session = createToolSession({ catalog, defaults, invoke, levelFor: () => null, canEngineer: () => false });
  const tools = catalog.all.filter((t) => !t.deferred || defaults.has(t.name));
  const pick = (f: (t: (typeof tools)[number]) => boolean) => tools.find(f)!;
  return { session, seen, catalog, defaults, pick };
}
const modeCtx = (mode: "ask" | "auto" | "plan") => ctx({ thread: thread({ mode, planMode: mode === "plan" }) });

test("Ask first: a tool that changes something is marked askFirst and held; a read and the tools plan mode allows are not", async () => {
  const r = rig();
  const write = r.pick((t) => t.effects === "write" && t.planMode === "blocked" && !t.gated && t.local === "none" && r.defaults.has(t.name));
  const read = r.pick((t) => t.effects === "read" && t.local === "none" && r.defaults.has(t.name));
  const w = await r.session.call(modeCtx("ask"), write.name, {});
  assert.equal(w.kind, "held");
  const rd = await r.session.call(modeCtx("ask"), read.name, {});
  assert.notEqual(rd.kind, "held");
  assert.deepEqual(r.seen.map((s) => [s.cap, s.askFirst]), [[write.cap, true], [read.cap, undefined]]);
  const allowed = r.pick((t) => t.effects === "write" && t.planMode === "allowed" && t.local === "none" && r.defaults.has(t.name));
  await r.session.call(modeCtx("ask"), allowed.name, {});
  assert.equal(r.seen.at(-1)!.askFirst, undefined, `${allowed.name} is safe in plan mode, so it never waits`);
});

test("Auto: nothing extra is held; and a send, post or payment is still held by the Gate, exactly as in Ask first", async () => {
  const r = rig();
  const write = r.pick((t) => t.effects === "write" && t.planMode === "blocked" && !t.gated && t.local === "none" && r.defaults.has(t.name));
  assert.notEqual((await r.session.call(modeCtx("auto"), write.name, {})).kind, "held", "auto runs it at once");
  assert.equal(r.seen.at(-1)!.askFirst, undefined);
  const outward = r.pick((t) => t.effects === "outward" && t.gated && t.local === "none" && r.defaults.has(t.name));
  for (const mode of ["auto", "ask"] as const) {
    const out = await r.session.call(modeCtx(mode), outward.name, {});
    assert.equal(out.kind, "held", `${outward.name} is held for a yes in ${mode}`);
    assert.equal(r.seen.at(-1)!.approval, undefined, "auto never supplies an approval of its own");
  }
});

test("Plan: tools that change or send are not offered and a call to one is refused, in every mode that is plan", async () => {
  const r = rig();
  const blocked = r.pick((t) => t.planMode === "blocked" && t.local === "none" && r.defaults.has(t.name));
  const c = modeCtx("plan");
  assert.equal(r.session.toolsFor(c).listed.some((t) => t.name === blocked.name), false);
  const res = await r.session.call(c, blocked.name, {});
  assert.equal(res.kind, "error");
  assert.equal(r.seen.length, 0, "nothing reached the pipeline");
});
