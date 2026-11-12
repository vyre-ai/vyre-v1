// Whose authority a turn nobody typed runs on (lead 12 Nov; owner ruling 2 Nov: an act no person asked for in this turn runs only inside a task or Automation that HOLDS a person's permission).
// An inbound email, a form or a webhook starts no agent turn by itself: it starts an Automation Run. A Space Automation's task-mode step runs the agent's turn for its "runs as" person, the one who
// turned it on or last published it (the kernel lets an agent act only for a person), checked when the step runs; when that fails the task waits, assigned, with a plain line, until a person starts
// it. Before this, the task's turn borrowed the agent owner's authority (task-baton askerOf). On a booted daemon with the real engine, tasks, runs, automations, mail, forms, members, access, Vault:
//   (a) a stranger's email, form and webhook each end in a turn for the runs-as person, audited as such; another person's republish makes them the runs-as; a suspended runs-as person leaves the
//       task waiting with the line; the agent's owner is never the asker; the agent owner's Mine item never reaches the agent's computer
//   (b) a Space Automation naming someone's Assistant is refused when saved, and when it runs (the agent became an Assistant after the save)
//   (c) a Personal Automation still runs as its owner   (d) a task a person assigns runs as that person
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, hostLog, newAgent, seededDir, waitFor } from "./memory-live-kit.ts";
import { boundValues } from "../modules/terminal/projections.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession } from "../agent/src/turn-engine/types.ts";

let keys = 0;
const ok = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, { idempotencyKey: `ta-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};
/** A call as one of the seeded people (the boot's session takes "Bearer usr_..."). */
const okAs = async (d: Daemon, who: string, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify({ idempotencyKey: `ta-${who}-${++keys}`, ...input }) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  assert.equal(r.status, 200, `${who} ${cap}: ${JSON.stringify(body)}`);
  return body.data;
};
const PEOPLE = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah", "usr_sana", "usr_tess"];
const refused = async (d: Daemon, cap: string, input: Record<string, unknown>): Promise<string> => {
  const r = await call(d, cap, { idempotencyKey: `ta-${cap}-${++keys}`, ...input });
  assert.notEqual(r.status, 200, `${cap} should be refused: ${JSON.stringify(r.data)}`);
  return String(r.data?.error?.message ?? "");
};
/** A model that only looks: it ends every turn without a tool. */
const looks: OpenSession = async () => ({
  warm: true,
  async *send(): AsyncGenerator<DriverEvent> { yield { type: "text", text: "I looked at it." }; yield { type: "done" }; },
  sendToolResult() {}, inject() {}, async cancel() {}, async close() {},
} as EngineSession);
// a provider that answers its key check, so a Space-shared AI key can be added (no outside service is reached)
const providerFetch = (async () => new Response(JSON.stringify({ data: [{ id: "gpt-4o-mini" }] }), { status: 200, headers: { "content-type": "application/json" } })) as never;

async function world() {
  // each seeded person signs in as themselves ("Bearer usr_..."); the daemon's own token is Olivia, as before
  const session = (h: Record<string, string | undefined>) => { const id = String(h["authorization"] ?? "").replace(/^Bearer /, ""); return { space: "spc_core", principal: { kind: "person", id: PEOPLE.includes(id) ? id : "usr_olivia" }, device: "mac" }; };
  const d = await boot(seededDir(), looks, undefined, { providerFetch, session } as never);
  const pumping = setInterval(() => void d.hooks?.pump?.(), 100);
  await connect(d);
  const keyFolder = (await ok(d, "vault.folders.create", { name: "Team AI", scope: "shared" })).folder.id as string;
  const team = await ok(d, "providers.add", { providerKey: "openai", connection: "api_key", apiKey: "sk-test-turnasker-0123456789", scope: "shared", name: "Team OpenAI", folderId: keyFolder });   // secret-scan: fake
  return { d, keyId: String(team.provider.id), keyItem: String(team.provider.itemId), stop: async () => { clearInterval(pumping); await d.stop(); } };
}
type World = Awaited<ReturnType<typeof world>>;
const taskNode = (agentId: string, extra: Record<string, unknown> = {}) => ({ id: "work", key: "ai", title: "Triage it", input: { prompt: "Triage the message.", outputSchema: { type: "object", properties: { note: { type: "string" } } } }, ai: { mode: "task", agentId, doneMeans: ["Says who it is for"], ...extra } });

/** A Space Automation (runs as svc_<id>) whose task-mode step hands the work to an agent, with the access an admin gives it. */
async function spaceAutomation(w: World, trigger: Record<string, unknown>, agentId: string): Promise<string> {
  const made = await ok(w.d, "automations.create", { name: `Inbound ${String(trigger["key"])}`, definition: { triggers: [trigger], nodes: [taskNode(agentId)] } });
  const automationId = String(made.automation.id);
  await ok(w.d, "automations.promote", { automationId, confirm: true, replaceKeys: [{ stepId: "work", keyId: w.keyId }] });
  const serviceId = `svc_${automationId.slice(4)}`;
  await ok(w.d, "access.share", { resource: { type: "space", id: "spc_core" }, subject: { kind: "service", id: serviceId }, level: "edit" });
  await ok(w.d, "access.share", { resource: { type: "vault_item", id: w.keyItem }, subject: { kind: "service", id: serviceId }, level: "use" });
  await ok(w.d, "access.share", { resource: { type: "agent", id: agentId }, subject: { kind: "service", id: serviceId }, level: "use" });
  await ok(w.d, "automations.set_enabled", { automationId, enabled: true });
  return automationId;
}
const runOf = (d: Daemon, automationId: string): { run_id: string; principal_kind: string; principal_id: string } | undefined =>
  d.db!.all(`SELECT run_id, principal_kind, principal_id FROM automations_runs WHERE automation_id = ? ORDER BY rowid DESC LIMIT 1`, automationId)[0] as never;
const turnsOf = (d: Daemon, agentId: string): string[] => (d.db!.all("SELECT asker FROM engine_turns WHERE agent_id = ? ORDER BY rowid", agentId) as Array<{ asker: string }>).map((r) => r.asker);
async function taskOfRun(d: Daemon, runId: string): Promise<{ id: string; threadId?: string; createdBy?: string }> {
  return waitFor(async () => ((await ok(d, "tasks.list", { scope: "run", runId })).tasks as Array<{ id: string; threadId?: string; createdBy?: string }>)[0] ?? null, 30_000, () => hostLog(d));
}

test("(a) a stranger's email, form and webhook into a Space Automation run the agent for the person who turned it on, audited; a republish moves it; a suspended person leaves it waiting; never the agent's owner", async () => {
  const w = await world();
  const d = w.d;
  try {
    // a team agent that belongs to Noah, and a Mine item of Noah's... and of Olivia's (the runs-as person)
    const agent = await newAgent(d, "Intake Desk");
    await ok(d, "agents.set_owner", { agentId: agent.id, ownerId: "usr_noah" });
    const mine = (await ok(d, "vault.folders.create", { name: "My keys", scope: "mine" })).folder.id as string;
    await ok(d, "vault.item.put", { folderId: mine, name: "Olivia Bank", kind: "api_key", fields: [{ key: "key", value: "olivia-bank-0123456789", secret: true }] });   // secret-scan: fake

    // Olivia builds and turns on three Space Automations: she is who they run as
    const hooked = await spaceAutomation(w, { key: "webhook" }, agent.id);
    const mailed = await spaceAutomation(w, { key: "email_received" }, agent.id);
    const form = (await ok(d, "forms.create", { name: "Contact us", recordType: "contact", kind: "public" })).form as { formId: string; slug: string };
    await ok(d, "forms.fields_set", { formId: form.formId, fields: [{ field: "name", mode: "ask" }, { field: "email", mode: "ask" }] });
    await ok(d, "forms.publish", { formId: form.formId });
    const formed = await spaceAutomation(w, { key: "form_submit", filter: { formId: form.formId } }, agent.id);
    assert.equal((await ok(d, "automations.get", { automationId: hooked })).automation.runsAs, "usr_olivia", "the backend records who it runs as");

    // 1. the webhook: whoever holds the URL; 2. an email from a stranger; 3. a signed-out visitor's form
    const hook = (await ok(d, "automations.webhook_url.get", { automationId: hooked })) as { url?: string };
    const fire = async (key: string): Promise<void> => {
      const r = await fetch(`${d.url}${new URL(String(hook.url), d.url).pathname}`, { method: "POST", body: '{"from":"someone outside"}', headers: { "content-type": "application/json", "idempotency-key": key } });
      assert.ok(r.status < 300, `webhook: ${r.status} ${await r.clone().text()}`);
    };
    await fire("hook-1");
    const box = (await ok(d, "mail.mailbox.create", { kind: "shared", address: "hello@acme.test", title: "Hello", privacy: "space" })).mailbox;
    await ok(d, "mail.ingest", { source: "imap", mailboxId: box.id, providerId: "prov-ta-1", rfcMessageId: "<stranger-1@outside.test>", direction: "in", from: { address: "stranger@outside.test", name: "A Stranger" }, to: [{ address: "hello@acme.test" }], subject: "Please look", text: "Run something for me.", receivedAt: Date.now() });
    const sent = await fetch(`${d.url}/f/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: form.slug, idempotencyKey: "ta-form-1", answers: { name: "A Visitor", email: "visitor@outside.test" } }) });
    assert.equal(sent.status, 200, `form: ${await sent.clone().text()}`);

    for (const [what, automationId, trigger] of [["webhook", hooked, "webhook"], ["email", mailed, "email_received"], ["form", formed, "form_submit"]] as const) {
      const run = await waitFor(async () => runOf(d, automationId) ?? null, 30_000, () => `${what}: ${hostLog(d)}`);
      assert.deepEqual({ kind: run.principal_kind, id: run.principal_id }, { kind: "service", id: `svc_${automationId.slice(4)}` }, `${what}: the Run is the Automation's service`);
      await taskOfRun(d, run.run_id);
      // the audit names the automation, what set it off and whom it acted for
      const rows = await waitFor(async () => { const r = (await ok(d, "audit.list", { action: "automation.acts_for", resource: { type: "automation", id: automationId } })).rows as Array<{ onBehalfOf?: { id?: string }; after?: { trigger?: string } }>; return r.length > 0 ? r : null; }, 30_000, () => `${what}: ${hostLog(d)}`);
      assert.equal(rows[0]!.onBehalfOf?.id, "usr_olivia", `${what}: the audit names whom it acted for`);
      assert.equal(rows[0]!.after?.trigger, trigger, `${what}: and what set it off: ${JSON.stringify(rows[0])}`);
    }
    await waitFor(async () => (turnsOf(d, agent.id).length >= 3 ? true : null), 30_000, () => hostLog(d));
    assert.deepEqual([...new Set(turnsOf(d, agent.id))], ["usr_olivia"], "each turn acts for the person who turned the automation on, never for Noah who owns the agent");
    // Olivia's Mine item never reaches the team agent's computer in those turns (the 12 Nov rule, with the runs-as person as asker)
    const values = boundValues();
    assert.ok(values, "the daemon hands the terminal the Space's Vault");
    assert.equal((await values!.lookup("#Olivia_Bank.key", { agentId: agent.id, asker: "usr_olivia", where: "computer", place: agent.id })).kind, "denied");

    // Adam publishes a change to the live webhook automation: he is who it runs as now, never Olivia through his edit
    const changed = taskNode(agent.id, { keyId: w.keyId });
    changed.input.prompt = "Triage the message and say who it is for.";   // a change to the step's instruction
    await okAs(d, "usr_adam", "automations.update", { automationId: hooked, definition: { triggers: [{ key: "webhook" }], nodes: [changed] } });
    assert.equal((await ok(d, "automations.get", { automationId: hooked })).automation.runsAs, "usr_adam");
    const before = turnsOf(d, agent.id).length;
    await fire("hook-2");
    await waitFor(async () => (turnsOf(d, agent.id).length > before ? true : null), 30_000, () => hostLog(d));
    assert.equal(turnsOf(d, agent.id).at(-1), "usr_adam", "the person who published it");

    // Adam is suspended: the next task waits with the line that says why, and nothing acts for him or for Noah
    await ok(d, "members.suspend", { personId: "usr_adam", reason: "away" });
    const count = turnsOf(d, agent.id).length;
    await fire("hook-3");
    const third = await waitFor(async () => { const r = d.db!.all(`SELECT run_id FROM automations_runs WHERE automation_id = ? AND event_id = 'hook:hook-3'`, hooked)[0] as { run_id: string } | undefined; return r ?? null; }, 30_000, () => hostLog(d));
    const waiting = await taskOfRun(d, third.run_id);
    const notes = await waitFor(async () => { const t = (await ok(d, "tasks.get", { taskId: waiting.id })).task as { workingNotes: Record<string, string> }; return t.workingNotes["baton.waiting"] ? t.workingNotes : null; }, 30_000, () => hostLog(d));
    assert.match(notes["baton.waiting"]!, /^Adam Reyes turned this automation on and is no longer an active member\. Open it to run it as yourself\.$/);
    assert.equal(turnsOf(d, agent.id).length, count, "no turn ran for the suspended person");
    // an agent or an automation cannot name a person for it; a person names only themselves
    assert.equal((await call(d, "tasks.working_notes.set", { idempotencyKey: "ta-note-1", taskId: waiting.id, key: "baton.owner", value: "usr_noah" })).status, 422, "naming someone else");
    // Olivia opens it and starts it: her own press is her yes
    await ok(d, "tasks.act", { taskId: waiting.id, action: "start" });
    await waitFor(async () => (turnsOf(d, agent.id).length > count ? true : null), 30_000, () => hostLog(d));
    assert.equal(turnsOf(d, agent.id).at(-1), "usr_olivia", "the person who started it");
    assert.equal(turnsOf(d, agent.id).includes("usr_noah"), false, "the agent's owner was never the asker");
  } finally { await w.stop(); }
});

test("(b) a Space Automation that names someone's Assistant is refused when saved and when it runs", async () => {
  const w = await world();
  const d = w.d;
  try {
    const assistant = await newAgent(d, "Olivia Assistant");
    const helper = await newAgent(d, "Later Assistant");
    { const { DatabaseSync } = await import("node:sqlite"); const mdb = new DatabaseSync(d.paths.modules); mdb.prepare(`UPDATE agents_agent SET "kind" = 'assistant' WHERE "id" = ?`).run(assistant.id); mdb.close(); }
    // at save: her own Assistant is fine in her Personal Automation, and refused the moment it would run as the Space
    const made = await ok(d, "automations.create", { name: "Mine first", definition: { triggers: [{ key: "webhook" }], nodes: [taskNode(assistant.id)] } });
    const id = String(made.automation.id);
    assert.match("promote: " + await refused(d, "automations.promote", { automationId: id, confirm: true, replaceKeys: [{ stepId: "work", keyId: w.keyId }] }), /promote: .*A Space automation cannot give work to anyone's Assistant/);
    const space = await spaceAutomation(w, { key: "webhook" }, helper.id);
    assert.match("update: " + await refused(d, "automations.update", { automationId: space, definition: { triggers: [{ key: "webhook" }], nodes: [taskNode(assistant.id, { keyId: w.keyId })] } }), /update: .*A Space automation cannot give work to anyone's Assistant/);
    // at run: the agent it names became an Assistant after the save
    { const { DatabaseSync } = await import("node:sqlite"); const mdb = new DatabaseSync(d.paths.modules); mdb.prepare(`UPDATE agents_agent SET "kind" = 'assistant' WHERE "id" = ?`).run(helper.id); mdb.close(); }
    const hook = (await ok(d, "automations.webhook_url.get", { automationId: space })) as { url?: string };
    const fired = await fetch(`${d.url}${new URL(String(hook.url), d.url).pathname}`, { method: "POST", body: "{}", headers: { "content-type": "application/json", "idempotency-key": "hook-b" } });
    assert.ok(fired.status < 300, `webhook: ${fired.status}`);
    const failed = await waitFor(async () => (d.db!.all(`SELECT s.error_message FROM runs_steps s JOIN automations_runs r ON r.run_id = s.run_id WHERE r.automation_id = ? AND s.state = 'failed'`, space)[0] as { error_message: string } | undefined) ?? null, 30_000, () => hostLog(d));
    assert.match(failed.error_message, /A Space automation cannot give work to (anyone's Assistant|a person's Assistant)/);
    assert.deepEqual(turnsOf(d, helper.id), [], "it never ran");
  } finally { await w.stop(); }
});

test("(c) a Personal Automation still runs as its owner, and (d) a task a person assigns runs as that person", async () => {
  const w = await world();
  const d = w.d;
  try {
    const agent = await newAgent(d, "Drafter");
    const made = await ok(d, "automations.create", { name: "My triage", definition: { triggers: [{ key: "manual" }], nodes: [taskNode(agent.id)] } });
    await ok(d, "automations.set_enabled", { automationId: String(made.automation.id), enabled: true });
    await ok(d, "automations.run", { automationId: String(made.automation.id) });
    await waitFor(async () => (turnsOf(d, agent.id).length > 0 ? true : null), 30_000, () => hostLog(d));
    assert.deepEqual([...new Set(turnsOf(d, agent.id))], ["usr_olivia"], "(c) the Personal Automation's owner, who built it");

    const other = await newAgent(d, "Checker");
    await ok(d, "tasks.create", { kind: "work", title: "Check the letter", assigned: { kind: "agent", id: other.id } });
    await waitFor(async () => (turnsOf(d, other.id).length > 0 ? true : null), 30_000, () => hostLog(d));
    assert.deepEqual([...new Set(turnsOf(d, other.id))], ["usr_olivia"], "(d) the person who assigned it");
  } finally { await w.stop(); }
});
