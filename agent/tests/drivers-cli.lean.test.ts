// The lean one-shot (SessionSpec.lean, a memory learning pass): each CLI runs its leanest command, with the job's own system prompt in place of the engine's and no tools, MCP server, settings,
// CLAUDE.md or AGENTS.md, skills, plugins or saved session. Measured against Claude Code 2.1.316 and codex-cli 0.166 with a recording endpoint, these flags leave about 400 and 480 tokens besides the
// prompt (12,000 and more without them); the flags are pinned here so a change to the command line cannot quietly bring the engines' own prompts back.
import test from "node:test";
import assert from "node:assert/strict";
import { CLI_ADAPTERS, createCliDriver } from "../src/drivers/cli/index.ts";
import type { CommandOptions } from "../src/drivers/cli/index.ts";
import { driverDeps, newSpy, specOf } from "../fixtures/golden-streams/rig.ts";

const SYSTEM = "You keep one person's private memory. Answer with one JSON object.";
// everything a chat session could carry, to show a lean call drops it
const FULL: CommandOptions = {
  model: "haiku", resume: "sess-9", mcpUrl: "http://127.0.0.1:4100/mcp", planMode: false, mode: "auto", effort: "high", workFolder: "/work/acme", system: SYSTEM,
  plugins: { dirs: ["/work/acme/.plugins/notes"], mcpServers: { notes: { command: "node", args: ["notes.js"], env: {} } }, secrets: {} } as never, lean: true,
};
const after = (argv: readonly string[], flag: string): string | undefined => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
const configs = (argv: readonly string[]): string[] => argv.flatMap((a, i) => (a === "-c" ? [argv[i + 1]!] : []));

test("claude lean: its own short system prompt, no tools, no MCP, no settings or CLAUDE.md, no skills, nothing saved, and the cheap model", () => {
  const argv = CLI_ADAPTERS.claude_code.command(FULL);
  assert.equal(argv[0], "claude");
  for (const f of ["-p", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"]) assert.ok(argv.includes(f), f);
  assert.equal(after(argv, "--system-prompt"), SYSTEM, "replaces Claude Code's own system prompt");
  assert.equal(after(argv, "--tools"), "", "no tools at all");
  assert.equal(after(argv, "--setting-sources"), "", "no user, project or local settings, so no CLAUDE.md");
  assert.equal(after(argv, "--model"), "haiku");
  assert.equal(after(argv, "--input-format"), "stream-json");
  for (const f of ["--append-system-prompt", "--mcp-config", "--allowedTools", "--add-dir", "--plugin-dir", "--resume", "--effort", "--bare"]) assert.equal(argv.includes(f), false, f);
});

test("codex lean: ephemeral, no user config, rules, AGENTS.md or skills, our instructions in place of Codex's, its tools off, no MCP server, the prompt on stdin", () => {
  const argv = CLI_ADAPTERS.codex.command(FULL);
  assert.deepEqual(argv.slice(0, 2), ["codex", "exec"]);
  for (const f of ["--json", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules"]) assert.ok(argv.includes(f), f);
  const c = configs(argv);
  assert.ok(c.includes(`instructions=${JSON.stringify(SYSTEM)}`), "our instructions replace Codex's own");
  for (const k of ["include_environment_context=false", "include_permissions_instructions=false", "include_apps_instructions=false", "include_collaboration_mode_instructions=false",
    "project_doc_max_bytes=0", 'web_search="disabled"', "skills.include_instructions=false", "skills.bundled.enabled=false", 'sandbox_mode="read-only"', 'approval_policy="never"']) assert.ok(c.includes(k), k);
  const disabled = argv.flatMap((a, i) => (a === "--disable" ? [argv[i + 1]!] : []));
  for (const f of ["shell_tool", "unified_exec", "multi_agent", "goals", "view_image", "apps", "plugins", "skill_search", "image_generation", "hooks"]) assert.ok(disabled.includes(f), f);
  assert.equal(c.some((k) => k.startsWith("mcp_servers.")), false, "no MCP server of Vyre's or a plugin's");
  for (const k of ["base_instructions", "model_instructions_file"]) assert.equal(c.some((x) => x.startsWith(k)), false, `${k}: ignored or needs a file on 0.166`);
  assert.equal(after(argv, "-m"), "haiku");
  assert.equal(argv.includes("resume"), false);
  assert.equal(argv.at(-1), "-");
});

test("a lean session spec runs the lean command: no MCP session is minted, no resume, no plugins, and the role is the system prompt", async () => {
  const spy = newSpy();
  let minted = 0;
  const driver = createCliDriver(CLI_ADAPTERS.claude_code, driverDeps(spy, {
    mcp: async () => { minted++; throw new Error("a lean call reaches nothing of Vyre"); },
    resume: () => "sess-old", system: () => "Vyre's long guide for this agent", workFolder: () => null,
    plugins: () => ({ dirs: ["/p"], mcpServers: {}, secrets: {} }) as never,
  }));
  const session = await driver.open({ ...specOf({ model: "haiku", role: SYSTEM }), tools: "none", lean: true });
  await session.close();
  const argv = spy.launches[0]!;
  assert.equal(minted, 0);
  assert.equal(after(argv, "--system-prompt"), SYSTEM, "the job's own prompt, not the agent's guide");
  assert.equal(argv.includes("--resume"), false);
  assert.equal(argv.includes("--plugin-dir"), false);
  assert.equal(after(argv, "--setting-sources"), "");
});
