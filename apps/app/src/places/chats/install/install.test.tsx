// The install card, the update card and the Skills list (prototype r-install): what the held card says for each kind and who may pick the Space, Install calling install.apply with the right choices, the
// quiet lines, the diff on See changes, and the Skills list's Share and History. The capabilities are answered by a stand-in that records what it was asked.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { InstallCard, blockOf } from "./InstallCard.tsx";
import { SkillsTab, groupsOf } from "./SkillsTab.tsx";
import { changedCount, choices, diffRows, doneLine, needsLines, newAccess, pinnedLine, skillLine, sourceWords } from "./model.ts";
import type { Plan } from "./model.ts";

const PLAN = (o: Partial<Plan> = {}): Plan => ({
  planId: "ins_1", state: "planned", kind: "skill", name: "pdf-tools", summary: "Reads, splits and fills in PDF forms for your agents.", repo: "acme/pdf-tools", commit: "a41f9c2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", url: "https://github.com/acme/pdf-tools",
  needs: { domains: ["api.example.com"], vaultKeys: [], files: [] }, skills: ["pdf-tools"], problems: [],
  who: [{ key: "me", label: "Just you", allowed: true }, { key: "agent", label: "This agent", allowed: true }, { key: "space", label: "Everyone in the Space", allowed: true, adminOnly: true }], ...o,
});
function world(plan: Plan, fail?: string) {
  const calls: Array<{ cap: string; input: Record<string, any> }> = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, any> });
    if (cap === "install.get") return { plan };
    if (cap === "install.apply") { if (fail) throw new Error(fail); return { installed: { kind: plan.kind } }; }
    throw new Error(`no ${cap}`);
  };
  return { calls, call };
}
async function card(plan: Plan, data: Record<string, unknown> = {}, fail?: string, agentId?: string) {
  installDom();
  const w = world(plan, fail);
  const root = await mount(createRoot as never, <InstallCard id="m1" data={{ planId: plan.planId, name: plan.name, kind: plan.kind, ...data }} chat={{ call: w.call as never, ...(agentId ? { agentId } : {}), openSkills: () => undefined }} />);
  await flush(); await flush();
  return { root: root!, ...w };
}

test("the words: kinds, needs, the pinned commit, the choices, the done line", () => {
  assert.deepEqual(needsLines(PLAN()), { network: "api.example.com", vault: "none", files: "none" });
  assert.deepEqual(pinnedLine(PLAN()), { label: "Pinned to", value: "a41f9c2" });
  assert.deepEqual(pinnedLine(PLAN({ commit: "", kind: "mcp_remote" })), { label: "Version", value: "Not pinned. It is their server." });
  assert.deepEqual(choices(PLAN({ who: [{ key: "me", label: "Just you", allowed: true }, { key: "space", label: "Everyone in the Space", allowed: false, adminOnly: true }] })).map((c) => [c.key, c.allowed]), [["me", true], ["space", false]]);
  assert.equal(doneLine("pdf-tools", "me"), "Installed pdf-tools for you");
  assert.equal(doneLine("sql-reader", "agent", "space"), "Installed sql-reader for this agent · runs on the Space");
  assert.equal(doneLine("sql-reader", "agent", "sandbox"), "Installed sql-reader for this agent · runs in your agent's sandbox");
  assert.deepEqual(newAccess({ domains: ["a.io", "cdn.example.com"], vaultKeys: [], files: [] }, { domains: ["a.io"], vaultKeys: [], files: [] }), ["cdn.example.com"]);
  assert.equal(skillLine({ version: "1.2.0", source: "github:acme/pdf-tools@a41f9c2/skills" }), "v1.2.0 · acme/pdf-tools");
  assert.equal(sourceWords("agent"), "Written by its agent");
  assert.equal(blockOf({ name: "x" }), null);
});

test("a skill card says what it is, what it does, what it needs, the exact commit and who gets it", async () => {
  const c = await card(PLAN());
  const t = textOf(find(c.root, "install-m1")!);
  assert.match(t, /Install pdf-tools \(a skill\)/);
  assert.match(t, /Reads, splits and fills in PDF forms for your agents\./);
  assert.match(textOf(find(c.root, "install-needs-m1")!), /Network: api\.example\.com[\s\S]*Vault: none/);
  assert.match(textOf(find(c.root, "install-pin-m1")!), /Pinned to.*a41f9c2/);
  for (const k of ["me", "agent", "space"]) assert.ok(find(c.root, `install-for-${k}-m1`), `For ${k}`);
  assert.deepEqual(c.calls.map((x) => x.cap), ["install.get"], "reading the card installs nothing");
});

test("Install sends the plan with who gets it, then the card becomes one quiet line with Open", async () => {
  const c = await card(PLAN(), {}, undefined, "agt_intake");
  await press(find(c.root, "install-for-agent-m1")!);
  await press(find(c.root, "install-go-m1")!);
  await flush();
  const apply = c.calls.find((x) => x.cap === "install.apply")!;
  assert.deepEqual([apply.input["planId"], apply.input["for"], apply.input["agentId"]], ["ins_1", "agent", "agt_intake"]);
  assert.match(textOf(find(c.root, "install-done-m1")!), /Installed pdf-tools for this agent/);
  assert.ok(find(c.root, "install-open-m1"));
});

test("a member is not offered the whole Space; an admin is", async () => {
  const member = await card(PLAN({ who: [{ key: "me", label: "Just you", allowed: true }, { key: "agent", label: "This agent", allowed: true }, { key: "space", label: "Everyone in the Space", allowed: false, adminOnly: true }] }));
  assert.equal(find(member.root, "install-for-space-m1"), null);
  assert.ok(find((await card(PLAN())).root, "install-for-space-m1"));
});

test("Edit renames what agents see and Install uses it; Not now says nothing was added and Undo brings the card back", async () => {
  const c = await card(PLAN());
  await press(find(c.root, "install-edit-m1")!);
  assert.ok(find(c.root, "install-name-m1"));
  await press(find(c.root, "install-name-save-m1")!);
  await press(find(c.root, "install-no-m1")!);
  assert.match(textOf(find(c.root, "install-declined-m1")!), /Did not install pdf-tools\. Nothing was added\./);
  assert.equal(c.calls.some((x) => x.cap === "install.apply"), false);
  await press(find(c.root, "install-undo-m1")!);
  assert.ok(find(c.root, "install-m1"));
});

test("a local MCP server asks where it runs; Run it on the Space needs a Vault key before Install works", async () => {
  const plan = PLAN({ kind: "mcp_local", name: "sql-reader", commit: "c90e5a3bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", needs: { domains: [], vaultKeys: ["DATABASE_URL"], files: ["A copy of the repository, in the sandbox"] }, runs: { command: "node", args: ["server.js"] },
    runOn: [{ key: "sandbox", label: "On your computer, in the sandbox" }, { key: "space", label: "Run it on the Space", needs: "A Vault key to protect it" }] });
  const c = await card(plan);
  assert.match(textOf(find(c.root, "install-m1")!), /Run on my agent's computer/);
  await press(find(c.root, "install-run-space-m1")!);
  assert.ok(find(c.root, "install-key-m1"), "the key field appears");
  await press(find(c.root, "install-go-m1")!);
  assert.equal(c.calls.some((x) => x.cap === "install.apply"), false, "no key, no install");
});

test("a remote MCP server says it is not pinned; a refused install shows the reason and keeps the card", async () => {
  const remote = await card(PLAN({ kind: "mcp_remote", commit: "", name: "tasks-mcp", needs: { domains: ["mcp.tasks.example"], vaultKeys: [], files: [] } }));
  assert.match(textOf(find(remote.root, "install-pin-m1")!), /Not pinned\. It is their server\./);
  const refused = await card(PLAN(), {}, "Only an admin can install something for everyone in the Space");
  await press(find(refused.root, "install-for-space-m1")!);
  await press(find(refused.root, "install-go-m1")!);
  await flush();
  assert.match(textOf(find(refused.root, "install-line-m1")!), /Only an admin can install something for everyone in the Space\./);
  assert.ok(find(refused.root, "install-m1"), "the card stays");
});

test("an update is one quiet line; See changes shows the diff; Update applies it", async () => {
  const diff = { from: "a41f9c2aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", to: "7d03be8bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", added: ["tools.json"], removed: [], changed: [{ path: "SKILL.md", plus: ["Splits a PDF into single pages or page ranges."], minus: ["Splits a PDF into single pages."] }] };
  const c = await card(PLAN({ diff, commit: "7d03be8bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }), { update: true, installId: "ins_0" });
  assert.match(textOf(find(c.root, "install-update-m1")!), /pdf-tools has an update/);
  assert.equal(find(c.root, "install-diff-m1"), null, "the diff waits");
  await press(find(c.root, "install-diff-toggle-m1")!);
  const t = textOf(find(c.root, "install-diff-m1")!);
  assert.match(t, /pdf-tools a41f9c2 to 7d03be8/);
  assert.match(t, /2 files changed/);
  assert.match(t, /- Splits a PDF into single pages\./);
  assert.match(t, /\+ Splits a PDF into single pages or page ranges\./);
  assert.deepEqual([changedCount(diff), diffRows(diff).map((r) => r.kind)], [2, ["head", "del", "add", "head"]]);
  await press(find(c.root, "install-update-go-m1")!);
  await flush();
  assert.ok(c.calls.some((x) => x.cap === "install.apply"));
  assert.match(textOf(find(c.root, "install-done-m1")!), /Updated pdf-tools to 7d03be8/);
});

function skills(extra: Record<string, unknown> = {}) {
  installDom();
  const calls: Array<{ cap: string; input: Record<string, any> }> = [];
  const held = new Map<string, string>();
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as Record<string, any>;
    calls.push({ cap, input: i });
    switch (cap) {
      case "skills.page": return { mine: [{ skillId: "sko_1", name: "pdf-tools", description: "", source: "github:acme/pdf-tools@a41f9c2", origin: "acme/pdf-tools", version: "1.2.0", agents: ["*"], enabled: true, perms: {}, setup: {}, needs: [], sharedWith: [], updatedAt: 1 }], shared: [{ skillId: "sko_9", name: "Brand voice", sharer: "usr_sara", sharerName: "Sara Malik", description: "", toSpace: false, source: "", origin: "", perms: {}, state: "added", growth: [], agents: [], enabled: true, setup: {}, needs: [], updatedAt: 1 }], waiting: [], space: [], builtin: [], agents: [{ agentId: "agt_mira", name: "Mira" }], policy: { scriptsAdminOnly: false }, admin: false, me: "usr_irfad", ...extra };
      case "skills.of_agents": return { skills: [{ skillId: "sko_5", name: "Write a brief", description: "", agentId: "agt_mira", agentName: "Mira", version: "1.4", source: "agent", rev: 2, updatedAt: 1 }] };
      case "skills.history": return { revisions: [{ rev: 2, by: "usr_irfad", authorKind: "person", summary: "updated to 7d03be8", at: Date.UTC(2025, 10, 4) }, { rev: 1, by: "usr_irfad", authorKind: "person", summary: "created", at: Date.UTC(2025, 9, 20) }] };
      case "skills.grants": return { owner: "usr_irfad", ownerKind: "person", grants: [...held].map(([agentId, level]) => ({ agentId, level, by: "usr_irfad", at: 1 })) };
      case "skills.grant": if (i["level"] === null) held.delete(i["agentId"]); else held.set(i["agentId"], i["level"]); return { grants: [...held].map(([agentId, level]) => ({ agentId, level, by: "usr_irfad", at: 1 })) };
      default: throw new Error(`no ${cap}`);
    }
  };
  const notes: string[] = [];
  return { calls, notes, deps: { call: call as never, note: (t: string) => void notes.push(t) } };
}

test("the Skills list groups Yours, Your agents' and Shared with you, each with its line", async () => {
  const s = skills();
  const root = await mount(createRoot as never, <SkillsTab deps={s.deps} nameOf={(id) => ({ usr_irfad: "Irfad Imtiaz" } as Record<string, string>)[id] ?? id} />);
  await flush(); await flush();
  const all = textOf(find(root!, "skills-list")!);
  assert.ok(all.indexOf("Yours") < all.indexOf("Your agents'") && all.indexOf("Your agents'") < all.indexOf("Shared with you"));
  assert.match(textOf(find(root!, "skill-row-sko_1")!), /pdf-tools[\s\S]*v1\.2\.0 · acme\/pdf-tools/);
  assert.match(textOf(find(root!, "skill-row-sko_5")!), /Write a brief[\s\S]*Mira keeps it/);
  assert.match(textOf(find(root!, "skill-row-sko_9")!), /Shared by Sara Malik/);
  assert.equal(find(root!, "skill-share-sko_9"), null, "a skill shared with you is not yours to share on");
  assert.deepEqual(groupsOf({ mine: [], shared: [], me: "x" } as never, [], (i) => i), []);
});

test("History shows the versions with who and when; Share gives an agent a level and takes it back", async () => {
  const s = skills();
  const root = await mount(createRoot as never, <SkillsTab deps={s.deps} />);
  await flush(); await flush();
  await press(find(root!, "skill-history-sko_1")!);
  assert.match(textOf(find(root!, "skill-hist-sko_1")!), /v2 · Nov 4 · updated to 7d03be8[\s\S]*v1 · Oct 20 · created/);
  await press(find(root!, "skill-share-sko_1")!);
  await flush();
  await press(find(root!, "skill-grant-sko_1-agt_mira-edit")!);
  await flush();
  assert.deepEqual(s.calls.filter((c) => c.cap === "skills.grant").map((c) => [c.input["skillId"], c.input["agentId"], c.input["level"]]), [["sko_1", "agt_mira", "edit"]]);
  await press(find(root!, "skill-grant-sko_1-agt_mira-edit")!);
  await flush();
  assert.equal(s.calls.filter((c) => c.cap === "skills.grant").at(-1)!.input["level"], null, "pressing the level again takes it back");
});

test("no skills yet says how to get one", async () => {
  const s = skills({ mine: [], shared: [] });
  const root = await mount(createRoot as never, <SkillsTab deps={{ ...s.deps, call: (async (cap: string) => (cap === "skills.of_agents" ? { skills: [] } : { mine: [], shared: [], agents: [], me: "x" })) as never }} />);
  await flush(); await flush();
  assert.match(textOf(find(root!, "skills-empty")!), /Give the Assistant a GitHub link/);
});
