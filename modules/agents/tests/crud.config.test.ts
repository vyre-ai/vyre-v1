// agents: configuration (spec 2.6). Every save of agent.toml or AGENT.md goes through files.save as a version; a broken agent.toml keeps the last good version running; the role line edits in place
// with an inline Undo and is read-only without Edit.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers, consumers } from "../impl.ts";
import { parseToml } from "../projections.ts";
import { DANA, assertEventsConform, contractErrors, failure, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const h = handlers as unknown as Record<string, (ctx: Harness["ctx"], input: any) => Promise<any>>;
let n = 0;
const call = async (hn: Harness, cap: string, input: Record<string, unknown>, ctx: Harness["ctx"] = hn.ctx): Promise<any> => {
  assert.deepEqual(contractErrors(cap, "in", input), [], `${cap}: input`);
  const out = await h[cap]!(ctx, input);
  assert.deepEqual(contractErrors(cap, "out", out), [], `${cap}: output`);
  return out;
};
async function setup(over: Record<string, unknown> = {}) {
  const hn = harness();
  const agent = (await call(hn, "agents.create", { name: "Intake", role: "Use me when a form arrives.", idempotencyKey: `c${++n}`, ...over })).agent;
  const home = hn.world.folderNamed("Intake", hn.world.root)!;
  const toml = hn.world.fileIn(home.folderId, "agent.toml")!;
  const md = hn.world.fileIn(home.folderId, "AGENT.md")!;
  hn.clear();
  return { hn, agent, home, toml, md, id: agent.agentId as string };
}
const watch = consumers["agents.config_watch"];

// ---- update --------------------------------------------------------------------------------------------------------------------------------------------

test("update changes the fields, saves agent.toml as one version, and announces what changed", async () => {
  const { hn, id, toml } = await setup();
  const before = hn.world.files.get(toml.fileId)!.versions.length;
  const out = await call(hn, "agents.update", { agentId: id, patch: {
    model: "claude-opus-4-5", fallbackModel: "claude-sonnet-5-5", toolsAllowed: ["files"], toolsDenied: ["terminal"], vaultKeys: ["#Team_Anthropic_Key"], captureMode: "auto_low_risk",
    limits: { dayCostMicros: 2_000_000, turnsPerDay: 50 }, handoffs: ["Drafter"], face: "new-face",
  } });
  const a = out.agent;
  assert.deepEqual([a.model, a.fallbackModel, a.toolsAllowed, a.toolsDenied, a.vaultKeys, a.captureMode, a.limits, a.face], ["claude-opus-4-5", "claude-sonnet-5-5", ["files"], ["terminal"], ["#Team_Anthropic_Key"], "auto_low_risk", { dayCostMicros: 2_000_000, turnsPerDay: 50 }, "new-face"]);
  assert.equal(hn.world.files.get(toml.fileId)!.versions.length, before + 1, "one save, one version");
  const doc = parseToml(hn.world.text(toml.fileId)).value as any;
  assert.deepEqual([doc.model, doc.fallback_model, doc.tools.allowed, doc.vault.keys, doc.memory.capture, doc.limits.per_day, doc.limits.turns, doc.handoffs], ["claude-opus-4-5", "claude-sonnet-5-5", ["files"], ["#Team_Anthropic_Key"], "auto_low_risk", 2_000_000, 50, ["Drafter"]]);
  const ev = hn.named("agent.config_changed");
  assert.equal(ev.length, 1);
  assert.deepEqual((ev[0]!.payload["fields"] as string[]).sort(), ["captureMode", "face", "fallbackModel", "handoffs", "limits", "model", "toolsAllowed", "toolsDenied", "vaultKeys"]);
  assert.equal(ev[0]!.payload["versionId"], hn.world.files.get(toml.fileId)!.versions.at(-1)!.versionId);
  assert.deepEqual(assertEventsConform(hn), []);
  const cfg = await call(hn, "agents.config.get", { agentId: id });
  assert.equal(cfg.lastGoodVersionId, ev[0]!.payload["versionId"]);
});

test("update with a face only, or with nothing, saves no file and announces only what changed", async () => {
  const { hn, id, toml } = await setup();
  const before = hn.world.files.get(toml.fileId)!.versions.length;
  await call(hn, "agents.update", { agentId: id, patch: { face: "other" } });
  assert.equal(hn.world.files.get(toml.fileId)!.versions.length, before, "the face is not in agent.toml");
  hn.clear();
  await call(hn, "agents.update", { agentId: id, patch: {} });
  assert.deepEqual(hn.names(), []);
});

test("update refuses what cannot be changed here, what is not a field, and what would not pass; nothing is half applied", async () => {
  const { hn, id, toml } = await setup();
  const bad = (patch: Record<string, unknown>, code: string, label: string) => failure(() => call(hn, "agents.update", { agentId: id, patch })).then((c) => assert.equal(c, code, label));
  for (const k of ["ownerId", "folderId", "status", "templateVersion", "createdAt", "hasComputer", "agentId"]) await bad({ [k]: "x", model: "m" }, "validation.field_locked", `${k} is locked`);
  await bad({ colour: "red" }, "validation.bad_input", "unknown field");
  await bad({ name: "a/b" }, "validation.bad_input", "bad name");
  await bad({ role: "two\nlines" }, "validation.bad_input", "role one line");
  await bad({ role: "x".repeat(201) }, "validation.bad_input", "role length");
  await bad({ model: 5 }, "validation.bad_input", "model text");
  await bad({ toolsAllowed: "files" }, "validation.bad_input", "list");
  await bad({ limits: { dayCostMicros: -1 } }, "validation.bad_input", "negative limit");
  await bad({ limits: { invented: 1 } }, "validation.bad_input", "unknown limit");
  await bad({ captureMode: "everything" }, "validation.bad_input", "capture");
  await bad({ accountPolicy: "key" }, "validation.bad_input", "key policy needs a key");
  await bad({ accountPolicy: "key", accountKey: "no-hash" }, "validation.bad_input", "key is a Vault name");
  await bad({ model: "ok", limits: { dayCostMicros: -1 } }, "validation.bad_input", "a good field next to a bad one");
  assert.equal(hn.world.files.get(toml.fileId)!.versions.length, 1, "no version was made by any of these");
  assert.equal((await call(hn, "agents.get", { agentId: id })).agent.model, undefined);
  assert.deepEqual(hn.names(), []);
  const keyed = await call(hn, "agents.update", { agentId: id, patch: { accountPolicy: "key", accountKey: "#Team_Anthropic_Key" } });
  assert.deepEqual([keyed.agent.accountPolicy, keyed.agent.accountKey], ["key", "#Team_Anthropic_Key"]);
  assert.equal(await failure(() => call(hn, "agents.update", { agentId: id, patch: { accountPolicy: "asker" } })), "none", "back to the asker's account");
});

test("a rename renames the folder, is unique among agents, and the old name is free", async () => {
  const { hn, id, home } = await setup();
  await call(hn, "agents.create", { name: "Drafter", idempotencyKey: "d1" });
  assert.equal(await failure(() => call(hn, "agents.update", { agentId: id, patch: { name: "drafter" } })), "validation.bad_input");
  const out = await call(hn, "agents.update", { agentId: id, patch: { name: "Front Desk" } });
  assert.equal(out.agent.name, "Front Desk");
  assert.equal(hn.world.folders.get(home.folderId)!.name, "Front Desk");
  assert.equal((await call(hn, "agents.list", {})).agents.some((a: any) => a.name === "Intake"), false);
  await call(hn, "agents.create", { name: "Intake", idempotencyKey: "d2" });
  hn.world.answer("files.folder.rename", () => { throw Object.assign(new Error("exists"), { error: { code: "validation.duplicate" } }); });
  assert.equal(await failure(() => call(hn, "agents.update", { agentId: id, patch: { name: "Other" } })), "validation.bad_input", "a taken folder name is the same refusal");
});

test("without Edit an agent can be read and not changed", async () => {
  const { hn, id } = await setup();
  hn.allowOnly((a) => a.level === "view");
  assert.equal((await call(hn, "agents.get", { agentId: id })).agent.name, "Intake");
  assert.equal(await failure(() => call(hn, "agents.update", { agentId: id, patch: { model: "m" } })), "permission.no_grant");
  assert.equal(await failure(() => call(hn, "agents.role_line.set", { agentId: id, description: "x" })), "permission.no_grant");
  assert.equal(await failure(() => call(hn, "agents.restore_version", { agentId: id, versionId: "ver_000001" })), "permission.no_grant");
});

// ---- the role line ----------------------------------------------------------------------------------------------------------------------------------

test("the role line edits agent.toml in place and hands back the version Undo goes to; Undo restores it", async () => {
  const { hn, id, toml } = await setup();
  const v1 = hn.world.files.get(toml.fileId)!.versions[0]!;
  const out = await call(hn, "agents.role_line.set", { agentId: id, description: "Use me for new matters." });
  assert.equal(out.agent.role, "Use me for new matters.");
  assert.equal(out.undoVersionId, v1.versionId, "the version before the edit");
  assert.equal((parseToml(hn.world.text(toml.fileId)).value as any).description, "Use me for new matters.");
  assert.equal(hn.world.files.get(toml.fileId)!.versions.length, 2);
  assert.deepEqual(hn.named("agent.config_changed")[0]!.payload["fields"], ["role"]);
  assert.deepEqual(assertEventsConform(hn), []);

  // Undo is one call: the old text comes back as a new version, and the agent reads as it did.
  const undone = await call(hn, "agents.restore_version", { agentId: id, versionId: out.undoVersionId, file: "agent.toml" });
  assert.equal(undone.agent.role, "Use me when a form arrives.");
  assert.equal((parseToml(hn.world.text(toml.fileId)).value as any).description, "Use me when a form arrives.");
  assert.equal(hn.world.files.get(toml.fileId)!.versions.length, 3, "undo adds a version; nothing is lost");
  assert.equal(hn.named("agent.config_changed").length, 2);
});

test("a role line that is already the role line saves nothing; it is one line of up to 200 characters; empty clears it", async () => {
  const { hn, id, toml } = await setup();
  hn.clear();
  const same = await call(hn, "agents.role_line.set", { agentId: id, description: "  Use me when a form arrives.  " });
  assert.equal(same.undoVersionId, hn.world.files.get(toml.fileId)!.versions[0]!.versionId);
  assert.equal(hn.world.files.get(toml.fileId)!.versions.length, 1);
  assert.deepEqual(hn.names(), []);
  assert.equal(await failure(() => call(hn, "agents.role_line.set", { agentId: id, description: "two\nlines" })), "validation.bad_input");
  const cleared = await call(hn, "agents.role_line.set", { agentId: id, description: "" });
  assert.equal(cleared.agent.role, undefined);
  assert.equal((parseToml(hn.world.text(toml.fileId)).value as any).description, undefined);
});

// ---- a broken agent.toml keeps the last good one running ----------------------------------------------------------------------------------

test("a person saves agent.toml with an error in Files: the last good version keeps running and the error is announced and shown", async () => {
  const { hn, id, toml } = await setup({ model: "claude-sonnet-5-5" });
  const broken = hn.world.edit(toml.fileId, 'name = "Intake"\nmodel = claude-opus\n');
  const touched = await watch.run(hn.ctx, broken);
  assert.deepEqual(touched, [id]);
  const ev = hn.named("agent.config_error");
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0]!.payload, { agentId: id, message: '"claude-opus" is not a value; text needs quotes.', line: 2 });
  assert.deepEqual(assertEventsConform(hn), []);
  const agent = (await call(hn, "agents.get", { agentId: id })).agent;
  assert.equal(agent.model, "claude-sonnet-5-5", "the last good version is what runs");
  const cfg = await call(hn, "agents.config.get", { agentId: id });
  assert.deepEqual(cfg.error, { line: 2, message: '"claude-opus" is not a value; text needs quotes.' });
  assert.equal(cfg.effective.model, "claude-sonnet-5-5");

  // The person fixes it: the new text is the configuration, the error is gone.
  hn.clear();
  const fixed = hn.world.edit(toml.fileId, 'name = "Intake"\ndescription = "Use me."\nmodel = "claude-opus-4-5"\n');
  await watch.run(hn.ctx, fixed);
  assert.deepEqual(hn.names(), ["agent.config_changed"]);
  assert.deepEqual(hn.named("agent.config_changed")[0]!.payload["fields"], ["role", "model"]);
  assert.equal((await call(hn, "agents.get", { agentId: id })).agent.model, "claude-opus-4-5");
  assert.equal((await call(hn, "agents.config.get", { agentId: id })).error, undefined);
  await watch.run(hn.ctx, fixed);
  assert.equal(hn.named("agent.config_changed").length, 1, "the same event twice changes nothing twice");
});

test("config.get reads the file as it is now: a broken edit is reported before any event arrives, a valid one is already the effective one", async () => {
  const { hn, id, toml } = await setup({ model: "claude-sonnet-5-5" });
  hn.world.edit(toml.fileId, "name = \n");
  const broken = await call(hn, "agents.config.get", { agentId: id });
  assert.equal(broken.error.line, 1);
  assert.equal(broken.effective.model, "claude-sonnet-5-5");
  hn.world.edit(toml.fileId, 'name = "Intake"\nmodel = "claude-haiku-4-5"\n');
  const good = await call(hn, "agents.config.get", { agentId: id });
  assert.equal(good.error, undefined);
  assert.equal(good.effective.model, "claude-haiku-4-5");
});

test("a change to AGENT.md is announced with the file name; an unknown file is nobody's", async () => {
  const { hn, id, md } = await setup();
  const ev = hn.world.edit(md.fileId, "# Intake\n\nInherits: VYRE.md\n\nNew line.\n");
  assert.deepEqual(await watch.run(hn.ctx, ev), [id]);
  assert.deepEqual(hn.named("agent.config_changed")[0]!.payload["fields"], ["AGENT.md"]);
  const lines = (await call(hn, "agents.config.get", { agentId: id })).lines;
  assert.equal(lines.agentMd, 5);
  assert.deepEqual(await watch.run(hn.ctx, { payload: { fileId: "fil_nothing", versionId: "ver_x", n: 1, by: DANA } }), []);
});

test("agents.config.validate checks a text without saving it and says what it would widen", async () => {
  const { hn, id, toml } = await setup({ tools: { allowed: ["files"], denied: ["terminal"] }, limits: { dayCostMicros: 1_000_000 } });
  const okText = 'name = "Intake"\naccount_policy = "asker"\nhandoffs = []\n\n[tools]\nallowed = ["files", "browser"]\ndenied = []\n\n[vault]\nkeys = ["#Stripe"]\n\n[limits]\nper_day = 5000000\n';
  const r = await call(hn, "agents.config.validate", { agentId: id, toml: okText });
  assert.equal(r.ok, true);
  assert.deepEqual(r.widens.sort(), ["limits.per_day goes from 1000000 to 5000000", "tools.allowed adds browser", "tools.denied no longer denies terminal", "vault.keys adds #Stripe"].sort());
  const bad = await call(hn, "agents.config.validate", { agentId: id, toml: 'name = "x"\n[limits]\nper_day = -5\nunknown = 1\n' });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e: any) => [e.line, e.message]), [[3, "limits.per_day is a number, zero or more."], [4, "limits.unknown is not a limit and is ignored."]]);
  assert.deepEqual(bad.widens, []);
  const warn = await call(hn, "agents.config.validate", { agentId: id, toml: 'name = "Intake"\nhandoffs = ["Nobody"]\nweird = 1\n' });
  assert.equal(warn.ok, true, "warnings do not stop a save");
  assert.deepEqual(warn.errors.map((e: any) => e.message), ["weird is not a field of agent.toml and is ignored."]);
  assert.equal(hn.world.files.get(toml.fileId)!.versions.length, 1, "nothing was saved");
  for (const t of ['name = "a"\ndescription = "two\\nlines"\n', "name = 5\n", 'name = "a"\nmodel = 5\n', 'name = "a"\naccount_policy = "both"\n', 'name = "a"\n[memory]\ncapture = "x"\n']) assert.equal((await call(hn, "agents.config.validate", { agentId: id, toml: t })).ok, false, t);
});

// ---- limits, snapshots, versions --------------------------------------------------------------------------------------------------------------

test("limits: agent.toml can never exceed a Space or person cap, and the answer says whose limit applies", async () => {
  const { hn, id } = await setup({ limits: { dayCostMicros: 9_000_000, monthCostMicros: 50_000_000, turnsPerDay: 100, tokensPerDay: 1_000_000 } });
  hn.world.answer("engine.spend.get", (i: any) => ({ caps: i.scope === "space" ? { dayMicros: 5_000_000, turnsPerDay: 200, timeMinutesPerRun: 30 } : { monthMicros: 20_000_000 }, todayMicros: 0, monthMicros: 0, turnsToday: 0, paused: false }));
  const r = await call(hn, "agents.limits.get", { agentId: id });
  assert.deepEqual(r.limits, { dayCostMicros: 5_000_000, monthCostMicros: 20_000_000, turnsPerDay: 100, minutesPerRun: 30, tokensPerDay: 1_000_000 });
  assert.deepEqual(r.source, { per_day: "space", per_month: "person", turns: "agent", minutes: "space", tokens: "agent" });
  const none = await setup();
  none.hn.world.answer("engine.spend.get", () => { throw new Error("engine is down"); });
  assert.deepEqual((await call(none.hn, "agents.limits.get", { agentId: none.id })).limits, {}, "without the engine only the agent's own limits count, and there are none");
});

test("a snapshot is the files as they were when a run started: changes apply between runs", async () => {
  const { hn, id, toml } = await setup({ model: "claude-sonnet-5-5" });
  const s1 = await call(hn, "agents.snapshot.take", { agentId: id, runId: "run_a1" });
  assert.equal(s1.version, 1);
  assert.deepEqual(await call(hn, "agents.snapshot.take", { agentId: id, runId: "run_a1" }), s1, "the same run asks again, gets the same snapshot");
  assert.deepEqual(await call(hn, "agents.snapshot.take", { agentId: id }), s1, "nothing changed and no run asked for its own: the same snapshot serves");
  const row = hn.rows("SELECT * FROM agents_snapshot WHERE id = ?", s1.snapshotId)[0]!;
  assert.equal(JSON.parse(String(row["config"])).model, "claude-sonnet-5-5");
  assert.equal(row["tomlVersionId"], hn.world.files.get(toml.fileId)!.versions.at(-1)!.versionId);
  await call(hn, "agents.update", { agentId: id, patch: { model: "claude-opus-4-5" } });
  const s2 = await call(hn, "agents.snapshot.take", { agentId: id, runId: "run_a2" });
  assert.equal(s2.version, 2);
  assert.equal(JSON.parse(String(hn.rows("SELECT config FROM agents_snapshot WHERE id = ?", s1.snapshotId)[0]!["config"])).model, "claude-sonnet-5-5", "the first run's snapshot did not move");
  // Unchanged files and no run: the latest snapshot serves.
  const again = await call(hn, "agents.snapshot.take", { agentId: id });
  assert.deepEqual(again, s2);
});

test("versions lists the agent's files newest first, one file or both; restore brings an old version back as a new one", async () => {
  const { hn, id, toml, md } = await setup();
  await call(hn, "agents.update", { agentId: id, patch: { model: "m1" } });
  hn.advance(1000);
  hn.world.edit(md.fileId, "# Intake\n\nInherits: VYRE.md\n\nOne more.\n");
  hn.advance(1000);
  await call(hn, "agents.update", { agentId: id, patch: { model: "m2" } });
  const all = (await call(hn, "agents.versions", { agentId: id })).versions;
  assert.equal(all.length, 5);
  assert.deepEqual(all.map((v: any) => v.at), [...all.map((v: any) => v.at)].sort((x: number, y: number) => y - x));
  const tomlOnly = (await call(hn, "agents.versions", { agentId: id, file: "agent.toml" })).versions;
  assert.equal(tomlOnly.length, 3);
  assert.equal((await call(hn, "agents.versions", { agentId: id, file: "AGENT.md" })).versions.length, 2);

  const m1 = tomlOnly.find((v: any) => v.n === 2)!;
  hn.clear();
  const back = await call(hn, "agents.restore_version", { agentId: id, versionId: m1.versionId });
  assert.equal(back.agent.model, "m1");
  assert.equal(hn.world.files.get(toml.fileId)!.versions.length, 4, "restore adds a version");
  assert.deepEqual(hn.named("agent.config_changed")[0]!.payload["fields"], ["model"]);
  assert.deepEqual(assertEventsConform(hn), []);
  const first = (await call(hn, "agents.versions", { agentId: id, file: "AGENT.md" })).versions.at(-1)!;
  const mdBack = await call(hn, "agents.restore_version", { agentId: id, versionId: first.versionId });
  assert.equal(mdBack.agent.name, "Intake");
  assert.deepEqual(hn.named("agent.config_changed").at(-1)!.payload["fields"], ["AGENT.md"]);
  assert.equal(await failure(() => call(hn, "agents.restore_version", { agentId: id, versionId: "ver_zzzzzz" })), "validation.not_found");
});

test("an old version that would not pass today is not restored: the last good configuration keeps running", async () => {
  const { hn, id, toml } = await setup({ model: "claude-sonnet-5-5" });
  hn.world.edit(toml.fileId, "name = \n");
  const old = hn.world.files.get(toml.fileId)!.versions.at(-1)!;
  hn.world.edit(toml.fileId, 'name = "Intake"\nmodel = "m9"\n');
  hn.clear();
  assert.equal(await failure(() => call(hn, "agents.restore_version", { agentId: id, versionId: old.versionId })), "validation.bad_input");
  assert.equal(hn.world.files.get(toml.fileId)!.versions.length, 3, "nothing was restored");
  assert.deepEqual(hn.names(), []);
});

test("summary assembles the strip from the neighbours and survives any of them being down", async () => {
  const { hn, id } = await setup({ limits: { dayCostMicros: 3_000_000 } });
  hn.world.answer("threads.list", () => ({ threads: [{ agents: [{ agentId: id }], createdAt: hn.clock.t - 3600_000 }, { agents: [{ agentId: id }], createdAt: hn.clock.t - 9 * 86_400_000 }, { agents: [{ agentId: "agt_other" }], createdAt: hn.clock.t }] }));
  hn.world.answer("tasks.list", () => ({ tasks: [{ id: "tsk_a1", title: "Draft the letter", state: "doing" }, { id: "tsk_a2", title: "Check the form", state: "todo" }, { id: "tsk_a3", title: "Old", state: "done" }] }));
  hn.world.answer("runs.list", () => ({ runs: [{ id: "run_a1", name: "Intake flow", status: "running" }, { id: "run_a2", status: "succeeded" }] }));
  hn.world.answer("engine.spend.get", () => ({ todayMicros: 1_250_000 }));
  hn.world.answer("memory.counts", () => ({ current: 12, proposed: 3, fromMe: 1 }));
  await call(hn, "agents.routine.save", { agentId: id, title: "Digest", cron: "0 9 * * *", prompt: "Summarise", channelId: "chn_intake", idempotencyKey: "r1" });
  const s = await call(hn, "agents.summary", { agentId: id });
  assert.deepEqual({ ...s, workingOn: undefined, linked: undefined }, {
    chatsThisWeek: 1, openTasks: 2, runsToday: 2, spendTodayMicros: 1_250_000, spendLimitMicros: 3_000_000, memoryFacts: 12, proposedFacts: 3, watches: ["chn_intake"], workingOn: undefined, linked: undefined,
  });
  assert.deepEqual(s.workingOn, [{ kind: "task", id: "tsk_a1", title: "Draft the letter" }, { kind: "run", id: "run_a1", title: "Intake flow" }]);
  assert.deepEqual(s.linked, [{ kind: "task", id: "tsk_a2", title: "Check the form" }]);
  const down = await setup();
  const d = await call(down.hn, "agents.summary", { agentId: down.id });
  assert.deepEqual([d.chatsThisWeek, d.openTasks, d.runsToday, d.spendTodayMicros, d.memoryFacts, d.proposedFacts, d.workingOn, d.linked, d.watches], [0, 0, 0, 0, 0, 0, [], [], []]);
});
