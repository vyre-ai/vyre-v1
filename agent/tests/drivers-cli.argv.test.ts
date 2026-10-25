// The command line of each CLI and the small parts under the drivers: what is switched on and off, what never appears in a command line, how output is split into lines, how a failure is named,
// and what a turn is sent.
import test from "node:test";
import assert from "node:assert/strict";
import { CLI_ADAPTERS, TOKEN_ENV, channel, classifyCli, defaultPrompt, lines } from "../src/drivers/cli/index.ts";
import type { CommandOptions } from "../src/drivers/cli/index.ts";
import { message, turnOf } from "../fixtures/golden-streams/rig.ts";

const BASE: CommandOptions = { model: null, resume: null, mcpUrl: "http://127.0.0.1:4100/mcp", planMode: false, workFolder: null, system: null };
const after = (argv: readonly string[], flag: string): string | undefined => argv[argv.indexOf(flag) + 1];
const SECRET = "tok-allowed-0123456789abcdef";

test("claude: headless stream-json both ways with partial messages, Vyre's server only, Vyre's tools only", () => {
  const argv = CLI_ADAPTERS.claude_code.command(BASE);
  assert.equal(argv[0], "claude");
  for (const f of ["-p", "--verbose", "--include-partial-messages", "--strict-mcp-config"]) assert.ok(argv.includes(f), f);
  assert.equal(after(argv, "--input-format"), "stream-json");
  assert.equal(after(argv, "--output-format"), "stream-json");
  assert.equal(after(argv, "--permission-mode"), "default");
  assert.equal(after(argv, "--allowedTools"), "mcp__vyre__*");
  assert.equal(after(argv, "--tools"), "", "the CLI's own tools are off on a chat with no work folder");
  assert.equal(argv.includes("--add-dir"), false);
  const cfg = JSON.parse(after(argv, "--mcp-config") ?? "{}") as { mcpServers: Record<string, { url: string; headers: Record<string, string> }> };
  assert.deepEqual(Object.keys(cfg.mcpServers), ["vyre"]);
  assert.equal(cfg.mcpServers["vyre"]?.url, BASE.mcpUrl);
  assert.equal(cfg.mcpServers["vyre"]?.headers["Authorization"], "Bearer ${" + TOKEN_ENV + "}", "the token is named, never carried");
});

test("claude: a granted work folder turns the file and shell tools on inside it; plan mode, model, resume and the guide are flags", () => {
  const argv = CLI_ADAPTERS.claude_code.command({ ...BASE, workFolder: "/work/acme", planMode: true, model: "sonnet", resume: "sess-9", system: "You are Intake." });
  assert.equal(argv.includes("--tools"), false);
  assert.equal(after(argv, "--add-dir"), "/work/acme");
  const allowed = argv.slice(argv.indexOf("--allowedTools") + 1, argv.indexOf("--add-dir"));
  assert.deepEqual(allowed, ["mcp__vyre__*", "Read", "Edit", "Write", "Glob", "Grep", "Bash"]);
  assert.equal(after(argv, "--permission-mode"), "plan");
  assert.equal(after(argv, "--model"), "sonnet");
  assert.equal(after(argv, "--resume"), "sess-9");
  assert.equal(after(argv, "--append-system-prompt"), "You are Intake.");
});

test("claude: a user message is one JSON line on stdin", () => {
  const wire = CLI_ADAPTERS.claude_code.encode("hello\nthere");
  assert.ok(wire.endsWith("\n"));
  assert.deepEqual(JSON.parse(wire), { type: "user", message: { role: "user", content: [{ type: "text", text: "hello\nthere" }] } });
  assert.equal(wire.trimEnd().includes("\n"), false);
});

test("codex: exec --json, its own sandbox read-only unless a work folder was granted, Vyre's server by address and by the name of the token variable, the prompt on stdin", () => {
  const argv = CLI_ADAPTERS.codex.command(BASE);
  assert.deepEqual(argv.slice(0, 3), ["codex", "exec", "--json"]);
  assert.equal(argv.at(-1), "-");
  const overrides = argv.filter((_, i) => argv[i - 1] === "-c");
  assert.deepEqual(overrides, [
    'sandbox_mode="read-only"',
    'mcp_servers.vyre.url="http://127.0.0.1:4100/mcp"',
    `mcp_servers.vyre.bearer_token_env_var="${TOKEN_ENV}"`,
  ]);
  assert.equal(argv.includes("resume"), false);
  const folder = CLI_ADAPTERS.codex.command({ ...BASE, workFolder: "/work/acme" }).filter((_, i, a) => a[i - 1] === "-c")[0];
  assert.equal(folder, 'sandbox_mode="workspace-write"');
  const plan = CLI_ADAPTERS.codex.command({ ...BASE, workFolder: "/work/acme", planMode: true }).filter((_, i, a) => a[i - 1] === "-c")[0];
  assert.equal(plan, 'sandbox_mode="read-only"', "plan mode never writes");
});

test("codex: a later turn continues the thread with resume <id>, ahead of the prompt marker", () => {
  const argv = CLI_ADAPTERS.codex.command({ ...BASE, resume: "th_abc", model: "gpt-5-codex" });
  const at = argv.indexOf("resume");
  assert.deepEqual(argv.slice(at, at + 3), ["resume", "th_abc", "-"]);
  assert.equal(after(argv, "-m"), "gpt-5-codex");
  assert.equal(CLI_ADAPTERS.codex.encode("a\nb"), "a\nb");
});

test("grok: headless stream-json, resume by id, and the person's other MCP configs switched off", () => {
  const argv = CLI_ADAPTERS.grok.command({ ...BASE, resume: "g1", model: "grok-4" });
  assert.deepEqual(argv.slice(0, 4), ["grok", "-p", "--output-format", "stream-json"]);
  assert.equal(after(argv, "--resume"), "g1");
  assert.equal(after(argv, "-m"), "grok-4");
  assert.deepEqual(CLI_ADAPTERS.grok.env(), { GROK_CLAUDE_MCPS_ENABLED: "0", GROK_CURSOR_MCPS_ENABLED: "0" });
  assert.ok(argv.includes("--no-auto-update"));
});

test("no command line of any CLI can carry a token: the options have no field for one", () => {
  for (const id of ["claude_code", "codex", "grok"] as const) {
    const argv = CLI_ADAPTERS[id].command({ ...BASE, resume: "r", model: "m", workFolder: "/w", system: "s" });
    assert.equal(argv.some((a) => a.includes(SECRET)), false);
    assert.ok(argv.join(" ").includes(TOKEN_ENV), `${id} names the variable`);
  }
});

test("lines: a chunk may end mid-line or mid-character; blank lines are dropped; a last line without a newline still counts", async () => {
  const bytes = new TextEncoder().encode('{"a":"é"}\n\n{"b":2}\r\n{"c":3}');
  const cut = [bytes.slice(0, 7), bytes.slice(7, 11), bytes.slice(11, 20), bytes.slice(20)];
  const out: string[] = [];
  for await (const l of lines((async function* () { for (const c of cut) yield c; })())) out.push(l);
  assert.deepEqual(out, ['{"a":"é"}', '{"b":2}', '{"c":3}']);
});

test("channel: values come out in order; a wait gives up as idle after its time and as null when aborted", async () => {
  const ch = channel<number>();
  const ac = new AbortController();
  ch.push(1); ch.push(2);
  assert.equal(await ch.next(1000, ac.signal), 1);
  assert.equal(await ch.next(1000, ac.signal), 2);
  assert.equal(await ch.next(30, ac.signal), "idle");
  setTimeout(() => ch.push(3), 20);
  assert.equal(await ch.next(1000, ac.signal), 3, "a value that arrives while waiting wakes the wait");
  setTimeout(() => ac.abort(), 20);
  assert.equal(await ch.next(1000, ac.signal), null);
  ch.push(4);
  assert.equal(await ch.next(1000, ac.signal), 4, "values already queued are still delivered after an abort");
});

test("failures are named so the accounts module can move a turn to the backup key", () => {
  assert.equal(classifyCli("Invalid API key · Please run /login"), "provider.auth_failed");
  assert.equal(classifyCli("unexpected status 401 Unauthorized"), "provider.auth_failed");
  assert.equal(classifyCli("Claude AI usage limit reached|1760000000"), "provider.rate_limited");
  assert.equal(classifyCli("429 Too Many Requests"), "provider.rate_limited");
  assert.equal(classifyCli("Prompt is too long"), "provider.context_too_long");
  assert.equal(classifyCli("boom: the engine crashed"), "engine.cli_error");
});

test("prompt: a new engine session gets the recent thread; a resumed one only what happened since its own last reply", () => {
  const other = message("Can you check the intake form?", "m1", { author: { kind: "person", id: "per_sam" } });
  const mine = message("Checked it, it is fine.", "m2", { author: { kind: "agent", id: "agt_intake" } });
  const later = message("And the fax number?", "m3", { author: { kind: "person", id: "per_sam" } });
  const input = turnOf("Thanks", { history: [other, mine, later], trigger: message("Thanks", "m4") });
  assert.equal(defaultPrompt(input, true), "Earlier in this thread:\nper_sam: Can you check the intake form?\nagt_intake: Checked it, it is fine.\nper_sam: And the fax number?\n\nThanks");
  assert.equal(defaultPrompt(input, false), "Since your last reply:\nper_sam: And the fax number?\n\nThanks");
  assert.equal(defaultPrompt(turnOf("hi"), false), "hi");
  assert.equal(defaultPrompt(turnOf("hi", { trigger: null }), false), "(continue)");
  const steered = defaultPrompt(turnOf("hi"), false, [message("also this", "m9", { author: { kind: "person", id: "per_sam" } })]);
  assert.equal(steered, "per_sam: also this\n\nhi");
});
