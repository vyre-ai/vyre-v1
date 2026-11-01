// agents: the AGENT.md an agent starts with. Instructions to the agent, "Your job" from the role line, the private assistant's chief-of-staff file under its possessive name, and the boot upgrade
// that gives an untouched old starter today's text as a new version and never touches a file a person edited.
// @reads /modules/agents/impl.ts
import test from "node:test";
import assert from "node:assert/strict";
import { consumers, handlers, periodic } from "../impl.ts";
import { upgradeStarterAgentMd } from "../handlers/crud.ts";
import { AGENT_MD_DEFAULT, AGENT_MD_V1, ASSISTANT_AGENT_MD, isAgentMdV1, jobLine, learnedEntries, onlyLearnedChanged, simpleDiff } from "../projections.ts";
import { DANA, LEO, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0;
const born = (id: string, name: string) => ({ payload: { principalId: id, kind: "person", name } });
const record = (hn: Harness, id: string): Record<string, unknown> => hn.rows("SELECT * FROM agents_agent WHERE id = ?", id)[0]!;
const mdOf = (hn: Harness, id: string): string => String(record(hn, id)["agentMdFileId"]);
/** One section of an AGENT.md, without its heading. */
const section = (text: string, heading: string): string => (new RegExp(`## ${heading}\\n([\\s\\S]*?)(?:\\n## |$)`).exec(text)?.[1] ?? "").trim();
/** Make the agent look like one from before the fuller starter: its only version is the old nine-line text. */
const makeOld = (hn: Harness, agentId: string, title: string, role: string): void => {
  const f = hn.world.files.get(mdOf(hn, agentId))!;
  assert.equal(f.versions.length, 1);
  f.versions[0]!.text = AGENT_MD_V1(title, role);
};

const ASSISTANT_HEADS = ["Who you are and who you serve", "Operating principles", "How to decide", "Working in Vyre", "Memory", "Reporting back", "Safety", "When you are wrong", "Learned"];
const AGENT_HEADS = ["Your job", "Operating principles", "How to decide", "Working in Vyre", "Memory", "Reporting back", "Safety", "When you are wrong", "Learned"];
const headsOf = (text: string): string[] => text.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3));

test("'Your job' is never the bare role word: 'Use me when' turns to the second person, a title becomes a sentence, no role says what to do", () => {
  for (const role of ["Researcher", "researcher", "Sales analyst", "Intake", "Use me when a form arrives.", "drafts letters", "", "  "]) {
    const job = section(AGENT_MD_DEFAULT("Scout", role), "Your job");
    const first = job.split("\n")[0] ?? "";
    assert.ok(first.length > 20, `role ${JSON.stringify(role)} gives a real line`);
    assert.notEqual(first.toLowerCase().replace(/[.]$/, ""), role.trim().toLowerCase().replace(/[.]$/, ""), `role ${JSON.stringify(role)} is not just repeated`);
  }
  assert.equal(section(ASSISTANT_AGENT_MD("Dana’s Assistant"), "Your job"), "", "the assistant has no role-word section at all");
  assert.equal(jobLine("Use me when a new client form arrives."), "People use you when a new client form arrives.");
  assert.equal(jobLine("Researcher"), "You are the researcher here: people bring you the work a researcher does, and you see it through.");
  assert.equal(jobLine("Analyst"), "You are the analyst here: people bring you the work an analyst does, and you see it through.");
  assert.equal(jobLine("drafts letters"), "Your role: drafts letters.");
  assert.match(jobLine(undefined), /^Your role line is empty\./);
});

test("both defaults are instructions to the agent: the sections in order, second person, imperative, no first-person sentence", () => {
  assert.deepEqual(headsOf(ASSISTANT_AGENT_MD("Irfad’s Assistant")), ASSISTANT_HEADS);
  assert.deepEqual(headsOf(AGENT_MD_DEFAULT("Intake", "Use me when a form arrives.")), AGENT_HEADS);
  for (const text of [ASSISTANT_AGENT_MD("Irfad’s Assistant"), AGENT_MD_DEFAULT("Intake", "Use me when a form arrives."), AGENT_MD_DEFAULT("Scout", undefined)]) {
    for (const line of text.split("\n")) {
      assert.ok(!/(^|[-.:;,"(]\s*|\d\.\s)I\s|\bI'm\b|\bmy\b|\bme\b/i.test(line.replace(/^#.*/, "")) || /^- YYYY/.test(line), `first person: ${line}`);
    }
    assert.ok(/\byou\b/i.test(text));
    assert.ok(!/[\u2014\u00a7]/.test(text), "no em dash or section sign");
    assert.equal(learnedEntries(text).length, 0, "Learned starts with its rules and no entries");
  }
  const lines = (t: string): number => t.split("\n").length - 1;
  assert.ok(lines(ASSISTANT_AGENT_MD("Irfad’s Assistant")) >= 80 && lines(ASSISTANT_AGENT_MD("Irfad’s Assistant")) <= 120, `assistant ${lines(ASSISTANT_AGENT_MD("Irfad’s Assistant"))} lines`);
  assert.ok(lines(AGENT_MD_DEFAULT("Intake", "x y z w.")) <= 70);
  const a = ASSISTANT_AGENT_MD("Irfad’s Assistant");
  for (const must of ["Act without asking on reversible work inside Vyre", "Ask once, with the draft ready", "Never go past your owner's own permissions", "one source of truth", "search_query", "records_query", "inbox_send_options", "calendar_find_time", "tasks_needs_you", "automations_list", "vault_use", "handoff", "# link", "memory_remember", "\"Noted: <the fact>.\"", "Answer first", "Sent by Vyre Assistant", "Never carry data between Spaces", "Record the lesson under Learned", "agents_suggestion_propose"]) {
    assert.ok(a.includes(must), must);
  }
});

test("the agent keeps its own Learned section: a Learned-only change applies at once as a version; any other change, a person's change and an Override line wait for review", async () => {
  const hn = harness();
  const agent = (await h["agents.create"]!(hn.ctx, { name: "Intake", role: "Use me when a form arrives.", idempotencyKey: `md${++n}` })).agent;
  const md = mdOf(hn, agent.agentId);
  const self = hn.as({ kind: "agent", id: agent.agentId }, DANA);
  const base = hn.world.text(md);
  const learned = `${base}- 2026-10-31: Check the client's name against the form first, because two matters were filed under the wrong name.\n`;
  const own = (await h["agents.suggestion.propose"]!(self, { agentId: agent.agentId, diff: simpleDiff("AGENT.md", base, learned), reason: "A correction", idempotencyKey: `md${++n}` })).suggestion;
  assert.equal(own.state, "accepted");
  assert.equal(hn.world.text(md), learned, "applied at once");
  assert.equal(hn.world.files.get(md)!.versions.length, 2, "as a new version");
  assert.deepEqual(learnedEntries(hn.world.text(md)).length, 1);

  const elsewhere = learned.replace("1. Act without asking", "1. Always act without asking");
  const other = (await h["agents.suggestion.propose"]!(self, { agentId: agent.agentId, diff: simpleDiff("AGENT.md", learned, elsewhere), idempotencyKey: `md${++n}` })).suggestion;
  assert.equal(other.state, "open", "a rule above Learned is reviewed");
  const loosen = `${learned}Override: email clients without asking.\n`;
  assert.equal((await h["agents.suggestion.propose"]!(self, { agentId: agent.agentId, diff: simpleDiff("AGENT.md", learned, loosen), idempotencyKey: `md${++n}` })).suggestion.state, "open", "an Override line is never self-applied");
  const heading = `${learned}\n## New rules\n- Be quick.\n`;
  assert.equal((await h["agents.suggestion.propose"]!(self, { agentId: agent.agentId, diff: simpleDiff("AGENT.md", learned, heading), idempotencyKey: `md${++n}` })).suggestion.state, "open", "a new section after Learned is reviewed");
  const byPerson = `${learned}- 2026-10-31: Use the short form.\n`;
  assert.equal((await h["agents.suggestion.propose"]!(hn.person(DANA), { agentId: agent.agentId, diff: simpleDiff("AGENT.md", learned, byPerson), idempotencyKey: `md${++n}` })).suggestion.state, "open", "only the agent itself skips review");
  assert.equal(hn.world.text(md), learned, "none of those changed the file");
  assert.equal(hn.world.files.get(md)!.versions.length, 2);
  assert.ok(onlyLearnedChanged(base, learned));
  assert.ok(!onlyLearnedChanged(learned, learned));
});

test("a Learned line that Files refuses to save waits for review instead of being lost", async () => {
  const hn = harness();
  const agent = (await h["agents.create"]!(hn.ctx, { name: "Intake", role: "Use me when a form arrives.", idempotencyKey: `md${++n}` })).agent;
  const md = mdOf(hn, agent.agentId);
  const base = hn.world.text(md);
  hn.world.answer("files.save", () => { throw Object.assign(new Error("no"), { error: { code: "permission.no_grant", message: "no" } }); });
  const s = (await h["agents.suggestion.propose"]!(hn.as({ kind: "agent", id: agent.agentId }, DANA), { agentId: agent.agentId, diff: simpleDiff("AGENT.md", base, `${base}- 2026-10-31: Be brief, because the owner said so.\n`), idempotencyKey: `md${++n}` })).suggestion;
  assert.equal(s.state, "open");
  assert.equal(hn.world.text(md), base);
});

test("a person's assistant starts with the chief-of-staff AGENT.md under its possessive name, not the role word, and not the Space's starter", async () => {
  const hn = harness();
  hn.world.templateFile("AGENT.md", "# {{name}}\n\nInherits: VYRE.md\n\n## Use me when\n{{role}}\n");
  const [id] = await consumers["agents.ensure_assistant"].run(hn.person(DANA), born(DANA, "Dana Reyes"));
  const text = hn.world.text(mdOf(hn, id!));
  assert.equal(text, ASSISTANT_AGENT_MD("Dana’s Assistant"));
  assert.match(text, /^# Dana’s Assistant\n/);
  assert.match(section(text, "Who you are and who you serve"), /^- You are the private assistant of one person/);
  assert.ok(!text.split("\n").includes("assistant"), "the bare role word is not a line of it");
  const [james] = await consumers["agents.ensure_assistant"].run(hn.person(LEO), born(LEO, "James Cross"));
  assert.match(hn.world.text(mdOf(hn, james!)), /^# James’ Assistant\n/);
});

test("boot upgrade: an untouched old starter gets today's text as version 2 with version 1 kept; a second run does nothing", async () => {
  const hn = harness();
  const agent = (await h["agents.create"]!(hn.ctx, { name: "Intake", role: "Use me when a new client form arrives.", idempotencyKey: `md${++n}` })).agent;
  makeOld(hn, agent.agentId, "Intake", "Use me when a new client form arrives.");
  assert.ok(isAgentMdV1(hn.world.text(mdOf(hn, agent.agentId))));
  assert.deepEqual(await upgradeStarterAgentMd(hn.ctx), [agent.agentId]);
  const f = hn.world.files.get(mdOf(hn, agent.agentId))!;
  assert.equal(f.versions.length, 2, "a new version, history kept");
  assert.equal(f.versions[0]!.text, AGENT_MD_V1("Intake", "Use me when a new client form arrives."));
  assert.equal(hn.world.text(f.fileId), AGENT_MD_DEFAULT("Intake", "Use me when a new client form arrives."));
  assert.deepEqual(await upgradeStarterAgentMd(hn.ctx), [], "idempotent");
  hn.ctx.db.run("DELETE FROM agents_meta WHERE key LIKE 'agents.agent_md.v2:%'");
  assert.deepEqual(await upgradeStarterAgentMd(hn.ctx), [], "idempotent even without the note: the text no longer matches");
  assert.equal(f.versions.length, 2);
  assert.equal(periodic["agents.agent_md_upgrade"].everyMs, 15 * 60_000);
  assert.equal(periodic["agents.agent_md_upgrade"].immediate, true);
});

test("boot upgrade: a file a person edited is left alone, even when the edit put the old text back; a file that never was the old starter is left alone", async () => {
  const hn = harness();
  const edited = (await h["agents.create"]!(hn.ctx, { name: "Edited", role: "Researcher", idempotencyKey: `md${++n}` })).agent;
  makeOld(hn, edited.agentId, "Edited", "Researcher");
  hn.world.edit(mdOf(hn, edited.agentId), `${AGENT_MD_V1("Edited", "Researcher")}- Check the source first.\n`);
  const restored = (await h["agents.create"]!(hn.ctx, { name: "Restored", role: "Writer", idempotencyKey: `md${++n}` })).agent;
  makeOld(hn, restored.agentId, "Restored", "Writer");
  hn.world.edit(mdOf(hn, restored.agentId), AGENT_MD_V1("Restored", "Writer"));
  const fresh = (await h["agents.create"]!(hn.ctx, { name: "Fresh", role: "Writer", idempotencyKey: `md${++n}` })).agent;
  const before = (id: string): string[] => hn.world.files.get(mdOf(hn, id))!.versions.map((v) => v.text);
  const snap = [edited, restored, fresh].map((a) => before(a.agentId));
  assert.deepEqual(await upgradeStarterAgentMd(hn.ctx), []);
  assert.deepEqual([edited, restored, fresh].map((a) => before(a.agentId)), snap, "not one version added or changed");
  assert.equal(hn.world.calls.filter((c) => c.cap === "files.save").length, 0);
});

test("boot upgrade: an assistant still called by the old name waits for its rename, then gets the possessive title", async () => {
  const hn = harness();
  const [dana] = await consumers["agents.ensure_assistant"].run(hn.person(DANA), born(DANA, "Dana Reyes"));
  await h["agents.update"]!(hn.person(DANA), { agentId: dana!, patch: { name: "Dana Assistant" } });
  makeOld(hn, dana!, "Dana Assistant", "assistant");
  assert.deepEqual(await upgradeStarterAgentMd(hn.ctx), [], "the old name first becomes the possessive one");
  assert.equal(hn.world.files.get(mdOf(hn, dana!))!.versions.length, 1);
  assert.deepEqual(await periodic["agents.assistant_names"].run(hn.ctx), [dana]);
  assert.deepEqual(await upgradeStarterAgentMd(hn.ctx), [dana]);
  const text = hn.world.text(mdOf(hn, dana!));
  assert.equal(text, ASSISTANT_AGENT_MD("Dana’s Assistant"));
  assert.equal(hn.world.files.get(mdOf(hn, dana!))!.versions.length, 2);
});
