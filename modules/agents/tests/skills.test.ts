// agents: skills (CHAT-DESIGN ruling 4). Three tiers, nearest first: the agent's own skills/ folder, the Space library, the files Vyre ships. The index is name plus one line, load returns the text,
// and the library is written only with agents.manage.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { forgetFolderSkills } from "../handlers/skills.ts";
import { DANA, assertEventsConform, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const call = async (hn: Harness, cap: string, input: Record<string, unknown>, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  const withKey = cap === "skills.add" || cap === "skills.remove" || cap === "skills.set_enabled" ? { idempotencyKey: `k${++n}`, ...input } : input;
  assert.deepEqual(contractErrors(cap, "in", withKey), [], `${cap}: input`);
  const out = await h[cap]!(ctx, withKey);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap}: output`);
  return out;
};
const SKILL = (name: string, desc: string, body = "Do the thing.") => `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body}\n`;
const names = (r: { skills: Array<{ name: string }> }) => r.skills.map((s) => s.name);

async function agentWithFolderSkill(hn: Harness, name: string, text: string): Promise<string> {
  forgetFolderSkills();
  const a = (await call(hn, "agents.create", { name: "Intake", role: "Use me for intake.", idempotencyKey: `c${++n}` })).agent;
  const f = hn.world.handlers;
  const skills = hn.world.folderNamed("skills", a.folderId)!.folderId;
  const dir = (await f["files.folder.create"]!({ parentId: skills, name })).folder.folderId as string;
  await f["files.create"]!({ folderId: dir, name: "SKILL.md", content: { text } });
  await f["files.create"]!({ folderId: dir, name: "notes.md", content: { text: "extra notes" } });
  return a.agentId as string;
}

test("the built-in skills are listed with a one-line description, and load returns the full text", async () => {
  const hn = harness();
  const list = await call(hn, "skills.list", {});
  assert.ok(names(list).includes("working-in-vyre"));
  const w = list.skills.find((s: { name: string }) => s.name === "working-in-vyre");
  assert.deepEqual([w.tier, w.source, w.system, w.enabled], ["builtin", "vyre", true, true]);
  const got = await call(hn, "skills.load", { name: "working-in-vyre" });
  assert.match(got.skill.body, /^# Working in Vyre/m);
  assert.equal(got.skill.tier, "builtin");
  assert.equal(codeOf(await call(hn, "skills.load", { name: "nope" }).catch((e) => e)), "validation.not_found");
});

test("the Space library: add, replace, switch off and on, remove; a built-in system skill cannot be replaced; bad text is refused", async () => {
  const hn = harness();
  const added = await call(hn, "skills.add", { text: SKILL("deploy-checks", "Run the checks before a deploy."), files: { "references/list.md": "one two" } });
  assert.deepEqual([added.skill.tier, added.skill.source, added.skill.name], ["space", "upload", "deploy-checks"]);
  assert.deepEqual(hn.named("skill.added").map((e) => e.payload["name"]), ["deploy-checks"]);
  assert.deepEqual(assertEventsConform(hn), []);
  assert.ok(names(await call(hn, "skills.list", {})).includes("deploy-checks"));
  const loaded = await call(hn, "skills.load", { name: "deploy-checks" });
  assert.equal(loaded.skill.body, "Do the thing.\n");
  assert.deepEqual(loaded.skill.files, [{ path: "references/list.md", text: "one two" }]);
  await call(hn, "skills.add", { text: SKILL("deploy-checks", "Run the NEW checks.") });
  assert.equal((await call(hn, "skills.list", {})).skills.find((s: { name: string }) => s.name === "deploy-checks").description, "Run the NEW checks.");
  await call(hn, "skills.set_enabled", { name: "deploy-checks", enabled: false });
  assert.ok(!names(await call(hn, "skills.list", {})).includes("deploy-checks"), "off ones leave the index");
  assert.ok(names(await call(hn, "skills.list", { includeOff: true })).includes("deploy-checks"), "but Settings still lists them");
  assert.equal(codeOf(await call(hn, "skills.load", { name: "deploy-checks" }).catch((e) => e)), "validation.not_found");
  await call(hn, "skills.set_enabled", { name: "deploy-checks", enabled: true });
  assert.equal((await call(hn, "skills.remove", { name: "deploy-checks" })).removed, true);
  assert.equal((await call(hn, "skills.remove", { name: "deploy-checks" })).removed, false);
  assert.equal(codeOf(await call(hn, "skills.add", { text: SKILL("working-in-vyre", "Mine now.") }).catch((e) => e)), "validation.duplicate");
  assert.equal((await call(hn, "skills.add", { text: "---\nname: nodesc\n---\nFirst body line." })).skill.description, "First body line.", "the first body line stands in for a missing description");
  assert.equal(codeOf(await call(hn, "skills.add", { text: "---\nname: bad name!\ndescription: x\n---\n" }).catch((e) => e)), "validation.bad_input");
  assert.equal(codeOf(await call(hn, "skills.add", { text: SKILL("big", "x"), files: { "../escape.md": "x" } }).catch((e) => e)), "validation.bad_input");
});

test("an agent's own skills/ folder is the nearest tier: it shows in that agent's index, wins over the Space copy, and is not seen by other agents", async () => {
  const hn = harness();
  await call(hn, "skills.add", { text: SKILL("triage", "Space copy of triage.") });
  const id = await agentWithFolderSkill(hn, "triage", SKILL("triage", "The intake agent's own triage."));
  const other = (await call(hn, "agents.create", { name: "Other", role: "Other.", idempotencyKey: `c${++n}` })).agent.agentId as string;
  const mine = (await call(hn, "skills.list", { agentId: id })).skills.filter((s: { name: string }) => s.name === "triage");
  assert.deepEqual(mine.map((s: { tier: string; description: string }) => [s.tier, s.description]), [["agent", "The intake agent's own triage."]]);
  const text = await call(hn, "skills.load", { name: "triage", agentId: id });
  assert.equal(text.skill.tier, "agent");
  assert.deepEqual(text.skill.files, [{ path: "notes.md", text: "extra notes" }]);
  forgetFolderSkills();
  const theirs = (await call(hn, "skills.list", { agentId: other })).skills.filter((s: { name: string }) => s.name === "triage");
  assert.deepEqual(theirs.map((s: { tier: string }) => s.tier), ["space"]);
});

test("a skill installed into one agent is that agent's alone", async () => {
  const hn = harness();
  forgetFolderSkills();
  const a = (await call(hn, "agents.create", { name: "Solo", role: "Solo.", idempotencyKey: `c${++n}` })).agent.agentId as string;
  const b = (await call(hn, "agents.create", { name: "Duo", role: "Duo.", idempotencyKey: `c${++n}` })).agent.agentId as string;
  const added = await call(hn, "skills.add", { text: SKILL("plug:hello", "From a plugin."), agentId: a, source: "plugin:plug" });
  assert.deepEqual([added.skill.tier, added.skill.agentId, added.skill.source], ["agent", a, "plugin:plug"]);
  assert.ok(names(await call(hn, "skills.list", { agentId: a })).includes("plug:hello"));
  assert.ok(!names(await call(hn, "skills.list", { agentId: b })).includes("plug:hello"));
  assert.ok(!names(await call(hn, "skills.list", {})).includes("plug:hello"));
  assert.equal((await call(hn, "skills.remove", { name: "plug:hello", agentId: a })).removed, true);
});

test("an agent the caller may not see adds nothing to the index", async () => {
  const hn = harness({ allow: (a) => a.perm !== null || a.level !== "view" });
  const stranger = hn.as({ kind: "person", id: "usr_stranger" });
  forgetFolderSkills();
  const id = await agentWithFolderSkill(hn, "secret-one", SKILL("secret-one", "Private."));
  const seen = await call(hn, "skills.list", { agentId: id }, stranger);
  assert.ok(!names(seen).includes("secret-one"));
  void DANA;
});
