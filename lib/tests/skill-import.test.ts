// lib/skill-import.ts: what a tree holds, what a skill can touch, when an update can touch more, links, and names for a newcomer (D27).
import test from "node:test";
import assert from "node:assert/strict";
import { classifyLink, originOf, permsGrowth, renamed, runsCode, skillPerms, skillsInTree, stripTop } from "../skill-import.ts";

const SKILL = (name: string, extra = "") => `---\nname: ${name}\ndescription: Does ${name}.\n${extra}---\n\nSteps.\n`;

test("every SKILL.md folder is a skill; a plugin's .mcp.json goes with each of its skills; nested skills stay apart", () => {
  const r = skillsInTree({
    ".claude-plugin/plugin.json": JSON.stringify({ name: "kit", version: "3.1.0" }), ".mcp.json": JSON.stringify({ mcpServers: { api: { url: "https://api.acme.com/mcp", headers: { Authorization: "Bearer ${ACME_KEY}" } } } }),
    "skills/a/SKILL.md": SKILL("a"), "skills/a/scripts/run.sh": "echo", "skills/a/inner/SKILL.md": SKILL("inner"), "skills/a/inner/x.md": "x",
  });
  assert.deepEqual(r.skills.map((s) => [s.name, s.kind, s.version, Object.keys(s.files).sort()]), [
    ["a", "plugin", "3.1.0", [".mcp.json", "scripts/run.sh"]],
    ["inner", "plugin", "3.1.0", [".mcp.json", "x.md"]],
  ]);
});

test("a wrapper folder is taken off, a hidden layout folder is not; a bad SKILL.md is a problem and the rest still come", () => {
  assert.deepEqual(Object.keys(stripTop({ "repo-main/SKILL.md": "x", "repo-main/a.md": "y" })), ["SKILL.md", "a.md"]);
  assert.deepEqual(Object.keys(stripTop({ ".codex/skills/a/SKILL.md": "x" })), [".codex/skills/a/SKILL.md"]);
  const r = skillsInTree({ "good/SKILL.md": SKILL("good"), "bad/SKILL.md": "---\nname: bad name!\n---\n" });
  assert.deepEqual(r.skills.map((s) => s.name), ["good"]);
  assert.match(r.problems[0]!, /bad\/SKILL\.md/);
});

test("what a skill can touch: scripts, servers and the keys they want, hosts, network tools, Vault keys; and when an update grew it", () => {
  const files = { "fill.py": "x", "notes.md": "y", ".mcp.json": JSON.stringify({ mcpServers: { db: { command: "uvx", args: ["db-mcp"], env: { DB_PASSWORD: "", REGION: "eu" } }, web: { url: "https://mcp.example.com/${TENANT}" } } }) };
  const p = skillPerms(SKILL("p", "allowed-tools: [WebFetch, Read]\n") + "Use #Firm_Stripe.key to bill.", files);
  assert.deepEqual(p.scripts, ["fill.py"]);
  assert.deepEqual(p.mcpServers.map((m) => [m.name, m.transport, m.keys]), [["db", "stdio", ["DB_PASSWORD"]], ["web", "http", ["TENANT"]]]);
  assert.deepEqual(p.network, ["WebFetch", "mcp.example.com", "uvx downloads"]);
  assert.deepEqual(p.vaultKeys, ["Firm_Stripe"]);
  assert.equal(runsCode(p), true);
  const plain = skillPerms(SKILL("plain"), { "notes.md": "y" });
  assert.equal(runsCode(plain), false);
  assert.deepEqual(permsGrowth(p, p), []);
  assert.deepEqual(permsGrowth(p, plain), [], "less is not growth");
  assert.deepEqual(permsGrowth(plain, p).length, 5);
});

test("links: a GitHub repo, a folder, a blob file, a short owner/repo, a raw address; http and others are refused", () => {
  assert.deepEqual(classifyLink("https://github.com/anthropics/skills"), { kind: "github", owner: "anthropics", repo: "skills" });
  assert.deepEqual(classifyLink("https://github.com/anthropics/skills/tree/main/document-skills/pdf"), { kind: "github", owner: "anthropics", repo: "skills", ref: "main", path: "document-skills/pdf" });
  assert.deepEqual(classifyLink("https://github.com/a/b/blob/main/x/SKILL.md"), { kind: "raw", url: "https://raw.githubusercontent.com/a/b/main/x/SKILL.md" });
  assert.deepEqual(classifyLink("acme/skills"), { kind: "github", owner: "acme", repo: "skills" });
  assert.deepEqual(classifyLink("https://example.com/s/SKILL.md"), { kind: "raw", url: "https://example.com/s/SKILL.md" });
  assert.equal(classifyLink("http://example.com/SKILL.md"), null);
  assert.equal(classifyLink("not a link"), null);
});

test("D27 names: the newcomer carries its source in front, and the words say where it came from", () => {
  assert.equal(originOf("github:acme/skills@main/pdf"), "acme/skills");
  assert.equal(originOf("link:https://example.com/x/SKILL.md"), "example.com");
  assert.equal(originOf("upload", { tier: "space" }), "this Space");
  assert.equal(originOf("upload", { sharer: "Dana" }), "Dana");
  assert.deepEqual(renamed("pdf", "acme/skills", new Set(["pdf"])), { name: "acme-skills:pdf", label: "pdf (from acme/skills)" });
  assert.deepEqual(renamed("pdf", "acme/skills", new Set(["pdf", "acme-skills:pdf"])).name, "acme-skills2:pdf");
});
