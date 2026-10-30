// The plugin and skill formats against the shapes Claude Code documents (code.claude.com plugins-reference, plugin-marketplaces, skills).
import test from "node:test";
import assert from "node:assert/strict";
import { expandVars, inside, parseMarketplace, readPlugin, renderCommand } from "../plugin-format.ts";
import { parseSkill, skillText } from "../skill-md.ts";

test("SKILL.md: name and description from the front matter, block scalars, lists, and the folder name as a fallback", () => {
  const r = parseSkill("---\nname: deploy-checks\ndescription: >-\n  Run the checks\n  before a deploy.\nallowed-tools: Bash(git add *) Bash(git commit *)\n---\n\n# Steps\n1. go\n");
  assert.ok(r.ok);
  assert.equal(r.skill.name, "deploy-checks");
  assert.equal(r.skill.description, "Run the checks before a deploy.");
  assert.equal(r.skill.body, "# Steps\n1. go\n");
  assert.equal(r.skill.meta["allowed-tools"], "Bash(git add *) Bash(git commit *)");
  const f = parseSkill("---\ndescription: Only a description\n---\nbody", "from-folder");
  assert.ok(f.ok && f.skill.name === "from-folder");
  const none = parseSkill("Plain text with a first line\nand more", "plain");
  assert.ok(none.ok && none.skill.description === "Plain text with a first line");
  assert.ok(!parseSkill("---\nname: bad name!\ndescription: x\n---\n").ok);
  assert.ok(!parseSkill("x".repeat(100_001), "big").ok);
  const round = parseSkill(skillText("made-one", 'Says "hi"', "Do it."));
  assert.ok(round.ok && round.skill.description === 'Says "hi"' && round.skill.body === "Do it.\n");
});

test("marketplace.json: name, owner, plugins; relative, github, url, git-subdir, npm sources; a bad entry is skipped with a warning", () => {
  const r = parseMarketplace(JSON.stringify({
    name: "acme-tools", owner: { name: "Acme" }, description: "d",
    plugins: [
      { name: "a", source: "./plugins/a", description: "A" },
      { name: "b", source: { source: "github", repo: "acme/b", ref: "v1" } },
      { name: "c", source: { source: "git-subdir", url: "acme/mono", path: "tools/c" }, strict: false },
      { name: "d", source: { source: "npm", package: "@acme/d" } },
      { name: "e", source: "../escape" },
      { source: "./x" },
    ],
  }));
  assert.ok(r.ok);
  assert.deepEqual(r.marketplace.entries.map((e) => [e.name, e.source.kind]), [["a", "path"], ["b", "github"], ["c", "git"], ["d", "npm"]]);
  assert.equal(r.marketplace.entries[2]!.strict, false);
  assert.equal(r.marketplace.warnings.length, 2);
  assert.ok(!parseMarketplace('{"name":"x","plugins":[]}').ok, "no owner");
  assert.ok(!parseMarketplace("nope").ok);
});

test("paths in a manifest must start with ./ and stay inside the plugin", () => {
  assert.equal(inside("./commands/x.md"), "commands/x.md");
  assert.equal(inside("."), "");
  assert.equal(inside("commands/x.md"), null);
  assert.equal(inside("./../x"), null);
});

const plugin = {
  ".claude-plugin/plugin.json": JSON.stringify({
    name: "deploy-tools", version: "1.2.0", description: "Deploys",
    userConfig: { api_token: { type: "string", title: "Token", description: "API token", sensitive: true } },
    mcpServers: { inline: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/inline.js"] } },
  }),
  "skills/deploy/SKILL.md": "---\nname: deploy\ndescription: How to deploy.\n---\nRun the checks.\n",
  "skills/deploy/references/notes.md": "notes",
  "commands/status.md": "---\ndescription: Show status\nargument-hint: [env]\nallowed-tools: Bash(git status:*), Read\n---\nShow the status of $ARGUMENTS.\n",
  "commands/ops/restart.md": "Restart everything.\n",
  "agents/reviewer.md": "---\nname: reviewer\ndescription: Reviews diffs\ntools: Read, Grep\nmodel: sonnet\n---\nYou review.\n",
  "hooks/hooks.json": JSON.stringify({ hooks: { PostToolUse: [{ matcher: "Write|Edit", hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/fmt.sh", timeout: 5 }] }] } }),
  ".mcp.json": JSON.stringify({ mcpServers: { api: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server.js"], env: { TOKEN: "${user_config.api_token}" } }, remote: { type: "http", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer x" } } } }),
};

test("a plugin in the standard layout: skills, commands, agents, hooks, MCP servers, user config", () => {
  const p = readPlugin(plugin);
  assert.deepEqual(p.warnings, []);
  assert.equal(p.name, "deploy-tools");
  assert.deepEqual(p.skills.map((s) => [s.name, Object.keys(s.files)]), [["deploy", ["references/notes.md"]]]);
  assert.deepEqual(p.commands.map((c) => [c.name, c.description, c.argumentHint ?? null, c.allowedTools]), [["ops:restart", "Restart everything.", null, []], ["status", "Show status", "[env]", ["Bash(git status:*)", "Read"]]]);
  assert.deepEqual(p.agents.map((a) => [a.name, a.tools, a.model]), [["reviewer", ["Read", "Grep"], "sonnet"]]);
  assert.deepEqual(p.hooks.map((h) => [h.event, h.matcher, h.command, h.timeoutSec]), [["PostToolUse", "Write|Edit", "${CLAUDE_PLUGIN_ROOT}/fmt.sh", 5]]);
  assert.deepEqual(p.mcpServers.map((m) => [m.name, m.transport]).sort(), [["api", "stdio"], ["inline", "stdio"], ["remote", "http"]]);
  assert.deepEqual(p.userConfig.map((u) => [u.key, u.sensitive]), [["api_token", true]]);
});

test("a manifest can replace a default folder, define commands inline, and a marketplace entry can stand in for plugin.json", () => {
  const p = readPlugin({
    ".claude-plugin/plugin.json": JSON.stringify({ name: "x", commands: { about: { content: "Say what this is." }, run: { source: "./c/run.md", argumentHint: "[a]" } } }),
    "c/run.md": "Run $1", "commands/ignored.md": "no",
  });
  assert.deepEqual(p.commands.map((c) => c.name).sort(), ["about", "run"]);
  const e = parseMarketplace(JSON.stringify({ name: "m", owner: { name: "o" }, plugins: [{ name: "solo", source: "./solo", version: "2", mcpServers: { s: { command: "x" } }, commands: ["./cmds/"] }] }));
  assert.ok(e.ok);
  const q = readPlugin({ "cmds/hi.md": "Hi" }, e.marketplace.entries[0]!);
  assert.equal(q.name, "solo");
  assert.equal(q.version, "2");
  assert.deepEqual(q.commands.map((c) => c.name), ["hi"]);
  assert.deepEqual(q.mcpServers.map((m) => m.name), ["s"]);
  const bad = readPlugin({ ".claude-plugin/plugin.json": JSON.stringify({ name: "y", hooks: "./h.json", skills: ["../out"] }), "h.json": "{}" });
  assert.equal(bad.warnings.length, 2);
});

test("a command renders its arguments the way the open format says, and variables expand", () => {
  assert.equal(renderCommand("Do $ARGUMENTS now, then $2 and $ARGUMENTS[0].", "ship it"), "Do ship it now, then it and ship.");
  assert.equal(renderCommand("Just do it", "with care"), "Just do it\n\nARGUMENTS: with care\n");
  assert.equal(renderCommand("Plain", ""), "Plain");
  assert.equal(expandVars("${CLAUDE_PLUGIN_ROOT}/a ${user_config.k} ${nope}", { CLAUDE_PLUGIN_ROOT: "/p", "user_config.k": "v" }), "/p/a v ${nope}");
});
