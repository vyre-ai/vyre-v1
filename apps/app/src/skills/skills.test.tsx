// The Skills page (owner ruling 3 Nov): the lists drawn from skills.page, the card's words, what a member may and may not do with a Space skill, the Console view, and the setup steps.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SkillSheet, SkillsLists, AddSheet } from "./SkillsView.tsx";
import type { ListsProps } from "./SkillsView.tsx";
import { cardLead, skillsOfAgent, touchLines, usedByLine } from "./model.ts";
import { checkServer, fileSkillKey } from "./actions.ts";
import { AGENTS, SAMPLE_MEMBERS, samplePage } from "./sample.ts";

const text = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const noop = (): void => undefined;
const lists = (o: Partial<ListsProps> = {}): string => text(renderToStaticMarkup(<SkillsLists mode="settings" page={samplePage()} nameOf={(id) => id} onCard={noop} onView={noop} onOpen={noop} onToggle={noop} onAdd={noop} onAdopt={noop} onPolicy={noop} {...o} />));

test("Settings: cards wait at the top with who shared it, what it does, what it can touch, its source; then Mine, From your Space, Built in and Your agents", () => {
  const t = lists();
  const order = ["Waiting for you", "Mine", "From your Space", "Built in", "Your agents"].map((h) => t.indexOf(h));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "sections in order");
  assert.ok(order.every((i) => i >= 0));
  assert.match(t, /Maya Chen shared this with you/);
  assert.match(t, /Runs 2 scripts: scripts\/fill_form\.py, scripts\/merge\.py/);
  assert.match(t, /From anthropics\/skills, version 1\.4\.0/);
  assert.match(t, /Add to my skills .*Not now .*View/);
  assert.match(t, /Leo Park updated it\. It now starts a new tool server: hubspot; reaches mcp\.hubspot\.com\. Add it again/);
  assert.match(t, /pdf \(from acme\/skills\)/, "a renamed skill shows where it came from");
  assert.match(t, /You and Intake/);
  assert.match(t, /Needs a key/);
  assert.match(t, /Shared with everyone here/);
  assert.match(t, /court-brief .*Shared by Maya Chen/);
  assert.match(t, /house-style .*Set by an admin for everyone .*For everyone/);
  assert.match(t, /Intake .*intake-triage, notion-notes, court-brief, house-style/);
});

test("a member sees a Space skill and cannot remove it; in Console the admin can", () => {
  const page = samplePage();
  const sheet = (mode: "settings" | "console"): string => text(renderToStaticMarkup(<SkillSheet mode={mode} kind="space" skill={page.space[0]!} agents={AGENTS} health={{}} people={[]} nameOf={(x) => x}
    onClose={noop} onAgents={noop} onShare={noop} onKey={noop} onTest={noop} onUpdate={noop} onRemove={noop} onView={noop} />));
  const member = sheet("settings");
  assert.match(member, /only an admin can remove it/);
  assert.doesNotMatch(member, /\bRemove\b/);
  assert.match(sheet("console"), /\bRemove\b/);
  assert.match(sheet("console"), /Update/, "a Space skill from a link can be updated");
});

test("a skill's sheet: its tool server waits for a key with Add to Vault, Used by lists the agents, and Share opens", () => {
  const page = samplePage();
  const t = text(renderToStaticMarkup(<SkillSheet mode="settings" kind="mine" skill={page.mine[1]!} agents={AGENTS} health={{}} people={[{ id: "usr_maya", name: "Maya Chen" }]} nameOf={(x) => x}
    onClose={noop} onAgents={noop} onShare={noop} onKey={noop} onTest={noop} onUpdate={noop} onRemove={noop} onView={noop} />));
  assert.match(t, /Starts the notion tool server \(npx -y @notionhq\/notion-mcp-server\), which wants NOTION_TOKEN/);
  assert.match(t, /notion Needs NOTION_TOKEN/);
  assert.match(t, /NOTION_TOKEN .*Add to Vault/);
  assert.match(t, /Used by All my agents Intake Billing/);
  assert.match(t, /Sharing Only you Share/);
  assert.match(t, /Update/);
  const working = text(renderToStaticMarkup(<SkillSheet mode="settings" kind="mine" skill={{ ...page.mine[1]!, needs: [], setup: { "notion.NOTION_TOKEN": "#notion_notes_NOTION_TOKEN.value" } }} agents={AGENTS} health={{ notion: { state: "working", tools: 14 } }} people={[]} nameOf={(x) => x}
    onClose={noop} onAgents={noop} onShare={noop} onKey={noop} onTest={noop} onUpdate={noop} onRemove={noop} onView={noop} />));
  assert.match(working, /notion Working · 14 tools .*Test/);
});

test("Console: Space-wide skills, the scripts rule off by default, members' skills by name with Make Space-wide on shared ones", () => {
  const t = lists({ mode: "console", page: samplePage({ admin: true }), members: SAMPLE_MEMBERS });
  assert.match(t, /Space-wide skills apply to every member and their agents at once, with no card/);
  assert.doesNotMatch(t, /Add a Space skill/, "the button sits in the Installed for the Space header");
  assert.match(t, /Only admins add skills that run scripts or start tool servers/);
  assert.match(t, /aria-checked="false"|Off by default/);
  assert.match(t, /pdf Maya Chen · Shared Make Space-wide/);
  assert.match(t, /my-drafts Leo Park(?! · Shared)/);
  assert.equal((t.match(/Make Space-wide/g) ?? []).length, 2, "only shared ones");
  assert.doesNotMatch(t, /Waiting for you/);
});

test("the Add sheet: four ways in, then a review that says what each found skill can touch and the name it will take", () => {
  const ways = text(renderToStaticMarkup(<AddSheet mode="settings" found={null} browse={[]} canAsk onClose={noop} onLink={noop} onZip={noop} onFolder={noop} onBrowse={noop} onAsk={noop} onAdd={noop} onBack={noop} />));
  assert.match(ways, /Paste a link .*Folder or zip .*Marketplace .*Ask the Assistant/);
  const review = text(renderToStaticMarkup(<AddSheet mode="settings" browse={[]} canAsk onClose={noop} onLink={noop} onZip={noop} onFolder={noop} onBrowse={noop} onAsk={noop} onAdd={noop} onBack={noop}
    found={{ problems: [], skipped: ["logo.png"], skills: [{ name: "pdf", description: "PDFs.", text: "", files: { "scripts/fill.py": "" }, path: "", source: "zip", kind: "codex", perms: { scripts: ["scripts/fill.py"], mcpServers: [], network: [], vaultKeys: [] }, taken: "pdf (from a zip)" }] }} />));
  assert.match(review, /Add this skill\?/);
  assert.match(review, /You already have a skill called pdf\. This one will be pdf \(from a zip\)/);
  assert.match(review, /Runs a script: scripts\/fill\.py/);
  assert.match(review, /Codex skill/);
  assert.match(review, /Left out \(not text\): logo\.png/);
  assert.match(review, /Add to my skills/);
});

test("the words: what it can touch, who uses it, the card's lead, and which skills each agent sees", () => {
  assert.deepEqual(touchLines({ scripts: [], mcpServers: [], network: [], vaultKeys: [] }), ["Nothing outside its own text"]);
  assert.equal(usedByLine(["*"], AGENTS), "You and all your agents");
  assert.equal(usedByLine([], AGENTS), "Only you");
  const p = samplePage();
  assert.equal(cardLead(p.waiting[0]!), "Maya Chen shared this with you");
  assert.deepEqual(skillsOfAgent(p, "agt_billing"), ["notion-notes", "court-brief", "house-style"]);
});

test("Add to Vault: the key goes to the Vault only and the skill keeps the handle; the health check asks the skill's server for its tools", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push([cap, input as Record<string, unknown>]);
    // the Space's Skills folder, shared with everyone (lib/space-folder.ts finds a Space-wide key's folder by its name)
    if (cap === "vault.folders.list") return { folders: [{ id: "fld_mine", name: "Mine", scope: "mine" }, { id: "fld_shared", name: "Skills", scope: "shared" }] };
    if (cap === "engine.mcp.tools") return { servers: [{ key: "skill:sko_notion/notion", ok: true, tools: [{}, {}, {}] }] };
    return {};
  };
  const handle = await fileSkillKey(call, { skill: "notion-notes", skillId: "sko_notion", need: "notion.NOTION_TOKEN", value: "secret_123", space: false });
  assert.equal(handle, "#notion_notes_NOTION_TOKEN.value");
  const put = calls.find(([c]) => c === "vault.item.put")![1];
  assert.equal(put["folderId"], "fld_mine");
  const set = calls.find(([c]) => c === "skills.mine.set")![1];
  assert.deepEqual(set["setup"], { "notion.NOTION_TOKEN": "#notion_notes_NOTION_TOKEN.value" });
  assert.ok(!calls.filter(([c]) => c !== "vault.item.put").some(([, i]) => JSON.stringify(i).includes("secret_123")), "the value goes nowhere but the Vault");
  calls.length = 0;
  await fileSkillKey(call, { skill: "house-style", skillId: "skl_house", need: "api.KEY", value: "v", space: true });
  assert.equal(calls.find(([c]) => c === "vault.item.put")![1]["folderId"], "fld_shared", "a Space skill's key is in a Shared folder, so every member's call can fill it");
  assert.ok(calls.some(([c]) => c === "skills.space.setup"));
  assert.deepEqual(await checkServer(call, { skillId: "sko_notion", server: "notion", agentId: "agt_intake" }), { state: "working", tools: 3 });
  assert.deepEqual(calls.at(-1), ["engine.mcp.tools", { agentId: "agt_intake", server: "skill:sko_notion/notion" }]);
  const down = async (): Promise<unknown> => ({ servers: [{ ok: false, error: "spawn npx ENOENT", tools: [] }] });
  assert.deepEqual(await checkServer(down, { skillId: "s", server: "x", agentId: "a" }), { state: "down", error: "spawn npx ENOENT" });
  assert.equal((await checkServer(down, { skillId: "s", server: "x", agentId: undefined })).state, "down");
});

test("the built-in list leaves out the focus- skills (how an agent is told which place it is in); the rest stay", async () => {
  const { shownToPeople } = await import("./SkillsView.tsx");
  for (const n of ["focus-records", "focus-vault", "focus-onboarding-team", "focus-console"]) assert.equal(shownToPeople(n), false, n);
  for (const n of ["about-vyre", "forms", "sites", "working-on-goals", "installing-skills"]) assert.equal(shownToPeople(n), true, n);
  const page = samplePage();
  const withFocus = { ...page, builtin: [...page.builtin, { name: "focus-records", description: "Work in Records." }] };
  const t = lists({ page: withFocus });
  assert.ok(!/Focus records/i.test(t), "no Focus row is drawn");
});
