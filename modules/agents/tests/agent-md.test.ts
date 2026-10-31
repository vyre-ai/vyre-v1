// agents: the AGENT.md an agent starts with. A real "Use me when" from the role line, the private assistant's chief-of-staff file under its possessive name, and the boot upgrade
// that gives an untouched old starter today's text as a new version and never touches a file a person edited.
// @reads /modules/agents/impl.ts
import test from "node:test";
import assert from "node:assert/strict";
import { consumers, handlers, periodic } from "../impl.ts";
import { upgradeStarterAgentMd } from "../handlers/crud.ts";
import { AGENT_MD_DEFAULT, AGENT_MD_V1, ASSISTANT_AGENT_MD, isAgentMdV1, useMeWhen } from "../projections.ts";
import { DANA, LEO, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;   // eslint-disable-line @typescript-eslint/no-explicit-any
let n = 0;
const born = (id: string, name: string) => ({ payload: { principalId: id, kind: "person", name } });
const record = (hn: Harness, id: string): Record<string, unknown> => hn.rows("SELECT * FROM agents_agent WHERE id = ?", id)[0]!;
const mdOf = (hn: Harness, id: string): string => String(record(hn, id)["agentMdFileId"]);
/** The "Use me when" section of an AGENT.md, without its heading. */
const section = (text: string, heading: string): string => (new RegExp(`## ${heading}\\n([\\s\\S]*?)(?:\\n## |$)`).exec(text)?.[1] ?? "").trim();
/** Make the agent look like one from before the fuller starter: its only version is the old nine-line text. */
const makeOld = (hn: Harness, agentId: string, title: string, role: string): void => {
  const f = hn.world.files.get(mdOf(hn, agentId))!;
  assert.equal(f.versions.length, 1);
  f.versions[0]!.text = AGENT_MD_V1(title, role);
};

test("'Use me when' is never the bare role word: a sentence is kept, a title becomes a sentence, no role asks for one", () => {
  for (const role of ["assistant", "Assistant", "Researcher", "researcher", "Sales analyst", "Intake", "", "  "]) {
    const text = AGENT_MD_DEFAULT("Scout", role);
    const use = section(text, "Use me when");
    assert.ok(use.length > 20, `role ${JSON.stringify(role)} gives a real section`);
    assert.notEqual(use.toLowerCase(), role.trim().toLowerCase(), `role ${JSON.stringify(role)} is not just repeated`);
    assert.ok(!use.split("\n").some((l) => l.replace(/^- /, "").trim().toLowerCase() === role.trim().toLowerCase() && role.trim() !== ""), `no line is only ${JSON.stringify(role)}`);
  }
  assert.equal(useMeWhen("Scout", "Researcher"), "You need a researcher on something: ask me in chat, @mention me, or hand me a task.");
  assert.equal(useMeWhen("Scout", "Analyst"), "You need an analyst on something: ask me in chat, @mention me, or hand me a task.");
  assert.equal(useMeWhen("Scout", "Use me when a new client form arrives."), "Use me when a new client form arrives.");
  assert.equal(useMeWhen("Scout", "drafts letters"), "drafts letters.");
  assert.match(useMeWhen("Scout", undefined), /@mention Scout/);
  // the first nine lines keep the shape every agent has had, so a diff written against line 9 still applies
  const lines = AGENT_MD_DEFAULT("Intake", "Use me when a form arrives.").split("\n");
  assert.deepEqual(lines.slice(0, 9), ["# Intake", "", "Inherits: VYRE.md", "", "## Use me when", "Use me when a form arrives.", "", "## How I work", "- Say what I did, in a sentence a busy person reads in five seconds."]);
});

test("every default has the four parts, stays well under 150 lines, and carries no em dash or section sign", () => {
  for (const text of [AGENT_MD_DEFAULT("Intake", "Use me when a form arrives."), AGENT_MD_DEFAULT("Scout", undefined), ASSISTANT_AGENT_MD("Irfad’s Assistant")]) {
    for (const head of ["## Use me when", "## How I work", "## What I never do", "## How I speak"]) assert.ok(text.includes(`\n${head}\n`), head);
    const count = text.split("\n").length - 1;
    assert.ok(count >= 20 && count <= 70, `${count} lines`);
    assert.ok(!/[\u2014\u00a7]/.test(text));
  }
  const a = ASSISTANT_AGENT_MD("Irfad’s Assistant");
  for (const habit of ["without asking first", "I ask once", "not the process", "link (#)", "calendar and Needs you", "already have", "tell you when I learned", "hand it over", "Sent by Vyre Assistant", "own AI account"]) assert.ok(a.includes(habit), habit);
});

test("a person's assistant starts with the chief-of-staff AGENT.md under its possessive name, not the role word, and not the Space's starter", async () => {
  const hn = harness();
  hn.world.templateFile("AGENT.md", "# {{name}}\n\nInherits: VYRE.md\n\n## Use me when\n{{role}}\n");
  const [id] = await consumers["agents.ensure_assistant"].run(hn.person(DANA), born(DANA, "Dana Reyes"));
  const text = hn.world.text(mdOf(hn, id!));
  assert.equal(text, ASSISTANT_AGENT_MD("Dana’s Assistant"));
  assert.match(text, /^# Dana’s Assistant\n/);
  assert.notEqual(section(text, "Use me when"), "assistant");
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
