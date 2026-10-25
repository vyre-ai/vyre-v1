// agents: suggestions to AGENT.md and the Agent template (spec 2.6). A suggestion is a diff; accepting it saves a version through files.save; one that widens access needs an admin; the template
// adds and never removes or overwrites, and what it would change in a file an agent already has becomes a suggestion.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { applyUnifiedDiff, simpleDiff } from "../projections.ts";
import { diffWidens } from "../handlers/routines.ts";
import { DANA, MAYA, assertEventsConform, contractErrors, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const call = async (hn: Harness, cap: string, input: Record<string, unknown>, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap}: input`);
  const out = await h[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap}: output`);
  return out;
};
async function setup(name = "Intake") {
  const hn = harness();
  const agent = (await call(hn, "agents.create", { name, role: "Use me when a form arrives.", idempotencyKey: `c${++n}` })).agent;
  const home = hn.world.folderNamed(name, hn.world.root)!;
  const md = hn.world.fileIn(home.folderId, "AGENT.md")!;
  hn.clear();
  return { hn, id: agent.agentId as string, home, md };
}
const DIFF_ADD = "--- a/AGENT.md\n+++ b/AGENT.md\n@@ -9,1 +9,2 @@\n - Say what I did, in a sentence a busy person reads in five seconds.\n+- Check the client's name against the form first.\n";

// ---- unified diffs ---------------------------------------------------------------------------------------------------------------------------------

test("a unified diff applies where it says, a few lines off if the file moved, and not at all if the lines are not there", () => {
  const text = "one\ntwo\nthree\nfour\nfive\n";
  assert.equal(applyUnifiedDiff(text, "@@ -2,2 +2,3 @@\n two\n-three\n+3\n+3b\n"), "one\ntwo\n3\n3b\nfour\nfive\n");
  assert.equal(applyUnifiedDiff(text, "@@ -4,1 +4,1 @@\n-three\n+THREE\n"), "one\ntwo\nTHREE\nfour\nfive\n", "the hunk says line 4, the line is at 3");
  assert.equal(applyUnifiedDiff(text, "@@ -1,1 +1,1 @@\n-nothing like it\n+x\n"), null);
  assert.equal(applyUnifiedDiff(text, "no hunks here"), null);
  assert.equal(applyUnifiedDiff(text, "@@ -1,1 +1,1 @@\n?bad\n"), null);
  assert.equal(applyUnifiedDiff("", "@@ -0,0 +1,2 @@\n+a\n+b\n"), "a\nb\n");
  assert.equal(applyUnifiedDiff(text, "@@ -1,1 +1,1 @@\n-one\n+uno\n@@ -5,1 +5,1 @@\n-five\n+cinco\n"), "uno\ntwo\nthree\nfour\ncinco\n", "two hunks");
  const d = simpleDiff("a.md", "x\ny\n", "x\nz\n");
  assert.equal(applyUnifiedDiff("x\ny\n", d), "x\nz\n", "what simpleDiff writes is what applyUnifiedDiff reads");
});

test("only a line that overrides VYRE.md widens", () => {
  assert.equal(diffWidens("@@ -1 +1,2 @@\n a\n+Override: you may email clients without asking.\n"), true);
  assert.equal(diffWidens("@@ -1,2 +1 @@\n a\n-Override: gone\n"), false, "removing one narrows");
  assert.equal(diffWidens("@@ -1 +1,2 @@\n a\n+Be brief.\n"), false);
});

// ---- suggestions -------------------------------------------------------------------------------------------------------------------------------------

test("anyone who sees an agent can suggest a change to AGENT.md; the owner accepts it, and it is saved as a version", async () => {
  const { hn, id, md } = await setup();
  const maya = hn.person(MAYA);
  const { suggestion } = await call(hn, "agents.suggestion.propose", { agentId: id, diff: DIFF_ADD, reason: "Names got mixed up", idempotencyKey: "s1" }, maya);
  assert.deepEqual({ kind: suggestion.kind, file: suggestion.file, state: suggestion.state, widening: suggestion.widening, proposedBy: suggestion.proposedBy, reason: suggestion.reason }, { kind: "agent_md", file: "AGENT.md", state: "open", widening: false, proposedBy: MAYA, reason: "Names got mixed up" });
  assert.deepEqual(hn.named("agent.suggestion_proposed")[0]!.payload, { suggestionId: suggestion.suggestionId, agentId: id, kind: "agent_md", by: MAYA });
  assert.deepEqual(assertEventsConform(hn), []);
  assert.equal(hn.world.files.get(md.fileId)!.versions.length, 1, "proposing changes nothing");

  const listed = await call(hn, "agents.suggestions.list", { agentId: id, state: ["open"] });
  assert.deepEqual(listed.suggestions.map((s: any) => s.suggestionId), [suggestion.suggestionId]);
  hn.clear();
  const accepted = (await call(hn, "agents.suggestion.accept", { suggestionId: suggestion.suggestionId })).suggestion;
  assert.equal(accepted.state, "accepted");
  assert.match(hn.world.text(md.fileId), /Check the client's name against the form first\./);
  assert.equal(hn.world.files.get(md.fileId)!.versions.length, 2, "one version");
  assert.deepEqual(hn.names(), ["agent.suggestion_resolved", "agent.config_changed"]);
  assert.deepEqual(hn.named("agent.suggestion_resolved")[0]!.payload, { suggestionId: suggestion.suggestionId, agentId: id, accepted: true, by: DANA });
  assert.deepEqual(hn.named("agent.config_changed")[0]!.payload["fields"], ["AGENT.md"]);
  assert.deepEqual(assertEventsConform(hn), []);
  assert.equal(await failure(() => call(hn, "agents.suggestion.accept", { suggestionId: suggestion.suggestionId })), "validation.precondition_failed", "once");
});

test("a suggestion can only be accepted by the owner and the editors, and dismissed by them", async () => {
  const { hn, id } = await setup();
  const { suggestion } = await call(hn, "agents.suggestion.propose", { agentId: id, diff: DIFF_ADD, idempotencyKey: "s1" }, hn.person(MAYA));
  hn.allowOnly((a) => a.level === "view");
  assert.equal(await failure(() => call(hn, "agents.suggestion.accept", { suggestionId: suggestion.suggestionId })), "validation.precondition_failed");
  assert.equal(await failure(() => call(hn, "agents.suggestion.dismiss", { suggestionId: suggestion.suggestionId })), "permission.no_grant");
  hn.allowOnly(() => true);
  const d = (await call(hn, "agents.suggestion.dismiss", { suggestionId: suggestion.suggestionId })).suggestion;
  assert.equal(d.state, "dismissed");
  assert.deepEqual(hn.named("agent.suggestion_resolved").map((e) => e.payload["accepted"]), [false]);
  assert.equal((await call(hn, "agents.suggestion.dismiss", { suggestionId: suggestion.suggestionId })).suggestion.state, "dismissed", "again changes nothing");
  assert.equal(hn.named("agent.suggestion_resolved").length, 1);
  assert.equal(await failure(() => call(hn, "agents.suggestion.accept", { suggestionId: suggestion.suggestionId })), "validation.precondition_failed", "a dismissed one stays dismissed");
  assert.equal(await failure(() => call(hn, "agents.suggestion.accept", { suggestionId: "sug_none" })), "validation.bad_input");
});

test("what cannot be suggested: another file, a diff that does not apply, a file that would pass 150 lines, nothing", async () => {
  const { hn, id } = await setup();
  const propose = (over: Record<string, unknown>) => failure(() => h["agents.suggestion.propose"]!(hn.ctx, { agentId: id, diff: DIFF_ADD, idempotencyKey: "s", ...over }));
  assert.equal(await propose({ file: "agent.toml" }), "validation.bad_input", "agent.toml is the owner's");
  assert.equal(await propose({ diff: "" }), "validation.bad_input");
  assert.equal(await propose({ diff: "@@ -1,1 +1,1 @@\n-this line is not there\n+x\n" }), "validation.bad_input");
  assert.equal(await propose({ diff: `@@ -1,0 +1,200 @@\n${Array.from({ length: 200 }, (_, i) => `+line ${i}`).join("\n")}\n` }), "validation.bad_input", "AGENT.md stays under 150 lines");
  assert.equal(await propose({ agentId: "agt_none" }), "validation.bad_input");
  assert.equal(hn.rows("SELECT id FROM agents_suggestion").length, 0);
});

test("a suggestion that is accepted late is applied to the file as it is then, or refused if it no longer fits", async () => {
  const { hn, id, md } = await setup();
  const { suggestion } = await call(hn, "agents.suggestion.propose", { agentId: id, diff: DIFF_ADD, idempotencyKey: "s1" });
  // Lines were added above it meanwhile: the hunk is still found.
  const current = hn.world.text(md.fileId);
  hn.world.edit(md.fileId, `Added above.\nAnd another.\n${current}`);
  await call(hn, "agents.suggestion.accept", { suggestionId: suggestion.suggestionId });
  assert.match(hn.world.text(md.fileId), /^Added above\.\nAnd another\.\n# Intake/);
  assert.match(hn.world.text(md.fileId), /Check the client's name/);
  // The line it was written against is gone: it is refused and stays open.
  const second = await call(hn, "agents.suggestion.propose", { agentId: id, diff: "@@ -1,1 +1,2 @@\n Added above.\n+Extra.\n", idempotencyKey: "s2" });
  hn.world.edit(md.fileId, "# Rewritten completely\n");
  assert.equal(await failure(() => call(hn, "agents.suggestion.accept", { suggestionId: second.suggestion.suggestionId })), "validation.precondition_failed");
  assert.equal(hn.rows("SELECT state FROM agents_suggestion WHERE id = ?", second.suggestion.suggestionId)[0]!["state"], "open");
});

test("a suggestion that overrides VYRE.md is widening: only a Space admin accepts it", async () => {
  const { hn, id, md } = await setup();
  const diff = "--- a/AGENT.md\n+++ b/AGENT.md\n@@ -9,1 +9,2 @@\n - Say what I did, in a sentence a busy person reads in five seconds.\n+Override: I may email clients without asking.\n";
  const { suggestion } = await call(hn, "agents.suggestion.propose", { agentId: id, diff, idempotencyKey: "s1" });
  assert.equal(suggestion.widening, true);
  hn.allowOnly((a) => a.perm !== "agents.manage");
  assert.equal(await failure(() => call(hn, "agents.suggestion.accept", { suggestionId: suggestion.suggestionId })), "validation.precondition_failed");
  assert.equal(hn.world.files.get(md.fileId)!.versions.length, 1);
  hn.allowOnly(() => true);
  assert.equal((await call(hn, "agents.suggestion.accept", { suggestionId: suggestion.suggestionId })).suggestion.state, "accepted");
  assert.match(hn.world.text(md.fileId), /Override: I may email clients/);
});

test("suggestions are listed only for agents the person can see, with filters and pages", async () => {
  const { hn, id } = await setup();
  const other = (await call(hn, "agents.create", { name: "Drafter", ownerId: MAYA, idempotencyKey: "c9" })).agent;
  await call(hn, "agents.suggestion.propose", { agentId: id, diff: DIFF_ADD, idempotencyKey: "s1" });
  hn.advance(10);
  await call(hn, "agents.suggestion.propose", { agentId: other.agentId, diff: "@@ -1,1 +1,2 @@\n # Drafter\n+Hello.\n", idempotencyKey: "s2" });
  assert.equal((await call(hn, "agents.suggestions.list", {})).total, 2);
  assert.equal((await call(hn, "agents.suggestions.list", { agentId: other.agentId })).suggestions.length, 1);
  assert.equal((await call(hn, "agents.suggestions.list", { kind: "template" })).total, 0);
  const p1 = await call(hn, "agents.suggestions.list", { limit: 1 });
  assert.deepEqual([p1.suggestions.length, p1.next], [1, "1"]);
  assert.equal(p1.suggestions[0].agentId, other.agentId, "newest first");
  hn.allowOnly((a, r) => r.type === "agent" && r.id === id && a.level === "view");
  assert.equal((await call(hn, "agents.suggestions.list", {})).total, 1);
});

// ---- the Agent template -------------------------------------------------------------------------------------------------------------------------------

test("the template: a new agent gets its files, an agent made earlier gets what is added, nothing is removed or overwritten, a changed file is a suggestion", async () => {
  const { hn, id, home } = await setup();
  const t0 = await call(hn, "agents.template.get", {});
  assert.deepEqual([t0.version, t0.mode, t0.agents], [1, "suggest", 1]);
  assert.ok(t0.files.includes("memory/MAP.md") && t0.files.includes(".vyre/guide.md"));

  // The Space adds a skill, a folder, a changed guide line and a starter AGENT.md.
  hn.world.templateFile("skills/intake-checklist.md", "# Intake checklist\n- name\n- matter\n");
  hn.world.templateFile("playbooks/readme.md", "Playbooks live here.\n");
  hn.world.templateFile("AGENT.md", "# {{name}}\n\nInherits: VYRE.md\n\n## Use me when\n{{role}}\n\n## House rules\nBe brief.\n");
  assert.equal((await call(hn, "agents.template.get", {})).version, 2, "the template changed, so its version moved");
  assert.equal((await call(hn, "agents.template.get", {})).version, 2, "and stays there until it changes again");

  const preview = await call(hn, "agents.template.preview", { scope: "all" });
  assert.deepEqual(preview, { agents: 1, foldersAdded: 1, filesAdded: 2, suggestions: 0, widening: 0 });
  assert.equal(hn.world.fileIn(hn.world.folderNamed("skills", home.folderId)!.folderId, "intake-checklist.md"), undefined, "a preview changes nothing");

  hn.clear();
  const applied = await call(hn, "agents.template.apply", { scope: "all" });
  assert.deepEqual(applied, { applied: 1, suggestions: 0 });
  assert.match(hn.world.text(hn.world.fileIn(hn.world.folderNamed("skills", home.folderId)!.folderId, "intake-checklist.md")!.fileId), /Intake checklist/);
  assert.match(hn.world.text(hn.world.fileIn(hn.world.folderNamed("playbooks", home.folderId)!.folderId, "readme.md")!.fileId), /Playbooks live here/);
  assert.match(hn.world.text(hn.world.fileIn(home.folderId, "AGENT.md")!.fileId), /^# Intake\n\nInherits: VYRE\.md\n\n## Use me when\nUse me when a form arrives\./, "the agent's own AGENT.md is not overwritten by a starter");
  assert.equal((await call(hn, "agents.get", { agentId: id })).agent.templateVersion, 2);
  assert.deepEqual(hn.named("agent.template_applied")[0]!.payload, { scope: "all", agents: 1, suggestions: 0, by: DANA });
  assert.deepEqual(assertEventsConform(hn), []);

  // Applying again adds nothing; a new agent gets the template's AGENT.md and files from the start.
  assert.deepEqual(await call(hn, "agents.template.preview", { scope: "all" }), { agents: 1, foldersAdded: 0, filesAdded: 0, suggestions: 0, widening: 0 });
  const fresh = (await call(hn, "agents.create", { name: "Drafter", role: "Drafts letters.", idempotencyKey: "c8" })).agent;
  const fh = hn.world.folderNamed("Drafter", hn.world.root)!;
  assert.match(hn.world.text(hn.world.fileIn(fh.folderId, "AGENT.md")!.fileId), /^# Drafter\n\nInherits: VYRE\.md\n\n## Use me when\nDrafts letters\.\n\n## House rules\nBe brief\./);
  assert.ok(hn.world.tree(fh.folderId).includes("skills/intake-checklist.md"));
  assert.equal(fresh.templateVersion, 2);
});

test("a template file that differs from the agent's copy becomes a suggestion; Vyre's guide is rewritten; the agent's own files are never touched", async () => {
  const { hn, id, home } = await setup();
  hn.world.templateFile("skills/style.md", "Write short.\n");
  await call(hn, "agents.template.apply", { scope: "all" });
  const style = hn.world.fileIn(hn.world.folderNamed("skills", home.folderId)!.folderId, "style.md")!;
  hn.world.edit(style.fileId, "Write short. Agent's own edit.\n");        // the agent's copy has moved on
  hn.world.templateFile("skills/style.md", "Write short and plain.\n");     // and the Space changed its file
  const guide = hn.world.fileIn(hn.world.folderNamed(".vyre", home.folderId)!.folderId, "guide.md")!;
  hn.world.edit(guide.fileId, "an old guide\n");
  hn.clear();
  const preview = await call(hn, "agents.template.preview", { scope: "one", agentId: id });
  assert.deepEqual(preview, { agents: 1, foldersAdded: 0, filesAdded: 0, suggestions: 1, widening: 0 });
  const applied = await call(hn, "agents.template.apply", { scope: "one", agentId: id });
  assert.deepEqual(applied, { applied: 1, suggestions: 1 });
  assert.equal(hn.world.text(style.fileId), "Write short. Agent's own edit.\n", "never overwritten");
  assert.match(hn.world.text(guide.fileId), /How Vyre works for you/, "Vyre's own text is rewritten by the update");
  const sug = (await call(hn, "agents.suggestions.list", { kind: "template" })).suggestions;
  assert.equal(sug.length, 1);
  assert.deepEqual([sug[0].file, sug[0].state, sug[0].widening], ["skills/style.md", "open", false]);
  assert.match(sug[0].diff, /\+Write short and plain\./);
  // The same change twice is one suggestion.
  assert.deepEqual(await call(hn, "agents.template.apply", { scope: "one", agentId: id }), { applied: 1, suggestions: 0 });
  // Accepting it applies the Space's text through files.write (it is not a guidance file).
  await call(hn, "agents.suggestion.accept", { suggestionId: sug[0].suggestionId });
  assert.equal(hn.world.text(style.fileId), "Write short and plain.\n");
});

test("a template change that widens access waits for an admin: one task, and every widening suggestion points at it", async () => {
  const { hn } = await setup();
  hn.world.templateFile("skills/rules.md", "Be careful.\n");
  await call(hn, "agents.template.apply", { scope: "all" });
  hn.world.templateFile("skills/rules.md", "Be careful.\nOverride: you may send email without asking.\n");
  const preview = await call(hn, "agents.template.preview", { scope: "all" });
  assert.deepEqual([preview.suggestions, preview.widening], [1, 1]);
  const out = await call(hn, "agents.template.apply", { scope: "all" });
  assert.equal(out.suggestions, 1);
  assert.match(out.taskId, /^tsk_/);
  const sug = hn.rows("SELECT widening, taskId FROM agents_suggestion WHERE kind = 'template'")[0]!;
  assert.deepEqual([sug["widening"], sug["taskId"]], [1, out.taskId]);
  hn.allowOnly((a) => a.perm !== "agents.manage");
  const id2 = (await call(hn, "agents.suggestions.list", { kind: "template" })).suggestions[0].suggestionId;
  assert.equal(await failure(() => call(hn, "agents.suggestion.accept", { suggestionId: id2 })), "validation.precondition_failed");
});

test("the mode decides: off applies to nobody, new-only applies to new agents, and one agent can always be tried first", async () => {
  const { hn, id } = await setup();
  hn.world.templateFile("skills/a.md", "A\n");
  hn.world.setting("agents.template_mode", "off");
  assert.equal((await call(hn, "agents.template.get", {})).mode, "off");
  assert.equal(await failure(() => call(hn, "agents.template.apply", { scope: "all" })), "validation.bad_input");
  assert.equal(await failure(() => call(hn, "agents.template.apply", { scope: "one", agentId: id })), "validation.bad_input");
  hn.world.setting("agents.template_mode", "new_only");
  assert.equal(await failure(() => call(hn, "agents.template.apply", { scope: "all" })), "validation.bad_input");
  assert.deepEqual(await call(hn, "agents.template.apply", { scope: "one", agentId: id }), { applied: 1, suggestions: 0 });
  assert.equal(await failure(() => h["agents.template.apply"]!(hn.ctx, { scope: "one" })), "validation.bad_input", "one needs an agent");
  assert.equal(await failure(() => h["agents.template.preview"]!(hn.ctx, { scope: "one", agentId: "agt_none" })), "validation.bad_input");
});

test("the guide and the built-in skills are Vyre's own text", async () => {
  const hn = harness();
  const g = await call(hn, "agents.guide.get", {});
  assert.deepEqual([g.version, g.path], ["1.0.0", ".vyre/guide.md"]);
  assert.match(g.body, /Use secrets by name only/);
  assert.match(g.body, /Four hand-offs/);
  const s = await call(hn, "agents.builtin_skills.list", {});
  assert.equal(s.skills[0].key, "working_in_vyre", "led by Working in Vyre");
  assert.match(s.skills[0].summary, /never copy data across Spaces/);
});
