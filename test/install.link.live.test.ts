// Install from a link, walked on a booted Team server (owner, 4 Nov 2026): the owner reads a GitHub link into a plan and installs it for themselves; a member reads the same link and is refused the whole Space;
// a local MCP server is stored for the sandbox and runs nowhere else; what is installed is the commit the plan was read at; and the owner takes it back. GitHub is a fake `git` that copies a fixture tree.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, hostLog, seededDir } from "./memory-live-kit.ts";
import { api, door, join, ok, standIn } from "./member-key-kit.ts";

const SKILL = "---\nname: pdf-forms\ndescription: Fill PDF forms from a record.\n---\n\nFill the form field by field.\n";

function fakeGithub(): { bin: string; fix: string; dispose(): void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-fakegh-"));
  const bin = path.join(root, "bin"), fix = path.join(root, "fix");
  fs.mkdirSync(bin); fs.mkdirSync(path.join(fix, "acme__pdf-skill"), { recursive: true }); fs.mkdirSync(path.join(fix, "acme__crm-mcp", "dist"), { recursive: true });
  fs.writeFileSync(path.join(fix, "acme__pdf-skill", "SKILL.md"), SKILL);
  fs.writeFileSync(path.join(fix, "acme__pdf-skill", "README.md"), "# pdf\n\nFills PDF forms from a record, field by field.\n");
  fs.writeFileSync(path.join(fix, "acme__crm-mcp", "package.json"), JSON.stringify({ name: "@acme/crm-mcp", description: "Read the CRM.", bin: { crm: "./dist/index.js" }, dependencies: { "@modelcontextprotocol/sdk": "1" } }));
  fs.writeFileSync(path.join(fix, "acme__crm-mcp", "README.md"), "# CRM MCP server\n\nAn MCP server for your CRM. Set CRM_API_KEY. It calls https://api.acme-crm.io only.\n");
  fs.writeFileSync(path.join(fix, "acme__crm-mcp", "dist", "index.js"), "console.log('x');\n");
  fs.writeFileSync(path.join(bin, "git"), `#!/bin/sh
case " $* " in
  *" clone "*) url=; dest=; for a; do url=$dest; dest=$a; done; name=$(echo "$url" | sed 's|https://github.com/||; s|/|__|'); [ -d "${fix}/$name" ] || exit 128; cp -R "${fix}/$name" "$dest" ;;
  *" rev-parse "*) echo 1111111111111111111111111111111111111111 ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
  return { bin, fix, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("install from a link on a booted server: a plan, the owner installs it, a member cannot choose the Space, a local MCP server stays in the sandbox, a moved branch changes nothing, and Remove takes it back", { timeout: 120_000 }, async () => {
  const gh = fakeGithub();
  const oldPath = process.env["PATH"];
  process.env["PATH"] = `${gh.bin}:${oldPath ?? ""}`;
  const dir = seededDir();
  const d = await boot(dir, standIn, undefined, { vault: undefined } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  try {
    await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 3).toString("base64") }) });
    const rubab = await join(d, "rubab");
    assert.equal((await door(d, rubab.token, "unlock", rubab.personKey)).status, 204);

    // the owner reads the link: a plan that says what it is, pinned to a commit
    const plan = (await ok(d, d.token, "install.from_link", { url: "https://github.com/acme/pdf-skill" })).plan;
    assert.deepEqual([plan.kind, plan.name, plan.commit], ["skill", "pdf-forms", "1111111111111111111111111111111111111111"]);
    assert.equal(plan.who.find((w: { key: string }) => w.key === "space").allowed, true);
    assert.equal((await ok(d, d.token, "install.get", { planId: plan.planId })).plan.state, "planned", "reading installed nothing");

    // a member reads the same link: the Space is not theirs to choose, and asking anyway is refused in words
    const mine = (await api(d, rubab.token, "install.from_link", { url: "https://github.com/acme/pdf-skill" })).data.plan;
    assert.equal(mine.who.find((w: { key: string }) => w.key === "space").allowed, false);
    const refused = await api(d, rubab.token, "install.apply", { planId: mine.planId, for: "space", idempotencyKey: "iw-space" });
    assert.equal(refused.status, 403, JSON.stringify(refused.data));
    assert.match(JSON.stringify(refused.data), /Only an admin can install something for everyone in the Space/);
    assert.equal((await ok(d, rubab.token, "install.list")).installs.length, 0);

    // the branch moves, then the owner approves: what lands is the commit that was read
    fs.writeFileSync(path.join(gh.fix, "acme__pdf-skill", "SKILL.md"), SKILL.replace("field by field", "something else"));
    const done = (await ok(d, d.token, "install.apply", { planId: plan.planId, for: "me" })).installed;
    assert.equal(typeof done.skillId, "string");
    const page = await ok(d, d.token, "skills.page");
    const skill = page.mine.find((s: { name: string }) => s.name === "pdf-forms");
    assert.ok(skill, "it is in the owner's skills");
    assert.match((await ok(d, d.token, "skills.view", { skillId: skill.skillId })).skill.text, /field by field/);
    assert.equal(skill.source, "github:acme/pdf-skill@1111111111111111111111111111111111111111");

    // a local MCP server: stored with its files for the sandbox, with the command, and nothing deployed
    const agentId = (await ok(d, d.token, "agents.create", { name: "Ops", role: "You help." })).agent.agentId as string;
    const mcp = (await ok(d, d.token, "install.from_link", { url: "https://github.com/acme/crm-mcp" })).plan;
    assert.deepEqual([mcp.kind, mcp.runs, mcp.needs.vaultKeys, mcp.needs.domains], ["mcp_local", { command: "node", args: ["dist/index.js"] }, ["CRM_API_KEY"], ["api.acme-crm.io"]]);
    const inst = (await ok(d, d.token, "install.apply", { planId: mcp.planId, for: "agent", agentId, runOn: "sandbox" })).installed;
    assert.equal(typeof inst.pluginId, "string");
    const plugin = (await ok(d, d.token, "plugins.list", { agentId })).plugins.find((p: { name: string }) => p.name === "crm-mcp");
    assert.ok(plugin, "registered with the plugin runtime");
    assert.equal(inst.siteId, undefined, "nothing was put on Sites");

    // the owner's list shows both; Remove takes the skill back
    const list = (await ok(d, d.token, "install.list")).installs as Array<{ installId: string; name: string }>;
    assert.deepEqual(list.map((i) => i.name).sort(), ["crm-mcp", "pdf-forms"]);
    await ok(d, d.token, "install.remove", { installId: list.find((i) => i.name === "pdf-forms")!.installId });
    assert.equal((await ok(d, d.token, "skills.page")).mine.some((s: { name: string }) => s.name === "pdf-forms"), false);
  } catch (e) { throw new Error(`${e instanceof Error ? e.message : String(e)}\n${hostLog(d).slice(-800)}`); }
  finally { process.env["PATH"] = oldPath; await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); gh.dispose(); }
});
