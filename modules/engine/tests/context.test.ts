// The turn context builder (modules/engine/context.ts): every read is made as the asker, a read that fails or refuses leaves its section out and never holds the turn, names replace ids,
// the screen comes from the message that caused the turn, and nothing in the context is a secret value.
import test from "node:test";
import assert from "node:assert/strict";
import { SKILL_INDEX_MAX, capabilitySkills, createContextBuilder, diskSkills, routineLine, timeLine, withTurnContext } from "../context.ts";
import type { SkillsPort } from "../context.ts";
import type { StoredMessage, TurnInput } from "../../../agent/src/turn-engine/types.ts";
import type { EngineSession, OpenSession } from "../../../agent/src/turn-engine/types.ts";

type Answer = unknown | ((input: unknown) => unknown);
function fake(answers: Record<string, Answer>) {
  const log: Array<{ cap: string; input: unknown; as?: string | undefined }> = [];
  const call = async (cap: string, input: unknown, as?: string): Promise<unknown> => {
    log.push({ cap, input, as });
    const a = answers[cap];
    if (a === undefined) throw new Error(`no such capability ${cap}`);
    return typeof a === "function" ? (a as (i: unknown) => unknown)(input) : a;
  };
  return { call, log };
}
const msg = (id: string, who: string, kind: "person" | "agent", body: string, extra: Record<string, unknown> = {}): StoredMessage => ({ id, threadId: "thr_1", threadSeq: 1, author: { kind, id: who }, mentions: [], depth: 0, body, ...extra } as StoredMessage);
const input = (over: Partial<TurnInput> = {}): TurnInput => ({
  threadId: "thr_1", turnId: "trn_1", agent: { id: "agt_intake", mode: "lead" }, trigger: msg("m1", "usr_maya", "person", "hello"), history: [], listeners: [], asker: "usr_maya", ...over,
});
const FULL = {
  "agents.get": { agent: { agentId: "agt_intake", name: "Intake", role: "You answer intake questions.", folderId: "fld_1", toolsAllowed: [], toolsDenied: ["mail_send"], vaultKeys: ["Dana_Lawmatics"], hasComputer: true, limits: { turnsPerDay: 100 } } },
  "files.list": { files: [{ fileId: "fil_md", name: "AGENT.md" }] },
  "files.read": { text: "# Intake\nBe brief." },
  "threads.get": { thread: { kind: "chat", title: "Intake desk", members: [{ kind: "person", id: "usr_maya" }, { kind: "person", id: "usr_omar" }], agents: [{ agentId: "agt_intake", mode: "lead" }, { agentId: "agt_docs", mode: "listen" }], planMode: false } },
  "access.principals.list": { principals: [{ id: "usr_maya", kind: "person", name: "Maya Chen" }, { id: "usr_omar", kind: "person", name: "Omar Haddad" }, { id: "agt_docs", kind: "agent", name: "Docs" }] },
  "spaces.get": { space: { name: "Northwind", kind: "team" } },
  "agents.routines.list": { routines: [{ routineId: "rtn_1", title: "Overdue invoices", cron: "0 4 * * 1", enabled: true, nextRunAt: Date.UTC(2026, 10, 2, 4, 0) }, { routineId: "rtn_2", title: "Triage", kind: "watch", watch: { on: "message", channelId: "chn_9" }, enabled: false }] },
  "settings.get": { row: { value: "Asia/Karachi" } },
  "computers.list": { computers: [{ computerId: "cmt_1", agentId: "agt_intake", state: "asleep", tabs: 0 }] },
};
const skills: SkillsPort = {
  async index() { return [{ name: "working-in-vyre", description: "How an agent works inside Vyre.", tier: "builtin" }, { name: "focus-records", description: "Work in Records.", tier: "builtin" }]; },
  async load(name) { return name === "focus-records" ? { name, body: "Describe the type first." } : name === "working-in-vyre" ? { name, body: "# Working in Vyre\nThe manual." } : null; },
};
const at = Date.UTC(2026, 9, 29, 22, 7);

test("what is in the agent's context folder is always in its identity, read as the asker", async () => {
  const f = fake({
    ...FULL,
    "files.list": (i: unknown) => ((i as { folder: string }).folder === "fld_ctx" ? { files: [{ fileId: "fil_rates", name: "rates.md" }] } : { files: [{ fileId: "fil_md", name: "AGENT.md" }], folders: [{ folderId: "fld_ctx", name: "context" }] }),
    "files.read": (i: unknown) => ((i as { fileId: string }).fileId === "fil_rates" ? { text: "Our rate is 200 an hour." } : { text: "# Intake\nBe brief." }),
  });
  const ctx = await createContextBuilder({ call: f.call, skills, now: () => at }).build(input());
  const identity = ctx.sections.find((s) => s.id === "identity")?.text ?? "";
  assert.match(identity, /What you always know \(your context folder\):\nrates\.md:\nOur rate is 200 an hour\./);
  assert.ok(f.log.filter((l) => l.cap === "files.read").every((l) => l.as === "usr_maya"));
});

test("the context holds identity, where, skills, what the agent can do and the time, from reads made as the asker", async () => {
  const f = fake(FULL);
  const ctx = await createContextBuilder({ call: f.call, skills, now: () => at }).build(input());
  const text = (id: string): string => ctx.sections.find((s) => s.id === id)?.text ?? "";
  assert.match(text("identity"), /^You are Intake \(agentId agt_intake\), an agent in Vyre\. You answer intake questions\./);
  assert.match(text("identity"), /Your AGENT\.md:\n# Intake\nBe brief\./);
  assert.doesNotMatch(text("identity"), /your context folder/, "no context folder, no line");
  assert.match(text("where"), /Space: Northwind \(team\)\./);
  assert.match(text("where"), /threadId thr_1\. This is a chat called "Intake desk"\./);
  assert.match(text("where"), /talking with Maya Chen \(usr_maya; /);
  assert.match(text("where"), /Also here: Omar Haddad\./);
  assert.match(text("where"), /Agents here: Docs \(answers when mentioned[^)]*\)\. To hand something to one, @mention it by name/);
  assert.match(text("skills"), /^Working in Vyre \(always loaded\):\n# Working in Vyre\nThe manual\./);
  assert.match(text("skills"), /load it with load_skill \{name\}[^\n]*:\n- focus-records: Work in Records\./, "the index names the tool that loads every tier");
  assert.doesNotMatch(text("skills"), /agents_builtin_skill_get/);
  assert.doesNotMatch(text("skills"), /- working-in-vyre:/, "the manual is not also listed as a skill to load");
  assert.match(text("can"), /Tools you may not use: mail_send\./);
  assert.match(text("can"), /#Dana_Lawmatics/);
  assert.match(text("can"), /agents_routine_save/);
  assert.match(text("can"), /- schedule "Overdue invoices" cron "0 4 \* \* 1", next 2026-11-02 04:00 UTC \(rtn_1\)/);
  assert.match(text("can"), /- watcher "Triage" on each new message in chn_9, paused \(rtn_2\)/);
  assert.match(text("can"), /Your computer is asleep, 0 tabs open\./);
  assert.match(text("now"), /^It is (Thursday, 29 October 2026, 22:07|Friday, 30 October 2026, 03:07) \(Asia\/Karachi\)\. That is UTC\+5\..*time_convert/);
  assert.equal(ctx.names["usr_omar"], "Omar Haddad");
  for (const c of f.log) assert.equal(c.as, "usr_maya", `${c.cap} is read as the asker`);
});

test("a read that fails or is refused leaves its section out and the rest is still there", async () => {
  const f = fake({ "agents.get": FULL["agents.get"], "threads.get": FULL["threads.get"] });
  const ctx = await createContextBuilder({ call: f.call, now: () => at }).build(input());
  const ids = ctx.sections.map((s) => s.id);
  assert.ok(ids.includes("identity") && ids.includes("where") && ids.includes("can") && ids.includes("now"));
  assert.ok(!ids.includes("skills") && !ids.includes("screen") && !ids.includes("focus"));
  assert.match(ctx.sections.find((s) => s.id === "where")!.text, /Also here: a teammate\./, "an unknown person is not shown as a raw id");
});

test("no reads at all still gives the agent who it is, from the turn input", async () => {
  const ctx = await createContextBuilder({ call: fake({}).call, now: () => at }).build(input({ agent: { id: "agt_intake", name: "Intake", role: "You answer intake questions.", mode: "lead" } }));
  assert.match(ctx.sections.find((s) => s.id === "identity")!.text, /^You are Intake \(agentId agt_intake\), an agent in Vyre\. You answer intake questions\./);
});

test("a slow read gives up after readMs and never holds the turn", async () => {
  const slow = async (): Promise<unknown> => new Promise(() => {});
  const t0 = Date.now();
  // The read timer is unref'd so it never holds a process open; a live host keeps the loop running, so the test does too.
  const alive = setInterval(() => undefined, 1_000);
  const ctx = await createContextBuilder({ call: slow, now: () => at, readMs: 30 }).build(input()).finally(() => clearInterval(alive));
  assert.ok(Date.now() - t0 < 2_000);
  assert.ok(ctx.sections.some((s) => s.id === "identity"));
});

test("the screen is read as the asker for the message that caused the turn, and its place picks the focus skill", async () => {
  const screen = { place: "records", title: "Contacts", open: [{ type: "record", id: "rec_1", title: "Maya Chen" }], rows: { shown: 25, total: 137 } };
  const f = fake({ ...FULL, "chat.screen.get": (i: unknown) => ((i as { messageId?: string }).messageId === "m2" ? { screen, messageId: "m2" } : { screen: null }) });
  const ctx = await createContextBuilder({ call: f.call, skills, now: () => at }).build(input({ trigger: msg("m2", "usr_maya", "person", "how many?") }));
  assert.match(ctx.sections.find((s) => s.id === "screen")!.text, /The person is in records, on "Contacts"\./);
  assert.equal(ctx.sections.find((s) => s.id === "focus")?.text, "focus-records\nDescribe the type first.");
  assert.equal(ctx.screen?.place, "records");
  const read = f.log.find((c) => c.cap === "chat.screen.get")!;
  assert.deepEqual(read.input, { threadId: "thr_1", messageId: "m2" });
  assert.equal(read.as, "usr_maya");
  const none = await createContextBuilder({ call: f.call, skills, now: () => at }).build(input({ trigger: msg("m9", "usr_maya", "person", "hi") }));
  assert.ok(!none.sections.some((s) => s.id === "screen" || s.id === "focus"), "a message sent without a screen has none");
});

test("a message that asks about Vyre itself loads about-vyre beside the place's focus, for that turn only; the Vyre skill on disk is the one loaded", async () => {
  const withAbout: SkillsPort = {
    async index() { return [...(await skills.index("agt_intake", "usr_maya")), { name: "about-vyre", description: "Load when someone asks about Vyre itself.", tier: "builtin" }]; },
    async load(name, agentId, asker) { return name === "about-vyre" ? diskSkills().load(name, agentId, asker) : skills.load(name, agentId, asker); },
  };
  const screen = { place: "records", title: "Contacts" };
  const f = fake({ ...FULL, "chat.screen.get": { screen } });
  const build = (body: string, kind: "person" | "agent" = "person") => createContextBuilder({ call: f.call, skills: withAbout, now: () => at }).build(input({ trigger: msg("m3", kind === "person" ? "usr_maya" : "agt_docs", kind, body) }));
  for (const asked of ["What do you think about Vyre?", "I am looking at it as a replacement for my Claude CLI and Codex CLI for long running development sessions and general project management", "Does Vyre support Codex?"]) {
    const ctx = await build(asked);
    const about = ctx.sections.find((s) => s.id === "about");
    assert.ok(about, asked);
    assert.match(about.text, /^# About Vyre/);
    assert.match(about.text, /Claude Code, Codex and Grok/);
    assert.deepEqual([about.stable, about.once], [false, true], "kept out of the cached prefix, and sent to a resumed CLI session once until it changes");
    assert.equal(ctx.sections.find((s) => s.id === "focus")?.text, "focus-records\nDescribe the type first.", "the place's focus stays");
  }
  assert.equal((await build("how many contacts came in this week?")).sections.some((s) => s.id === "about"), false, "an ordinary ask does not load it");
  assert.equal((await build("What do you think about Vyre?", "agent")).sections.some((s) => s.id === "about"), false, "an agent's message does not load it");
});

test("a turn woken without a message asks for the newest screen of the thread", async () => {
  const f = fake({ ...FULL, "chat.screen.get": { screen: { place: "files", title: "Policies" }, messageId: "m1" } });
  const ctx = await createContextBuilder({ call: f.call, skills, now: () => at }).build(input({ trigger: null }));
  assert.match(ctx.sections.find((s) => s.id === "screen")!.text, /in files/);
  assert.deepEqual(f.log.find((c) => c.cap === "chat.screen.get")!.input, { threadId: "thr_1" });
});

test("what the agent waits on is said", async () => {
  const ctx = await createContextBuilder({ call: fake(FULL).call, now: () => at, waiting: () => ["an answer to task tsk_1 (a held call needs approval)"] }).build(input());
  assert.equal(ctx.sections.find((s) => s.id === "waiting")?.text, "- an answer to task tsk_1 (a held call needs approval)");
});

test("slow-changing reads are kept for a short while: the same asker's names are read once", async () => {
  const f = fake(FULL);
  let clock = at;
  const b = createContextBuilder({ call: f.call, now: () => clock, cacheMs: 1_000 });
  await b.build(input());
  await b.build(input());
  assert.equal(f.log.filter((c) => c.cap === "access.principals.list").length, 1);
  clock += 2_000;
  await b.build(input());
  assert.equal(f.log.filter((c) => c.cap === "access.principals.list").length, 2);
});

test("no secret value is read: the Vault appears by item name only, and no vault capability is called", async () => {
  const f = fake(FULL);
  await createContextBuilder({ call: f.call, skills, now: () => at }).build(input());
  assert.ok(!f.log.some((c) => c.cap.startsWith("vault.")), JSON.stringify(f.log.map((c) => c.cap)));
});

test("timeLine says the weekday, the date and the zone, and falls back to UTC for a zone it does not know", () => {
  assert.match(timeLine(Date.UTC(2026, 9, 29, 22, 7), "UTC"), /^It is Thursday, 29 October 2026, 22:07 \(UTC\)\. That is UTC\+0\. The person's time zone is UTC: say times in it\./);
  assert.match(timeLine(Date.UTC(2026, 9, 29, 22, 7), "Not/AZone"), /^It is Thursday, 29 October 2026, 22:07 \(UTC\)\./);
  const pkt = timeLine(Date.UTC(2026, 9, 29, 22, 7), "Asia/Karachi");
  assert.match(pkt, /^It is Friday, 30 October 2026, 03:07 \(Asia\/Karachi\)\. That is UTC\+5\. The person's time zone is Asia\/Karachi/);
  assert.match(pkt, /call time_convert; never work out zones, dates or epoch numbers yourself/);
  assert.match(timeLine(Date.UTC(2026, 9, 29, 22, 7), "Asia/Kolkata"), /That is UTC\+5:30\./);
});

test("a routine line says its kind, when it runs and whether it is paused", () => {
  assert.equal(routineLine({ routineId: "rtn_1", title: "A", cron: "0 4 * * 1", enabled: true }), '- schedule "A" cron "0 4 * * 1" (rtn_1)');
  assert.equal(routineLine({ routineId: "rtn_2", title: "B", kind: "watch", watch: { channelId: "chn_1" }, enabled: false }), '- watcher "B" on each new message in chn_1, paused (rtn_2)');
});

test("the built-in skills on disk are indexed and one loads by name", async () => {
  const port = diskSkills();
  const idx = await port.index("agt_x", "usr_x");
  const names = idx.map((s) => s.name);
  for (const n of ["working-in-vyre", "focus-records", "focus-files", "focus-automations", "focus-vault", "focus-inbox", "focus-apps", "focus-console", "agent-loops", "agent-computer", "about-vyre"]) assert.ok(names.includes(n), n);
  assert.ok(idx.every((s) => s.description.length > 20 && s.tier === "builtin"));
  const loaded = await port.load("focus-vault", "agt_x", "usr_x");
  assert.match(loaded!.body, /You never see a value/);
  assert.equal(await port.load("nope", "agt_x", "usr_x"), null);
});

test("withTurnContext puts the context on the input of every send, and a builder that throws sends the input unchanged", async () => {
  const seen: TurnInput[] = [];
  const open: OpenSession = async () => ({ warm: true, async *send(i: TurnInput) { seen.push(i); yield { type: "done" as const }; }, sendToolResult() {}, inject() {}, async cancel() {}, async close() {} }) as EngineSession;
  const ok = await withTurnContext(open, createContextBuilder({ call: fake(FULL).call, now: () => at }))({} as never);
  for await (const _ of ok.send(input())) void _;
  assert.ok(seen[0]!.context && seen[0]!.context.sections.length > 3);
  const bad = await withTurnContext(open, { build: async () => { throw new Error("boom"); } })({} as never);
  for await (const _ of bad.send(input())) void _;
  assert.equal(seen[1]!.context, undefined);
});

test("a chat's reviewer is told it is the reviewer, and the lead is told its work is checked", async () => {
  const f = (id: string) => fake({ ...FULL, "engine.reviewer.get": { reviewer: { kind: "agent", id } } });
  const asReviewer = await createContextBuilder({ call: f("agt_intake").call, now: () => at }).build(input());
  assert.match(asReviewer.sections.find((s) => s.id === "where")!.text, /You are the reviewer of this chat\. When you are asked, read the lead agent's last answer/);
  const asLead = await createContextBuilder({ call: f("agt_docs").call, now: () => at }).build(input());
  assert.match(asLead.sections.find((s) => s.id === "where")!.text, /Docs reviews the work done here before it counts\./);
  const none = await createContextBuilder({ call: fake({ ...FULL, "engine.reviewer.get": { reviewer: null } }).call, now: () => at }).build(input());
  assert.doesNotMatch(none.sections.find((s) => s.id === "where")!.text, /review/i);
});

// ---- the connector builder skill

const withConnector: SkillsPort = {
  async index() {
    return [
      { name: "working-in-vyre", description: "How an agent works inside Vyre.", tier: "builtin" },
      { name: "focus-vault", description: "Work in the Vault.", tier: "builtin" },
      { name: "crm-sync-builder", description: "Bring a CRM into Records.", tier: "builtin" },
      { name: "connector-builder", description: "Connect an app or API to Automations: hook up an app, use a key in a flow. Finds docs, offers actions, tests reads.", tier: "builtin" },
    ];
  },
  async load(name) { return name === "crm-sync-builder" ? { name, body: "# CRM sync builder\nDiscover first." } : name === "connector-builder" ? { name, body: "# Connector builder\nFind the docs first." } : name === "focus-vault" ? { name, body: "Use a secret by handle." } : name === "working-in-vyre" ? { name, body: "# Working in Vyre\nThe manual." } : null; },
};
const threadTitled = (title: string, screen?: boolean): Record<string, unknown> => ({ ...FULL, "threads.get": { thread: { kind: "ask", title, scopeType: "vault_item", scopeId: "vit_1", members: [], agents: [] } }, ...(screen ? { "chat.screen.get": { screen: { place: "vault", title: "Resend" } } } : {}) });

test("a chat that Add to Automations started loads the connector-builder skill as its focus, even from the Vault screen", async () => {
  const ctx = await createContextBuilder({ call: fake(threadTitled("Add Resend to Automations", true)).call, skills: withConnector, now: () => at }).build(input());
  const focus = ctx.sections.find((s) => s.id === "focus")?.text ?? "";
  assert.match(focus, /^connector-builder\n# Connector builder\nFind the docs first\./);
});

test("Build a connector is the same, and a Vault chat with any other title keeps the Vault focus", async () => {
  const built = await createContextBuilder({ call: fake(threadTitled("Build a connector")).call, skills: withConnector, now: () => at }).build(input());
  assert.match(built.sections.find((s) => s.id === "focus")?.text ?? "", /^connector-builder\n/);
  const other = await createContextBuilder({ call: fake(threadTitled("Ask about Resend", true)).call, skills: withConnector, now: () => at }).build(input());
  assert.match(other.sections.find((s) => s.id === "focus")?.text ?? "", /^focus-vault\n/);
});

test("a chat that Sync to Records, Bring in from your CRM or Edit mapping started loads the crm-sync-builder skill", async () => {
  for (const title of ["Sync HubSpot to Records", "Bring my CRM into Records", "Change how Ledger syncs to Records"]) {
    const ctx = await createContextBuilder({ call: fake(threadTitled(title, true)).call, skills: withConnector, now: () => at }).build(input());
    assert.match(ctx.sections.find((s) => s.id === "focus")?.text ?? "", /^crm-sync-builder\n# CRM sync builder/, title);
  }
});

test("in any other chat the skill is in the index with a description that says what to ask for", async () => {
  const ctx = await createContextBuilder({ call: fake(FULL).call, skills: withConnector, now: () => at }).build(input());
  const line = /- connector-builder: ([^\n]*)/.exec(ctx.sections.find((s) => s.id === "skills")?.text ?? "")?.[1] ?? "";
  assert.match(line, /Connect an app or API to Automations/);
  assert.match(line, /hook up an app/);
  assert.equal(ctx.sections.some((s) => s.id === "focus"), false, "not loaded until the person asks for it");
});

test("an Ask or comment thread about a record, file, folder, automation or agent names the object, not only its id", async () => {
  const scoped = (scopeType: string, scopeId: string, extra: Record<string, unknown>): Record<string, unknown> => ({ ...FULL, "threads.get": { thread: { kind: "ask", title: "Comment replies", scopeType, scopeId, members: [], agents: [] } }, ...extra });
  const where = async (answers: Record<string, unknown>): Promise<string> => (await createContextBuilder({ call: fake(answers).call, now: () => at }).build(input())).sections.find((s) => s.id === "where")?.text ?? "";
  // records.get needs the type; a thread names only the record, so the Space's types are tried until one holds it
  const matter = { "schema.describe": { types: [{ key: "contact" }, { key: "matter" }] }, "records.get": (i: unknown) => { if ((i as { type: string }).type !== "matter") throw new Error("no such record"); return { record: { id: "rec_1", type: "matter", fields: { title: "Hart v. Lowell", secret_note: "never in context" } } }; } };
  assert.match(await where(scoped("record", "rec_1", matter)), /about record rec_1 "matter: Hart v\. Lowell"/);
  assert.doesNotMatch(await where(scoped("record", "rec_1", matter)), /never in context/);
  assert.match(await where(scoped("file", "fil_9", { "files.get": { file: { fileId: "fil_9", name: "Engagement letter.docx" } } })), /about file fil_9 "Engagement letter\.docx"/);
  assert.match(await where(scoped("folder", "fld_3", { "files.folder.get": { folder: { folderId: "fld_3", name: "Closing set" } } })), /about folder fld_3 "Closing set"/);
  assert.match(await where(scoped("automation", "aut_2", { "automations.get": { automation: { id: "aut_2", name: "Weekly summary" } } })), /about automation aut_2 "Weekly summary"/);
  assert.match(await where(scoped("agent", "agt_docs", { "agents.get": { agent: { agentId: "agt_docs", name: "Docs" } } })), /about agent agt_docs "Docs"/);
  // an object the asker cannot read gives no name, and a record with no name field is known by its type
  assert.match(await where(scoped("file", "fil_9", {})), /about file fil_9(?! ")/);
  assert.match(await where(scoped("record", "rec_2", { "schema.describe": { types: [{ key: "contact" }] }, "records.get": { record: { id: "rec_2", type: "contact", fields: {} } } })), /about record rec_2 "contact"/);
});

// ---- the skills module's loader, as the turn sees it

const listed = (extra: unknown[] = []) => ({ skills: [
  { name: "triage", description: "The intake agent's own triage.", tier: "agent", agentId: "agt_intake", note: "Used here. The Space's skill of this name is not." },
  ...extra,
  { name: "intake-rules", description: "How we take a new matter at intake.", tier: "space" },
  { name: "triage", description: "Space copy of triage.", tier: "space", shadowedBy: "agent", note: "Not used here: the agent's own skill of this name is used instead." },
  { name: "half-written", description: "Never shown.", tier: "space", broken: "Its SKILL.md cannot be read: no front matter" },
  { name: "working-in-vyre", description: "How an agent works inside Vyre.", tier: "builtin" },
  { name: "focus-records", description: "Work in Records.", tier: "builtin" },
] });
const loads = (i: unknown) => {
  const name = (i as { name: string }).name;
  if (name === "working-in-vyre") return { skill: { name, body: "# Working in Vyre\nThe manual." } };
  if (name === "intake-rules") return { skill: { name, body: "Ask for the conflict names first." } };
  throw new Error("validation.not_found");
};

test("the index lists every skill this agent uses for the person (its own and the Space's, not only Vyre's), read as the asker, and names load_skill; a beaten or broken one is left out", async () => {
  const f = fake({ ...FULL, "skills.list": listed(), "skills.load": loads });
  const ctx = await createContextBuilder({ call: f.call, skills: capabilitySkills(f.call), now: () => at }).build(input());
  const text = ctx.sections.find((s) => s.id === "skills")?.text ?? "";
  assert.match(text, /^Working in Vyre \(always loaded\):\n# Working in Vyre\nThe manual\./);
  assert.match(text, /load it with load_skill \{name\} and follow it:\n- triage: The intake agent's own triage\. \(Used here\. The Space's skill of this name is not\.\)\n- intake-rules: How we take a new matter at intake\.\n- focus-records: Work in Records\.$/);
  assert.doesNotMatch(text, /Space copy of triage|half-written/);
  const asked = f.log.filter((l) => l.cap === "skills.list");
  assert.deepEqual(asked.map((l) => [l.input, l.as]), [[{ agentId: "agt_intake" }, "usr_maya"]]);
  assert.ok(f.log.filter((l) => l.cap === "skills.load").every((l) => l.as === "usr_maya" && (l.input as { agentId: string }).agentId === "agt_intake"));
});

test("a long index is cut, nearest first, and says how many more there are; a loader that cannot answer leaves the built-ins on disk", async () => {
  const many = Array.from({ length: SKILL_INDEX_MAX + 5 }, (_, i) => ({ name: `space-skill-${String(i).padStart(3, "0")}`, description: `Skill ${i}.`, tier: "space" }));
  const f = fake({ ...FULL, "skills.list": listed(many), "skills.load": loads });
  const ctx = await createContextBuilder({ call: f.call, skills: capabilitySkills(f.call), now: () => at }).build(input());
  const text = ctx.sections.find((s) => s.id === "skills")?.text ?? "";
  assert.equal((text.match(/^- /gm) ?? []).length, SKILL_INDEX_MAX);
  assert.match(text, /^- triage: /m, "the agent's own come first");
  assert.match(text, /\.\.\. and 8 more: skills_list names them all\.$/);
  const down = fake({ ...FULL, "skills.list": () => { throw new Error("internal.unexpected"); }, "skills.load": () => { throw new Error("internal.unexpected"); } });
  const ctx2 = await createContextBuilder({ call: down.call, skills: capabilitySkills(down.call), now: () => at }).build(input());
  const t2 = ctx2.sections.find((s) => s.id === "skills")?.text ?? "";
  assert.match(t2, /^Working in Vyre \(always loaded\):/, "the manual comes from disk");
  assert.match(t2, /- focus-records: /);
});

test("group guidance is in the context of a group chat and a channel, and absent in a 1:1", async () => {
  const { GROUP_STYLE } = await import("../context.ts");
  const where = async (over: Record<string, unknown>): Promise<string> => {
    const f = fake(over as never);
    const ctx = await createContextBuilder({ call: f.call, skills, now: () => at }).build(input());
    return ctx.sections.find((s) => s.id === "where")?.text ?? "";
  };
  assert.match(await where(FULL), new RegExp(GROUP_STYLE.slice(0, 40)), "Docs and Omar are also here: a group");
  assert.doesNotMatch(await where({ ...FULL, "threads.get": { thread: { threadId: "thr_1", kind: "chat", title: "Intake desk", members: [{ kind: "person", id: "usr_maya" }], agents: [{ agentId: "agt_intake", mode: "lead" }] } } }), /group conversation/, "a 1:1 keeps the agent's own style");
  assert.match(await where({ ...FULL, "threads.get": { thread: { threadId: "thr_1", kind: "channel", title: "general", members: [{ kind: "person", id: "usr_maya" }], agents: [{ agentId: "agt_intake", mode: "lead" }] } } }), /group conversation/, "a channel is a group even with one other");
});
