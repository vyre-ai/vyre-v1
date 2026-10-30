// The chat benchmark tasks: 30 tasks on a seeded Space (records, files, automations, routines, the Vault, where-am-I questions, a computer), each in its own chat on a booted daemon, scored by checks on
// the resulting state (and, for questions, on the reply). Run twice on identical Spaces: "before" is a turn with no context (the one-line role and the memory block, as a chat was answered before
// the turn context), "after" is the turn as it is now. The model is a deterministic stand-in that acts only on what its prompt tells it (see test/support/bench.ts for what that does and does not
// measure). `node --experimental-strip-types test/chat-brain.benchmark.ts` runs all 30 on both sides and prints the table; test/chat-brain.bench-smoke.test.ts runs a few of them on every change.
import assert from "node:assert/strict";
import type { DriverEvent, TurnInput } from "../../agent/src/turn-engine/types.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";
import { BudgetExceeded, agentIdOf, cronFor, factsOf, makeUse, offsetHours, viewOf, zoneOf, MAX_CALLS } from "./bench.ts";
import type { Facts, Say, Use } from "./bench.ts";
import { boot, call, connect, makeAgent, scriptedModel, seededDir, waitFor, lastAgentMessage, hostLog } from "./live.ts";

const SECRET = "lm-live-BENCH-SECRET-VALUE-0042"; // secret-scan: fake
const PASTED = ["sk", "live", "BENCHPASTED0123456789ABC"].join("_"); // a fake key, joined so the source holds no whole key
const TZ = "Asia/Karachi";

// ---- the seeded Space

interface World {
  d: Daemon;
  agentId: string;
  contacts: Record<string, { id: string; version: number }>;
  harborId: string;
  folders: { bench: string; reviewed: string };
  files: { intake: string; policy: string; lease: string };
  automations: { tag: string; sync: string };
  routines: { digest: string; sweep: string };
  channelId: string;
  vaultItemId: string;
  teamFolderId: string;
}

const CONTACTS: Array<[name: string, email: string, phone: string | null, title?: string]> = [
  ["Maya Chen", "maya.chen@example.com", "555-0101"], ["Priya Nair", "priya.nair@example.com", "555-0102", "Analyst"], ["Omar Haddad", "omar.haddad@example.com", null],
  ["Lena Park", "lena.park@example.com", null], ["Sam Ortiz", "sam.ortiz@example.com", "555-0105"], ["Tara Quinn", "tara.quinn@example.com", "555-0106"],
  ["Noah Berg", "noah.berg@example.com", "555-0107"], ["Ines Costa", "ines.costa@example.com", "555-0108"], ["Raj Patel", "raj.patel@example.com", "555-0109"],
  ["Hana Sato", "hana.sato@example.com", "555-0110"], ["Theo Marsh", "theo.marsh@example.com", null], ["Zoe Adler", "zoe.adler@example.com", "555-0112"],
];
const NO_PHONE = ["Omar Haddad", "Lena Park", "Theo Marsh"];
const TAG_DEF = { triggers: [{ key: "record_change", config: {}, filter: { type: "contact", op: "created" } }], nodes: [{ id: "step_1", key: "records.update", title: "Mark the source", input: { type: "contact", recordId: "{{ trigger.recordId }}", patch: { pref_source: "website" } } }] };
const SYNC_DEF = { triggers: [{ key: "record_change", config: {}, filter: { type: "contact", op: "updated" } }], nodes: [{ id: "step_1", key: "records.update", title: "Keep the source", input: { type: "contact", recordId: "{{ trigger.recordId }}", patch: { pref_source: "sync" } } }] };

let seq = 0;
const key = (p: string): string => `${p}-${++seq}`;
async function ok(d: Daemon, cap: string, input: unknown): Promise<any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, input);
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
}

async function seed(d: Daemon): Promise<World> {
  await ok(d, "settings.set", { key: "profile.timezone", value: TZ });
  const agentId = await makeAgent(d, "Bench", "You help the team with records, files, automations and routines.", { vaultKeys: ["Dana_Lawmatics"], captureMode: "propose" });
  const company = await ok(d, "records.create", { type: "company", fields: { name: "Harbor Studio" }, idempotencyKey: key("co") });
  await ok(d, "records.create", { type: "company", fields: { name: "Northwind Traders" }, idempotencyKey: key("co") });
  const contacts: World["contacts"] = {};
  for (const [name, email, phone, title] of CONTACTS) {
    const r = await ok(d, "records.create", { type: "contact", fields: { name, email, ...(phone ? { phone } : {}), ...(title ? { title } : {}) }, idempotencyKey: key("ct") });
    contacts[name] = { id: r.record.id, version: r.record.version };
  }
  const roots = await ok(d, "files.list", { section: "space" });
  const projects = (roots.folders as Array<{ name: string; folderId: string }>).find((f) => f.name === "Projects")!.folderId;
  const bench = (await ok(d, "files.folder.create", { parentId: projects, name: "Intake desk", idempotencyKey: key("fo") })).folder.folderId as string;
  const reviewed = (await ok(d, "files.folder.create", { parentId: bench, name: "Reviewed", reviewChanges: true, idempotencyKey: key("fo") })).folder.folderId as string;
  const mk = async (folderId: string, name: string, text: string): Promise<string> => (await ok(d, "files.create", { folderId, name, content: { text }, idempotencyKey: key("fi") })).file.fileId as string;
  const intake = await mk(bench, "intake-script.md", "Intake script\nCall 555-0100 to book.\nAsk for the matter number.\n");
  const lease = await mk(bench, "lease-summary.md", "Lease summary\nThe tenant must give 30 days notice before leaving.\n");
  const policy = await mk(reviewed, "policy.md", "Policy\nThe tyop is here.\nThat is all.\n");
  const tag = (await ok(d, "automations.create", { name: "Tag new contacts", definition: TAG_DEF, idempotencyKey: key("au") })).automation.id as string;
  await ok(d, "automations.set_enabled", { automationId: tag, enabled: true });
  const sync = (await ok(d, "automations.create", { name: "Sync new leads", definition: SYNC_DEF, idempotencyKey: key("au") })).automation.id as string;
  const save = async (title: string, cron: string, prompt: string): Promise<string> => (await ok(d, "agents.routine.save", { agentId, title, cron, prompt, idempotencyKey: key("rt") })).routine.routineId as string;
  const digest = await save("Weekly digest", "0 4 * * 5", "Summarise the week's new contacts and post the summary to the person who set this routine.");
  const sweep = await save("Morning sweep", "0 3 * * 1-5", "Look for contacts with no phone number and list them for the person who set this routine.");
  const channelId = (await ok(d, "channels.create", { name: "intake", visibility: "invite", idempotencyKey: key("ch") })).channel.channelId as string;
  const team = (await ok(d, "vault.folders.create", { name: "Team keys", scope: "shared", idempotencyKey: key("vf") })).folder.id as string;
  await ok(d, "vault.share", { resource: { type: "vault_folder", id: team }, subject: { kind: "person", id: "usr_adam" }, level: "manage", idempotencyKey: key("vs") });
  const item = await ok(d, "vault.item.put", { folderId: team, name: "Dana_Lawmatics", kind: "api_key", fields: [{ key: "api_key", value: SECRET, secret: true }], idempotencyKey: key("vi") });
  return {
    d, agentId, contacts, harborId: company.record.id, folders: { bench, reviewed }, files: { intake, policy, lease }, automations: { tag, sync }, routines: { digest, sweep },
    channelId, vaultItemId: (item.item?.id ?? item.id) as string, teamFolderId: team,
  };
}

// ---- the tasks

type Policy = (f: Facts, use: Use, say: Say, w: World) => AsyncGenerator<DriverEvent, void>;
export interface Task {
  id: string;
  area: "records" | "files" | "automations" | "routines" | "vault" | "where" | "computer";
  prompt: string;
  /** What the place sends with the message (the screen), when the task is asked from a screen. */
  screen?: (w: World) => unknown;
  policy: Policy;
  /** null when the state and the reply are right, else why not. */
  check(w: World, reply: string): Promise<string | null>;
}

const say: Say = (text) => ({ type: "text", text });
const has = (re: RegExp, s: string): boolean => re.test(s);
const fail = (cond: boolean, why: string): string | null => (cond ? null : why);

/** Load the focus skill of a place when the prompt lists it and the teaching is not already in front of the model: what a competent model does with an index of skills. */
async function* learn(f: Facts, use: Use, place: string): AsyncGenerator<DriverEvent, void> {
  const name = `focus-${place}`;
  if (f.view.includes(`Focus for this place:\n${name}`) || !new RegExp(`^- ${name}: `, "m").test(f.view)) return;
  const r = await use("agents_builtin_skill_get", { name });
  if (r.data?.body) f.view += `\n\n${name}\n${r.data.body}`;
}

/** Find a contact by name. A filter is `{ field, op, value }`; a model that has not been told that tries the plain shape first and learns it from the refusal. */
async function* findContact(f: Facts, use: Use, name: string): AsyncGenerator<DriverEvent, { id: string; version: number; fields: Record<string, any> } | undefined> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const taught = /"op": "eq"/.test(f.view);
  let r = yield* use("records_query", { type: "contact", filter: taught ? { field: "name", op: "eq", value: name } : { name }, limit: 5 });
  if (r.error) r = yield* use("records_query", { type: "contact", filter: { field: "name", op: "eq", value: name }, limit: 5 });
  return (r.data?.rows as Array<{ id: string; version: number; fields: Record<string, any> }> | undefined)?.[0];   // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Find a file by name or words with the Space search. */
async function* fileByName(use: Use, q: string): AsyncGenerator<DriverEvent, string | undefined> {
  const r = yield* use("search_query", { q, types: ["file"], limit: 5 });
  const hit = (r.data?.results ?? r.data?.items ?? r.data?.hits) as Array<{ id?: string; itemId?: string; fileId?: string }> | undefined;
  return hit?.[0]?.fileId ?? hit?.[0]?.itemId ?? hit?.[0]?.id;
}

async function* allContacts(use: Use): AsyncGenerator<DriverEvent, Array<{ id: string; fields: Record<string, any> }>> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = yield* use("records_query", { type: "contact", limit: 100, fields: ["name", "email", "phone", "title"] });
  return (r.data?.rows as Array<{ id: string; fields: Record<string, any> }> | undefined) ?? [];   // eslint-disable-line @typescript-eslint/no-explicit-any
}

const recordOf = async (w: World, id: string): Promise<any> => (await ok(w.d, "records.get", { type: "contact", recordId: id })).record;   // eslint-disable-line @typescript-eslint/no-explicit-any
const textOf = async (w: World, fileId: string): Promise<{ text: string; version: number }> => { const r = await ok(w.d, "files.read", { fileId, as: "text" }); return { text: r.text, version: r.version }; };
const routinesOf = async (w: World): Promise<Array<{ routineId: string; title: string; cron?: string; kind?: string; enabled: boolean; watch?: { channelId: string } }>> => (await ok(w.d, "agents.routines.list", { agentId: w.agentId })).routines;

export const TASKS: Task[] = [
  // ---- records
  {
    id: "rec-email", area: "records", prompt: "What is Maya Chen's email address?",
    async *policy(f, use, say) { const c = yield* findContact(f, use, "Maya Chen"); yield say(c ? `Maya Chen's email is ${c.fields["email"]}.` : "I could not find Maya Chen."); },
    check: async (_w, reply) => fail(has(/maya\.chen@example\.com/, reply), "the reply does not give the email"),
  },
  {
    id: "rec-count", area: "records", prompt: "How many contacts do we have?",
    async *policy(f, use, say) { const rows = yield* allContacts(use); yield say(`We have ${rows.length} contacts.`); void f; },
    check: async (_w, reply) => fail(has(/\b12\b/, reply), "the reply does not say 12"),
  },
  {
    id: "rec-update", area: "records", prompt: "Change Priya Nair's job title to Operations Lead.",
    async *policy(f, use, say) {
      yield* use("schema_describe", { type: "contact" });
      const c = yield* findContact(f, use, "Priya Nair");
      if (!c) { yield say("I could not find Priya Nair."); return; }
      const r = yield* use("records_update", { type: "contact", recordId: c.id, patch: { title: "Operations Lead" }, baseVersion: c.version });
      yield say(r.error ? `That failed: ${r.error.message}` : `Priya Nair's title is now Operations Lead (${c.id}).`);
    },
    check: async (w, _r) => { const r = await recordOf(w, w.contacts["Priya Nair"]!.id); return fail(r.fields.title === "Operations Lead", `title is ${r.fields.title}`); },
  },
  {
    id: "rec-create", area: "records", prompt: "Add a contact: Dev Patel, dev.patel@example.com, works at Harbor Studio.",
    async *policy(f, use, say, w) {
      yield* use("schema_describe", { type: "contact" });
      const made = yield* use("records_create", { type: "contact", fields: { name: "Dev Patel", email: "dev.patel@example.com" }, idempotencyKey: "bench-dev" });
      const id = made.data?.record?.id as string | undefined;
      if (!id) { yield say("I could not create the contact."); return; }
      const co = yield* use("records_query", { type: "company", filter: { field: "name", op: "eq", value: "Harbor Studio" }, limit: 3 });
      const harbor = (co.data?.rows as Array<{ id: string }> | undefined)?.[0]?.id ?? (co.error ? w.harborId : undefined);
      if (harbor) yield* use("records_relate", { type: "contact", recordId: id, field: "company", toId: harbor });
      yield say(`Added Dev Patel (${id})${harbor ? " at Harbor Studio" : ""}.`);
    },
    check: async (w) => {
      const rows = (await ok(w.d, "records.query", { type: "contact", limit: 100 })).rows as Array<{ id: string; fields: Record<string, any> }>;   // eslint-disable-line @typescript-eslint/no-explicit-any
      const dev = rows.find((r) => r.fields["name"] === "Dev Patel");
      if (!dev) return "no Dev Patel";
      const co = dev.fields["company"];
      return fail(dev.fields["email"] === "dev.patel@example.com" && JSON.stringify(co ?? "").includes(w.harborId), `company is ${JSON.stringify(co)}`);
    },
  },
  {
    id: "rec-screen", area: "records", prompt: "Update the phone of this contact to 555-0188.",
    screen: (w) => ({ place: "records", title: "Contacts", open: [{ type: "record", id: w.contacts["Sam Ortiz"]!.id, title: "Sam Ortiz" }] }),
    async *policy(f, use, say) {
      yield* learn(f, use, "records");
      const target = f.open.find((o) => o.type === "record");
      if (!target) { yield say("Which contact do you mean? I cannot tell which one is open."); return; }
      const got = yield* use("records_get", { type: "contact", recordId: target.id });
      const r = yield* use("records_update", { type: "contact", recordId: target.id, patch: { phone: "555-0188" }, baseVersion: got.data?.record?.version });
      yield say(r.error ? `That failed: ${r.error.message}` : `Updated the phone of ${target.title ?? target.id} to 555-0188.`);
    },
    check: async (w) => { const r = await recordOf(w, w.contacts["Sam Ortiz"]!.id); return fail(r.fields.phone === "555-0188", `phone is ${r.fields.phone}`); },
  },
  {
    id: "rec-missing", area: "records", prompt: "Which contacts have no phone number?",
    async *policy(f, use, say) {
      yield* learn(f, use, "records");
      const rows = yield* allContacts(use);
      yield say(`These contacts have no phone number: ${rows.filter((r) => !r.fields["phone"]).map((r) => r.fields["name"]).join(", ")}.`);
    },
    check: async (_w, reply) => fail(NO_PHONE.every((n) => reply.includes(n)) && !reply.includes("Maya Chen") && !reply.includes("Sam Ortiz"), "the list is not exactly the contacts with no phone"),
  },

  // ---- files
  {
    id: "file-read", area: "files", prompt: "What does the intake script say?",
    async *policy(f, use, say) {
      yield* learn(f, use, "files");
      const id = yield* fileByName(use, "intake-script");
      if (!id) { yield say("I could not find the intake script."); return; }
      const r = yield* use("files_read", { fileId: id, as: "text" });
      yield say(`The intake script says:\n${r.data?.text ?? ""}`);
    },
    check: async (_w, reply) => fail(has(/555-0100/, reply), "the reply does not quote the script"),
  },
  {
    id: "file-edit", area: "files", prompt: "Change the phone number in the intake script to 555-0142.",
    async *policy(f, use, say, w) {
      yield* learn(f, use, "files");
      const id = yield* fileByName(use, "intake-script");
      void w;
      if (!id) { yield say("I could not find the intake script."); return; }
      const r = yield* use("files_read", { fileId: id, as: "text" });
      const baseVersion = /baseVersion/.test(f.view) ? r.data?.version : undefined;
      const w2 = yield* use("files_write", { fileId: id, content: { text: String(r.data?.text).replace("555-0100", "555-0142") }, ...(baseVersion ? { baseVersion } : {}), reason: "New intake phone number" });
      yield say(w2.error ? `That failed: ${w2.error.message}` : `Changed the number in the intake script to 555-0142 (${id}).`);
    },
    check: async (w) => { const t = await textOf(w, w.files.intake); return fail(t.text === "Intake script\nCall 555-0142 to book.\nAsk for the matter number.\n", `the script reads ${JSON.stringify(t.text)}`); },
  },
  {
    id: "file-create", area: "files", prompt: "Create a file called agenda.md in the Intake desk folder saying: Agenda: review intake.",
    async *policy(f, use, say, w) {
      yield* learn(f, use, "files");
      const r = yield* use("files_create", { folderId: w.folders.bench, name: "agenda.md", content: { text: "Agenda: review intake.\n" }, idempotencyKey: "bench-agenda" });
      yield say(r.error ? `That failed: ${r.error.message}` : "Created agenda.md in the Intake desk folder.");
    },
    check: async (w) => {
      const ls = await ok(w.d, "files.list", { folder: w.folders.bench });
      const f = (ls.files as Array<{ fileId: string; name: string }>).find((x) => x.name === "agenda.md");
      if (!f) return "no agenda.md";
      return fail((await textOf(w, f.fileId)).text.includes("Agenda: review intake."), "wrong content");
    },
  },
  {
    id: "file-review", area: "files", prompt: "Fix the typo 'tyop' in policy.md.",
    async *policy(f, use, say, w) {
      yield* learn(f, use, "files");
      const r = yield* use("files_read", { fileId: w.files.policy, as: "text" });
      const out = yield* use("files_write", { fileId: w.files.policy, content: { text: String(r.data?.text).replace("tyop", "typo") }, baseVersion: r.data?.version, reason: "Fix typo" });
      const held = out.data?.changeset ?? out.data?.changesetId ?? out.data?.pending;
      yield say(out.error ? `That failed: ${out.error.message}` : held ? "The fix is in a changeset waiting for a reviewer to approve it. policy.md has not changed yet." : "Fixed the typo in policy.md.");
    },
    check: async (w, reply) => {
      const t = await textOf(w, w.files.policy);
      const sets = await ok(w.d, "changesets.list", { folderId: w.folders.reviewed });
      return fail(t.text.includes("tyop") && JSON.stringify(sets).includes("chg_") && has(/waiting|approve/i, reply) && !has(/\bFixed\b/, reply), `file ${t.text.includes("tyop") ? "unchanged" : "CHANGED"}, changesets ${JSON.stringify(sets).slice(0, 80)}, reply ${reply.slice(0, 60)}`);
    },
  },
  {
    id: "file-screen", area: "files", prompt: "Summarise this file in one line.",
    screen: (w) => ({ place: "files", title: "Bench", open: [{ type: "file", id: w.files.lease, title: "lease-summary.md" }] }),
    async *policy(f, use, say) {
      yield* learn(f, use, "files");
      const target = f.open.find((o) => o.type === "file");
      if (!target) { yield say("Which file do you mean? I cannot tell which one is open."); return; }
      const r = yield* use("files_read", { fileId: target.id, as: "text" });
      yield say(`${target.title ?? target.id}: ${String(r.data?.text).split("\n").slice(1).join(" ").trim()}`);
    },
    check: async (_w, reply) => fail(has(/30 days/, reply), "the reply does not summarise the open file"),
  },

  // ---- automations
  {
    id: "aut-list", area: "automations", prompt: "Which automations do I have and are they on?",
    async *policy(f, use, say) {
      yield* learn(f, use, "automations");
      const r = yield* use("automations_list", {});
      yield say(((r.data?.automations as Array<{ name: string; status: string }> | undefined) ?? []).map((a) => `${a.name} is ${a.status}`).join("; "));
    },
    check: async (_w, reply) => fail(has(/Tag new contacts is on/, reply) && has(/Sync new leads/, reply), "the reply does not list the automations with their state"),
  },
  {
    id: "aut-disable", area: "automations", prompt: "Turn off Tag new contacts.",
    async *policy(f, use, say, w) {
      yield* learn(f, use, "automations");
      const r = yield* use("automations_list", {});
      const hit = (r.data?.automations as Array<{ id: string; name: string }> | undefined)?.find((a) => a.name === "Tag new contacts");
      const out = yield* use("automations_set_enabled", { automationId: hit?.id ?? w.automations.tag, enabled: false });
      yield say(out.error ? `That failed: ${out.error.message}` : "Tag new contacts is off.");
    },
    check: async (w) => { const a = (await ok(w.d, "automations.get", { automationId: w.automations.tag })).automation; return fail(a.status !== "on", `status is ${a.status}`); },
  },
  {
    id: "aut-create", area: "automations", prompt: "Make an automation called Label new leads: when a contact is created, set their job title to New lead. Leave it off.",
    async *policy(f, use, say) {
      yield* learn(f, use, "automations");
      const def = { triggers: [{ key: "record_change", config: {}, filter: { type: "contact", op: "created" } }], nodes: [{ id: "step_1", key: "records.update", title: "Set the title", input: { type: "contact", recordId: "{{ trigger.recordId }}", patch: { title: "New lead" } } }] };
      if (/automations_validate/.test(f.view)) yield* use("automations_validate", { definition: def });
      const r = yield* use("automations_create", { name: "Label new leads", definition: def, idempotencyKey: "bench-label" });
      yield say(r.error ? `That failed: ${r.error.message}` : "Made Label new leads. It is off.");
    },
    check: async (w) => {
      const list = (await ok(w.d, "automations.list", {})).automations as Array<{ id: string; name: string; status: string }>;
      const a = list.find((x) => x.name === "Label new leads");
      if (!a) return "no automation";
      const def = (await ok(w.d, "automations.get", { automationId: a.id })).automation.definition;
      return fail(a.status !== "on" && def.triggers[0].key === "record_change" && JSON.stringify(def.nodes).includes("New lead"), `status ${a.status}, definition ${JSON.stringify(def).slice(0, 120)}`);
    },
  },
  {
    id: "aut-test-then-enable", area: "automations", prompt: "Turn on Sync new leads.",
    screen: (w) => ({ place: "automations", title: "Sync new leads", open: [{ type: "automation", id: w.automations.sync, title: "Sync new leads" }] }),
    async *policy(f, use, say) {
      yield* learn(f, use, "automations");
      const target = f.open.find((o) => o.type === "automation");
      const id = target?.id;
      if (!id) { yield say("Which automation?"); return; }
      if (f.teaches.testFirst) yield* use("automations_test", { automationId: id, sample: { recordId: "rec_sample" } });
      const out = yield* use("automations_set_enabled", { automationId: id, enabled: true });
      yield say(out.error ? `That failed: ${out.error.message}` : `Sync new leads is on${f.teaches.testFirst ? "; a test run came back first" : ""}.`);
    },
    check: async (w) => {
      const a = (await ok(w.d, "automations.get", { automationId: w.automations.sync })).automation;
      const runs = JSON.stringify(await ok(w.d, "runs.list", { scope: "subject", subject: { type: "automation", id: w.automations.sync }, kinds: ["automation_test"] }));
      return fail(a.status === "on" && runs.includes("run_"), `status ${a.status}, runs ${runs.slice(0, 100)}`);
    },
  },
  {
    id: "aut-explain", area: "automations", prompt: "What does Tag new contacts do?",
    async *policy(f, use, say, w) {
      yield* learn(f, use, "automations");
      const r = yield* use("automations_get", { automationId: w.automations.tag });
      const d = r.data?.automation?.definition;
      yield say(d ? `When a record changes (${d.triggers[0].config?.op ?? d.triggers[0].filter?.op ?? "event"}: ${d.triggers[0].filter?.type}), it runs ${d.nodes.map((n: any) => `${n.title} (${JSON.stringify(n.input.patch)})`).join(", then ")}.` : "I could not read it.");   // eslint-disable-line @typescript-eslint/no-explicit-any
    },
    check: async (_w, reply) => fail(has(/created/, reply) && has(/pref_source/, reply), "the reply does not say what it does"),
  },

  // ---- routines (the agent's own loops)
  {
    id: "rtn-list", area: "routines", prompt: "What routines do you have set for me?",
    async *policy(f, use, say) {
      const agentId = yield* agentIdOf(f, use);
      const rows = f.routines.length > 0 ? f.routines : ((yield* use("agents_routines_list", { agentId }))).data?.routines?.map((r: any) => ({ title: r.title })) ?? [];   // eslint-disable-line @typescript-eslint/no-explicit-any
      yield say(`My routines for you: ${rows.map((r: { title: string }) => r.title).join(", ")}.`);
    },
    check: async (_w, reply) => fail(has(/Weekly digest/, reply) && has(/Morning sweep/, reply), "the reply does not list the routines"),
  },
  {
    id: "rtn-weekly", area: "routines", prompt: "Every Monday at 9am send me the overdue invoices.",
    async *policy(f, use, say) {
      const agentId = yield* agentIdOf(f, use);
      const zone = yield* zoneOf(f, use);
      const cron = cronFor("Monday", 9, zone, f.teaches.utc);
      const r = yield* use("agents_routine_save", { agentId, title: "Overdue invoices", cron, prompt: "List the invoices in Records that are past due, newest first, with client, amount and days late. Post the list in the chat with the person who set this routine.", idempotencyKey: "bench-weekly" });
      yield say(r.error ? `That failed: ${r.error.message}` : `Set. Every Monday at 09:00 ${zone ?? ""} (${cron.split(" ")[1]!.padStart(2, "0")}:00 UTC) I will send the overdue invoices.`);
    },
    check: async (w) => { const r = (await routinesOf(w)).find((x) => /invoice/i.test(x.title)); return fail(r?.cron === cronFor("Monday", 9, TZ, true), `cron is ${r?.cron}`); },
  },
  {
    id: "rtn-watch", area: "routines", prompt: "Whenever someone posts in #intake, read it and tag it for triage.",
    async *policy(f, use, say, w) {
      const agentId = yield* agentIdOf(f, use);
      const ch = yield* use("channels_list", {});
      const channelId = (ch.data?.channels as Array<{ channelId: string; name: string }> | undefined)?.find((c) => c.name === "intake")?.channelId ?? (ch.error ? w.channelId : undefined);
      if (!channelId) { yield say("I could not find #intake."); return; }
      const r = yield* use("agents_routine_save", { agentId, title: "Triage intake", kind: "watch", watch: { on: "message", channelId }, prompt: "Read the new message in #intake and tag it for triage with a short label. Post the label as a reply in the channel.", idempotencyKey: "bench-watch" });
      yield say(r.error ? `That failed: ${r.error.message}` : "Set. I watch #intake and tag each new post for triage.");
    },
    check: async (w) => { const r = (await routinesOf(w)).find((x) => x.kind === "watch"); return fail(r?.watch?.channelId === w.channelId, "no watcher on #intake"); },
  },
  {
    id: "rtn-change", area: "routines", prompt: "Move the Weekly digest to Thursdays at 8am.",
    async *policy(f, use, say) {
      const agentId = yield* agentIdOf(f, use);
      const zone = yield* zoneOf(f, use);
      const list = (yield* use("agents_routines_list", { agentId })).data?.routines as Array<{ routineId: string; title: string; prompt: string }> | undefined;
      const mine = list?.find((r) => r.title === "Weekly digest");
      const cron = cronFor("Thursday", 8, zone, f.teaches.utc);
      const r = yield* use("agents_routine_save", { agentId, ...(f.teaches.inPlace && mine ? { routineId: mine.routineId } : {}), title: "Weekly digest", cron, prompt: mine?.prompt ?? "Summarise the week's new contacts.", idempotencyKey: "bench-change" });
      yield say(r.error ? `That failed: ${r.error.message}` : `Moved. The Weekly digest now runs Thursdays at 08:00 ${zone ?? ""} (${cron.split(" ")[1]!.padStart(2, "0")}:00 UTC).`);
    },
    check: async (w) => {
      const all = (await routinesOf(w)).filter((x) => x.title === "Weekly digest");
      return fail(all.length === 1 && all[0]!.routineId === w.routines.digest && all[0]!.cron === cronFor("Thursday", 8, TZ, true), `${all.length} digests, cron ${all.map((x) => x.cron).join(",")}`);
    },
  },
  {
    id: "rtn-pause", area: "routines", prompt: "Pause the Morning sweep.",
    async *policy(f, use, say) {
      const agentId = yield* agentIdOf(f, use);
      const list = (yield* use("agents_routines_list", { agentId })).data?.routines as Array<{ routineId: string; title: string; cron: string; prompt: string }> | undefined;
      const mine = list?.find((r) => r.title === "Morning sweep");
      if (!mine) { yield say("I could not find it."); return; }
      const r = yield* use("agents_routine_save", { agentId, ...(f.teaches.inPlace ? { routineId: mine.routineId } : {}), title: mine.title, cron: mine.cron, prompt: mine.prompt, enabled: false, idempotencyKey: "bench-pause" });
      yield say(r.error ? `That failed: ${r.error.message}` : "Paused the Morning sweep.");
    },
    check: async (w) => {
      const all = (await routinesOf(w)).filter((x) => x.title === "Morning sweep");
      return fail(all.length === 1 && all[0]!.enabled === false, `${all.length} sweeps, enabled ${all.map((x) => x.enabled).join(",")}`);
    },
  },
  {
    id: "rtn-delete", area: "routines", prompt: "Stop the Weekly digest altogether.",
    async *policy(f, use, say) {
      const agentId = yield* agentIdOf(f, use);
      const list = (yield* use("agents_routines_list", { agentId })).data?.routines as Array<{ routineId: string; title: string }> | undefined;
      const mine = list?.find((r) => r.title === "Weekly digest");
      if (!mine) { yield say("I could not find it."); return; }
      const r = yield* use("agents_routine_delete", { agentId, routineId: mine.routineId });
      yield say(r.error ? `That failed: ${r.error.message}` : "Stopped and removed the Weekly digest.");
    },
    check: async (w) => fail(!(await routinesOf(w)).some((x) => x.routineId === w.routines.digest), "the digest is still there"),
  },

  // ---- vault
  {
    id: "vlt-use", area: "vault", prompt: "Use our Lawmatics key to start the contacts sync.",
    async *policy(f, use, say) {
      let item = f.vaultHandles.find((h) => /lawmatics/i.test(h));
      if (!item) {
        const l = yield* use("vault_items_list", {});
        item = (l.data?.items as Array<{ name: string }> | undefined)?.find((i) => /lawmatics/i.test(i.name))?.name;
      }
      if (!item) { yield say("I could not find a Lawmatics key."); return; }
      const r = yield* use("vault_use", { item, purpose: "start the contacts sync" });
      yield say(r.error ? `That failed: ${r.error.message}` : `I used ${r.data?.handle} for the sync. The key is passed as ${r.data?.handle}.api_key and was not shown.`);
    },
    check: async (w, reply) => {
      const used = JSON.stringify((await ok(w.d, "audit.list", { actor: { kind: "agent", id: w.agentId }, limit: 50 })).rows);
      return fail(/vault\.use/.test(used) && has(/#Dana_Lawmatics/, reply) && !reply.includes(SECRET), `audit ${used.slice(0, 200)}`);
    },
  },
  {
    id: "vlt-missing", area: "vault", prompt: "Use the Mailchimp key to export the list.",
    async *policy(f, use, say) {
      let item = f.vaultHandles.find((h) => /mailchimp/i.test(h));
      if (!item) {
        const l = yield* use("vault_items_list", {});
        item = (l.data?.items as Array<{ name: string }> | undefined)?.find((i) => /mailchimp/i.test(i.name))?.name;
      }
      if (!item) {
        const fl = yield* use("vault_folders_list", {});
        const shared = (fl.data?.folders as Array<{ id: string; scope: string }> | undefined)?.find((x) => x.scope === "shared")?.id;
        const r = yield* use("vault_request", { name: "Mailchimp_Key", reason: "Export the list with Mailchimp", ...(shared ? { folderId: shared } : {}), idempotencyKey: "bench-mc" });
        yield say(r.error ? `That failed: ${r.error.message}` : "There is no Mailchimp key in the Vault. I asked the managers for it and I am waiting for it.");
      }
    },
    check: async (w, reply) => {
      const reqs = JSON.stringify(await ok(w.d, "vault.requests.list", {}));
      return fail(/Mailchimp/.test(reqs) && has(/waiting/i, reply), `requests ${reqs.slice(0, 120)}`);
    },
  },
  {
    id: "vlt-paste", area: "vault", prompt: `My new Stripe key is ${PASTED}, keep it for later.`,
    async *policy(_f, _use, say) { yield say("Please do not paste keys in chat. Put it in the Vault with a secret field and I will use it by name. I have not stored it."); },
    check: async (_w, reply) => fail(!reply.includes(PASTED) && has(/Vault/, reply) && has(/not paste|do not paste/i, reply), "the reply repeats the key or does not point to the Vault"),
  },

  // ---- where am I
  {
    id: "who-me", area: "where", prompt: "Who am I talking to here, and what time is it for me right now?",
    async *policy(f, use, say) {
      const zone = yield* zoneOf(f, use);
      const hour = f.localNow ? `${String(f.localNow.hour).padStart(2, "0")}:${String(f.localNow.minute).padStart(2, "0")}` : undefined;
      let name = f.askerName;
      if (!name) { const w = yield* use("identity_whoami", {}); name = w.data?.person?.name; }
      yield say(`${name ? `You are ${name}. ` : "I do not know your name. "}${hour ? `It is ${hour} in ${zone}.` : zone ? `Your zone is ${zone}.` : "I do not know your time zone."}`);
    },
    check: async (_w, reply) => {
      const o = offsetHours(TZ);
      const nowLocal = new Date(Date.now() + o * 3_600_000);
      const stamps = [-2, -1, 0, 1].map((m) => new Date(nowLocal.getTime() + m * 60_000)).map((t) => `${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}`);
      return fail(has(/Olivia Park/, reply) && stamps.some((s) => reply.includes(s)), `the reply is: ${reply.slice(0, 120)}`);
    },
  },
  {
    id: "who-role", area: "where", prompt: "What are you for?",
    async *policy(f, _use, say) { const role = /an agent in Vyre\. (.*?)(\n|$)/.exec(f.view)?.[1]; yield say(role ? `I am ${f.agentName}. ${role}` : `I am ${f.agentName}.`); },
    check: async (_w, reply) => fail(has(/records, files, automations and routines/, reply), "the reply does not give the role"),
  },
  {
    id: "who-question", area: "where", prompt: "Ask me whether to use the stage New or Qualified for the new leads.",
    async *policy(f, use, say) {
      if (!f.threadId) { yield say("Should I use the stage New or Qualified for the new leads?"); return; }
      const r = yield* use("ask_question", { threadId: f.threadId, prompt: "Which stage should the new leads get?", mode: "single", options: [{ key: "new", label: "New" }, { key: "qualified", label: "Qualified" }] });
      if (r.error) yield say(`That failed: ${r.error.message}`);
    },
    check: async (w) => {
      const threads = (await ok(w.d, "threads.list", { kind: ["chat"] })).threads as Array<{ threadId: string; title?: string }>;
      for (const t of threads) {
        const ms = (await ok(w.d, "chat.messages.list", { threadId: t.threadId })).messages as Array<{ body: string; blocks?: Array<{ type: string }> }>;
        if (ms.some((m) => (m.blocks ?? []).some((b) => b.type === "question") && JSON.stringify(m).includes("Qualified"))) return null;
      }
      return "no question block was asked";
    },
  },
  {
    id: "who-remember", area: "where", prompt: "Remember that I prefer calls on Tuesdays.",
    async *policy(f, use, say) {
      if (!f.threadId) { yield say("Noted that you prefer calls on Tuesdays."); return; }
      const r = yield* use("memory_propose", { text: "Prefers calls on Tuesdays.", sourceKind: "chat", sourceRef: f.threadId, layer: "person", kind: "preference", idempotencyKey: "bench-mem" });
      yield say(r.error ? `That failed: ${r.error.message}` : "Saved: you prefer calls on Tuesdays.");
    },
    check: async (w) => {
      const facts = JSON.stringify(await ok(w.d, "memory.facts.list", { fromMe: true, status: ["proposed", "current"] }));
      return fail(/Tuesday/.test(facts), "no fact about Tuesdays was saved");
    },
  },

  // ---- computer
  {
    id: "cmp-none", area: "computer", prompt: "Wake your computer and open example.com.",
    async *policy(f, use, say) {
      if (f.hasComputer === false) { yield say("I do not have a computer. I can ask for one if you want me to browse."); return; }
      const r = yield* use("computers_list", {});
      const mine = (r.data?.computers as Array<{ computerId: string; state: string }> | undefined) ?? [];
      yield say(mine.length === 0 ? "I do not have a computer. I can ask for one if you want me to browse." : "Waking my computer.");
    },
    check: async (_w, reply) => fail(has(/do not have a computer|no computer/i, reply) && !has(/opened/i, reply), "the reply claims it has or used a computer"),
  },
];

// The order matters where tasks share state: the routine list is read before the routine tasks change it.
export const ORDER = TASKS.map((t) => t.id);

// ---- running

export interface Result { id: string; area: string; pass: boolean; why: string | null; calls: number; log: string[] }

export async function runMode(mode: "before" | "after", only?: readonly string[]): Promise<Result[]> {
  const byPrompt = new Map(TASKS.map((t) => [t.prompt, t]));
  const counters = new Map<string, { calls: number; log: string[] }>();
  let world: World | undefined;
  const model = scriptedModel(async function* (input: TurnInput, run) {
    const task = byPrompt.get(input.trigger?.body ?? "");
    if (!task || !world) return;
    const seen = mode === "before" ? { ...input, context: undefined } : input;
    const view = await viewOf((cap, i, as) => (async () => { const r = await call(world!.d, cap, i); if (r.status >= 400) throw new Error(`${cap} ${r.status}`); return r.data; })().then((x) => x).catch(() => { throw new Error("read failed"); }), seen).catch(() => "");
    const f = factsOf(view, mode);
    const counter = { calls: 0, log: [] as string[] };
    counters.set(task.id, counter);
    const use = makeUse(run, counter);
    try { yield* task.policy(f, use, say, world); }
    catch (e) { if (e instanceof BudgetExceeded) yield say(`I ran out of steps (${MAX_CALLS} tool calls).`); else throw e; }
  });
  const d = await boot(seededDir(), model);
  try {
    await connect(d);
    world = await seed(d);
    const results: Result[] = [];
    for (const id of ORDER.filter((x) => !only || only.includes(x))) {
      const task = TASKS.find((t) => t.id === id)!;
      const started = await call(d, "chat.start", { kind: "chat", agentIds: [world.agentId], idempotencyKey: `bn-${mode}-${id}-s` });
      const threadId = started.data.thread.threadId as string;
      const before = ((await call(d, "chat.messages.list", { threadId })).data.messages as unknown[]).length;
      const posted = await call(d, "chat.post", { threadId, body: task.prompt, mentions: [{ kind: "agent", id: world.agentId }], idempotencyKey: `bn-${mode}-${id}-p`, ...(task.screen ? { screen: task.screen(world) } : {}) });
      assert.equal(posted.status, 200, JSON.stringify(posted.data));
      const reply = await waitFor(() => lastAgentMessage(d, threadId, before), 60_000, () => hostLog(d)).catch(() => "");
      let why: string | null;
      try { why = await task.check(world, reply); } catch (e) { why = `check threw: ${e instanceof Error ? e.message : String(e)}`; }
      if (why !== null && process.env["VYRE_BENCH_DEBUG"]) console.log(`  [${id}] host log: ${hostLog(d).slice(0, 1500)}`);
      const c = counters.get(id) ?? { calls: 0, log: [] };
      results.push({ id, area: task.area, pass: why === null, why, calls: c.calls, log: c.log });
    }
    return results;
  } finally { await d.stop(); }
}

export const score = (rs: Result[]): { pass: number; total: number; calls: number } => ({ pass: rs.filter((r) => r.pass).length, total: rs.length, calls: rs.reduce((n, r) => n + r.calls, 0) });
