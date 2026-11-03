// Meetings close themselves (lane l-meetings): a recorded transcript becomes a close-out package prepared by the owner's Assistant; Approve all makes the tasks, record updates, one email through
// the gated mail.send and the hold; Redo never makes anything twice; another person's private meeting never shows. Every call to another module is checked against its frozen contract.
// @reads /modules/meetings/handlers/closeout.ts
// @reads /modules/meetings/migrations/0003_meetings_closeout.sql
import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../handlers/index.ts";
import { EVENT, HOUR, MAYA, NOW, PAT, START, contractErrors, eventErrors, harness, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { ANSWER, ASSISTANT, COMPANY, NEXT_AT, SAM, TRANSCRIPT } from "../fixtures/closeout.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
const ZED = "usr_zedk0001";

function addRecord(h: Harness, id: string, type: string, fields: Json): void {
  h.store.set(id, { id, type, fields, version: 1, createdAt: NOW, updatedAt: NOW, deleted: false });
}
const agentRow = (agentId: string, ownerId: string, kind: "assistant" | "agent") => ({
  agentId, name: kind === "assistant" ? "Assistant" : "Intake", kind, face: "seed", status: "awake", ownerId, folderId: "fld_agents01", accountPolicy: "asker", accountFallback: [],
  toolsAllowed: [], toolsDenied: [], vaultKeys: [], limits: {}, captureMode: "auto", hasComputer: false, templateVersion: 1, createdAt: NOW,
});
const person = (id: string, name: string) => ({ id, kind: "person", name, status: "active", roles: [], groups: [], createdAt: NOW });
const typeOf = (key: string, fields: Array<[string, string, string]>) => ({
  key, title: key, plural: `${key}s`, icon: "user", label: "internal", system: true, titleField: "name", fields: fields.map(([k, type, title]) => ({ key: k, type, title })), version: 1,
});

/** Maya's world: Pat Lee of Lee Holdings is a contact, Sam is her colleague, her Assistant and mailbox are set up, and the outward capabilities count what they are asked. */
function world() {
  const h = harness();
  addRecord(h, PAT, "contact", { name: "Pat Lee", email: "pat@client.example", title: "Operations lead", company: [COMPANY] });
  addRecord(h, COMPANY, "company", { name: "Lee Holdings", website: "" });
  h.contacts.set("pat@client.example", PAT);
  h.script("agents.list", () => ({ agents: [agentRow("agt_intake001", MAYA, "agent"), agentRow(ASSISTANT, MAYA, "assistant")], total: 2 }));
  h.script("comms.senders.list", () => ({ senders: [{ id: "mbx_maya0001", channel: "email", name: "Maya Ortiz", address: "maya@firm.example", via: "Gmail", provider: "google", scope: "mine", default: true, usable: true }] }));
  h.script("access.principals.list", () => ({ principals: [person(MAYA, "Maya Ortiz"), person(SAM, "Sam Reyes"), person(ZED, "Zed King")] }));
  h.script("schema.describe", (i) => ({
    types: [i["type"] === "company"
      ? typeOf("company", [["name", "text", "Name"], ["website", "url", "Website"], ["contacts", "relation", "People"]])
      : typeOf("contact", [["name", "text", "Name"], ["title", "text", "Job title"], ["email", "email", "Email"], ["company", "relation", "Company"], ["owner", "person", "Owner"], ["pref_sms_consent", "choice", "SMS consent"]])],
  }));
  let n = 0;
  h.script("records.comments.add", (i) => ({ comment: { commentId: `rcm_${++n}`, type: i["type"], recordId: i["recordId"], text: i["text"], by: MAYA, at: NOW, resolved: false, mentions: [], replying: [] } }));
  // the Gate: a person's own send at a screen goes out; an agent's is held for approval (modules/mail/handlers/send.ts sendGateApplies)
  h.script("mail.send", () => (h.ctx.principal.kind === "person" ? { messageId: `eml_sent${++n}`, status: "sent", suppressed: [] } : { status: "held", taskId: "tsk_held0001", suppressed: [] }));
  h.script("mail.draft", () => ({ draftId: `eml_draft${++n}` }));
  return h;
}

/** Maya's calendar brings the call in, then its transcript lands. */
async function meeting(h: Harness): Promise<string> {
  const got = out(await m.ingest(h.ctx, {
    source: "calendar", providerRef: EVENT, calendarEventId: EVENT, title: "Lee Holdings renewal", startsAt: START, endsAt: START + HOUR,
    attendees: [{ email: "maya@firm.example", name: "Maya Ortiz" }, { email: "sam@firm.example", name: "Sam Reyes" }, { email: "pat@client.example", name: "Pat Lee" }],
  }));
  const id = String(got.meetingId);
  await m.attachRecording(h.ctx, { meetingId: id, source: "upload", transcriptText: TRANSCRIPT });
  return id;
}

/** Prepare as Maya, then answer as her Assistant with the recorded answer. */
async function prepared(h: Harness): Promise<string> {
  const id = await meeting(h);
  await m.closeoutPrepare(h.ctx, { meetingId: id });
  h.actAs("agent", ASSISTANT);
  await m.closeoutPropose(h.ctx, { meetingId: id, ...ANSWER });
  h.actAs("person", MAYA);
  return id;
}

const items = (pkg: Json): Json[] => pkg.items as Json[];
const byKind = (pkg: Json, kind: string): Json[] => items(pkg).filter((i) => i.kind === kind);

test("a recorded transcript becomes a close-out: the owner's Assistant gets the brief, and its answer is tasks, record updates, a follow-up draft and a hold", async () => {
  const h = world();
  const id = await meeting(h);
  const started = out(await m.closeoutPrepare(h.ctx, { meetingId: id }));
  assert.deepEqual(contractErrors("meetings.closeout.prepare", "out", started), []);
  assert.equal(started.state, "preparing");
  const ask = h.calls("tasks.create").at(-1)?.input as Json;
  assert.deepEqual([ask.assigned, ask.source, ask.recordId], [{ kind: "agent", id: ASSISTANT }, { kind: "meeting", id }, id], "the task is her own Assistant's, from the meeting");
  const brief = String((ask.notes as Json).brief);
  for (const said of ["Lee Holdings renewal", "Pat Lee <pat@client.example>", `contact ${PAT}`, "title: \"Operations lead\"", "Sam Reyes", "meetings.closeout.propose", "follow-up to Pat Lee", "in Maya Ortiz's voice", "I'll send the revised quote"]) {
    assert.ok(brief.includes(said), `the brief says ${said}`);
  }
  assert.ok(!brief.includes("pref_sms_consent") && !brief.includes("owner:"), "consent and people fields are not the transcript's to change");

  h.actAs("agent", ASSISTANT);
  const proposed = out(await m.closeoutPropose(h.ctx, { meetingId: id, ...ANSWER }));
  assert.deepEqual(contractErrors("meetings.closeout.propose", "out", proposed), []);
  assert.deepEqual([proposed.state, proposed.items], ["ready", 6]);
  assert.deepEqual(eventErrors("meeting.closeout_ready", h.named("meeting.closeout_ready")[0]?.payload), []);

  h.actAs("person", MAYA);
  const pkg = out(await m.closeoutGet(h.ctx, { meetingId: id }));
  assert.deepEqual(contractErrors("meetings.closeout.get", "out", pkg), []);
  assert.equal(pkg.state, "ready");
  assert.equal(pkg.summary, ANSWER.summary);
  assert.deepEqual([pkg.decisions, pkg.questions], [ANSWER.decisions, ANSWER.questions]);
  assert.deepEqual((pkg.attendees as Json[]).map((a) => [a.name, a.recordId]), [["Maya", undefined], ["Sam", undefined], ["Pat Lee", PAT]], "a contact's name from the record, anyone else's from the address");

  const [quote, onboarding] = byKind(pkg, "task");
  assert.deepEqual([quote?.title, quote?.assignee, quote?.ownerName, typeof quote?.due], ["Send Pat the revised quote", SAM, "Sam", "number"], "Sam said it, so Sam owns it, with the date he said");
  assert.deepEqual([onboarding?.assignee, onboarding?.due], [MAYA, undefined]);
  const [pat, company] = byKind(pkg, "record");
  assert.deepEqual([pat?.recordId, pat?.changes], [PAT, [{ field: "title", title: "Job title", from: "Operations lead", to: "Head of Operations" }]], "a value that does not fit its field is left out");
  assert.match(String(pat?.note), /annual plan/);
  assert.deepEqual([company?.recordId, company?.changes], [COMPANY, [{ field: "website", title: "Website", to: "https://leeholdings.example" }]]);
  const [mail] = byKind(pkg, "email");
  assert.deepEqual([mail?.to, mail?.subject, mail?.send], [[{ address: "pat@client.example", name: "Pat Lee" }], "Next steps on your renewal", "send"], "only the outside attendee gets the follow-up");
  const [hold] = byKind(pkg, "hold");
  assert.deepEqual([hold?.title, hold?.startsAt, hold?.endsAt], ["Renewal: legal review", NEXT_AT, NEXT_AT + 30 * 60_000]);
  assert.equal(h.fields(id)["summary"], ANSWER.summary, "the meeting keeps the summary too");

  const listed = out(await m.closeoutList(h.ctx, {}));
  assert.deepEqual(contractErrors("meetings.closeout.list", "out", listed), []);
  assert.deepEqual([listed.ready, (listed.meetings as Json[]).map((r) => [r.meetingId, r.state, r.proposed, r.done])], [1, [[id, "ready", 6, 0]]]);
  assert.deepEqual((out(await m.closeoutList(h.ctx, { recordId: PAT })).meetings as Json[]).length, 1, "Pat's record lists the meeting");
  assert.equal(h.calls("mail.send").length + h.calls("records.update").filter((c) => c.input.type !== "meeting").length + h.calls("calendar.create_event").length, 0, "nothing went out or changed before approval");
});

test("Approve all creates every item through its own capability, with exactly one email through the gated send, and the closed meeting links to what it made", async () => {
  const h = world();
  const id = await prepared(h);
  const tasksBefore = h.calls("tasks.create").length;
  const done = out(await m.closeoutApprove(h.ctx, { meetingId: id }));
  assert.deepEqual(contractErrors("meetings.closeout.approve", "out", done), []);
  assert.equal(done.state, "closed");

  const made = h.calls("tasks.create").slice(tasksBefore).map((c) => c.input);
  assert.deepEqual(made.map((t) => [t.title, (t.assigned as Json).id, t.source, t.recordId]), [
    ["Send Pat the revised quote", SAM, { kind: "meeting", id }, PAT],
    ["Set up the onboarding call with the Lee Holdings team", MAYA, { kind: "meeting", id }, PAT],
  ], "each task says it came from the meeting");
  const updates = h.calls("records.update").filter((c) => c.input.type !== "meeting").map((c) => [c.input.recordId, c.input.patch]);
  assert.deepEqual(updates, [[PAT, { title: "Head of Operations" }], [COMPANY, { website: "https://leeholdings.example" }]]);
  assert.deepEqual(h.fields(PAT)["title"], "Head of Operations");
  assert.deepEqual(h.calls("records.comments.add").map((c) => c.input.recordId), [PAT, COMPANY], "a meeting note on each record");
  const sends = h.calls("mail.send");
  assert.equal(sends.length, 1, "exactly one email");
  assert.deepEqual([sends[0]?.input.mailboxId, sends[0]?.input.to, sends[0]?.input.contactId], ["mbx_maya0001", [{ address: "pat@client.example", name: "Pat Lee" }], PAT]);
  assert.equal(h.calls("mail.draft").length, 0);
  const holds = h.calls("calendar.create_event");
  assert.deepEqual(holds.map((c) => [c.input.startsAt, c.input.recordIds, c.input.attendees]), [[NEXT_AT, [id], undefined]], "a hold on her own calendar, nobody invited");

  const pkg = out(await m.closeoutGet(h.ctx, { meetingId: id }));
  assert.ok(items(pkg).every((i) => i.status === "approved" && (i.made as Json[]).length > 0), "every item links to what it made");
  assert.deepEqual((byKind(pkg, "email")[0]?.made as Json[]).map((x) => [x.type, x.title]), [["email", "Next steps on your renewal"]]);
  const closed = h.named("meeting.closed");
  assert.equal(closed.length, 1);
  assert.deepEqual(eventErrors("meeting.closed", closed[0]?.payload), []);
  assert.equal((closed[0]?.payload.made as Json[]).length, 8, "two tasks, two updates, two notes, the email and the hold");

  // pressing it again (or both buttons at once) makes nothing more
  await Promise.all([m.closeoutApprove(h.ctx, { meetingId: id }), m.closeoutApprove(h.ctx, { meetingId: id })]);
  assert.equal(h.calls("mail.send").length, 1);
  assert.equal(h.calls("tasks.create").length, tasksBefore + 2);
  assert.equal(h.named("meeting.closed").length, 1);
});

test("an approved item goes one at a time; an edit and a skip change what is made; the person's draft choice is kept", async () => {
  const h = world();
  const id = await prepared(h);
  const pkg = out(await m.closeoutGet(h.ctx, { meetingId: id }));
  const quote = byKind(pkg, "task")[0] as Json;
  const mail = byKind(pkg, "email")[0] as Json;
  const hold = byKind(pkg, "hold")[0] as Json;
  const edited = out(await m.closeoutEdit(h.ctx, { meetingId: id, itemId: String(quote.itemId), title: "Send Pat the revised annual quote", assignee: MAYA, due: null }));
  assert.deepEqual(contractErrors("meetings.closeout.edit", "out", edited), []);
  assert.deepEqual([(edited.item as Json).title, (edited.item as Json).assignee, (edited.item as Json).due], ["Send Pat the revised annual quote", MAYA, undefined]);
  await m.closeoutEdit(h.ctx, { meetingId: id, itemId: String(mail.itemId), send: "draft", text: "Hi Pat,\n\nShort version: annual plan from January.\n\nMaya" });
  const skipped = out(await m.closeoutSkip(h.ctx, { meetingId: id, itemId: String(hold.itemId) }));
  assert.deepEqual(contractErrors("meetings.closeout.skip", "out", skipped), []);
  assert.equal((skipped.item as Json).status, "skipped");

  const one = out(await m.closeoutApprove(h.ctx, { meetingId: id, itemIds: [String(quote.itemId)] }));
  assert.equal(one.state, "ready", "the rest still wait");
  assert.deepEqual(h.calls("tasks.create").at(-1)?.input.title, "Send Pat the revised annual quote");
  await m.closeoutApprove(h.ctx, { meetingId: id });
  assert.equal(h.calls("mail.send").length, 0, "a draft, not a send");
  assert.deepEqual(h.calls("mail.draft").map((c) => c.input.text), ["Hi Pat,\n\nShort version: annual plan from January.\n\nMaya"]);
  assert.equal(h.calls("calendar.create_event").length, 0, "the skipped hold is not made");
  assert.equal(await refusedWith(m.closeoutEdit(h.ctx, { meetingId: id, itemId: String(quote.itemId), title: "Too late" })), "validation.precondition_failed");

  // the next follow-up is proposed as a draft too
  const h2 = h;
  const second = out(await m.ingest(h2.ctx, { source: "calendar", providerRef: "cev_evt00009", calendarEventId: "cev_evt00009", title: "Lee Holdings check-in", startsAt: START + 48 * HOUR, endsAt: START + 49 * HOUR, attendees: [{ email: "pat@client.example" }] }));
  await m.attachRecording(h2.ctx, { meetingId: String(second.meetingId), source: "upload", transcriptText: TRANSCRIPT });
  await m.closeoutPrepare(h2.ctx, { meetingId: String(second.meetingId) });
  await m.closeoutPropose(h2.ctx, { meetingId: String(second.meetingId), ...ANSWER });
  assert.equal(byKind(out(await m.closeoutGet(h2.ctx, { meetingId: String(second.meetingId) })), "email")[0]?.send, "draft");
});

test("Redo asks the Assistant again and never makes anything twice", async () => {
  const h = world();
  const id = await prepared(h);
  // before anything is approved, a redo replaces the proposals
  const firstIds = items(out(await m.closeoutGet(h.ctx, { meetingId: id }))).map((i) => i.itemId);
  const again = out(await m.closeoutPrepare(h.ctx, { meetingId: id, redo: true }));
  assert.ok(again.taskId, "a new task for the Assistant");
  assert.deepEqual((h.calls("tasks.create").at(-1)?.input.notes as Json)["meeting.gen"], "2");
  h.actAs("agent", ASSISTANT);
  await m.closeoutPropose(h.ctx, { meetingId: id, ...ANSWER });
  h.actAs("person", MAYA);
  const redone = items(out(await m.closeoutGet(h.ctx, { meetingId: id })));
  assert.equal(redone.length, 6, "the same six, not twelve");
  assert.ok(redone.every((i) => !firstIds.includes(i.itemId)));

  await m.closeoutApprove(h.ctx, { meetingId: id });
  const counts = () => [h.calls("tasks.create").length, h.calls("mail.send").length, h.calls("calendar.create_event").length, h.calls("records.comments.add").length];
  const after = counts();
  // a redo after approval proposes nothing that was already made
  await m.closeoutPrepare(h.ctx, { meetingId: id, redo: true });
  h.actAs("agent", ASSISTANT);
  const third = out(await m.closeoutPropose(h.ctx, { meetingId: id, ...ANSWER, actions: [...ANSWER.actions, { title: "Book the legal review" }] }));
  h.actAs("person", MAYA);
  assert.deepEqual([third.state, third.items], ["ready", 1], "only the new action is proposed");
  await m.closeoutApprove(h.ctx, { meetingId: id });
  const end = counts();
  assert.deepEqual(end, [after[0]! + 1 + 1, after[1], after[2], after[3]], "one more Assistant task and the one new task; no second email, hold or note");
  assert.equal(items(out(await m.closeoutGet(h.ctx, { meetingId: id }))).length, 7);
});

test("another person's private meeting never shows: not in their list, not openable, not approvable; sharing it to a project they can read shows it", async () => {
  const h = world();
  const id = await prepared(h);
  h.actAs("person", SAM);
  const sam = out(await m.closeoutList(h.ctx, {}));
  assert.deepEqual([sam.meetings, sam.ready], [[], 0], "Sam was on the call, but it is Maya's meeting");
  assert.equal(await refusedWith(m.closeoutGet(h.ctx, { meetingId: id })), "validation.not_found");
  assert.equal(await refusedWith(m.closeoutApprove(h.ctx, { meetingId: id })), "validation.not_found");
  assert.equal(await refusedWith(m.closeoutPrepare(h.ctx, { meetingId: id, redo: true })), "validation.not_found");
  assert.equal(await refusedWith(m.closeoutShare(h.ctx, { meetingId: id, projectId: "prj_ops00001", on: true })), "validation.not_found");
  assert.equal(h.calls("mail.send").length, 0);
  // nor through an agent: one acting for Sam is Sam, and one acting for nobody sees only the close-out it was asked to prepare
  h.actAs("agent", "agt_samhelp1");
  h.ctx.actingFor = SAM;
  assert.deepEqual(out(await m.closeoutList(h.ctx, {})).meetings, []);
  delete h.ctx.actingFor;
  assert.deepEqual(out(await m.closeoutList(h.ctx, {})).meetings, []);
  assert.equal(await refusedWith(m.closeoutGet(h.ctx, { meetingId: id })), "validation.not_found");
  h.actAs("agent", ASSISTANT);
  assert.equal((out(await m.closeoutList(h.ctx, {})).meetings as Json[]).length, 1, "Maya's Assistant sees the one it prepared");

  // Maya shares it with the Ops project; Sam can read the project, Zed cannot
  const readers: Record<string, string[]> = { prj_ops00001: [MAYA, SAM] };
  h.ctx.authorize = (_a, r) => ({ effect: (readers[String(r.id)] ?? []).includes(h.ctx.principal.id) ? "allow" : "deny" });
  h.actAs("person", MAYA);
  await m.closeoutShare(h.ctx, { meetingId: id, projectId: "prj_ops00001", on: true });
  h.actAs("person", SAM);
  assert.deepEqual((out(await m.closeoutList(h.ctx, {})).meetings as Json[]).map((r) => r.meetingId), [id]);
  assert.deepEqual(out(await m.closeoutGet(h.ctx, { meetingId: id })).shared, [{ type: "project", id: "prj_ops00001" }]);
  h.actAs("person", ZED);
  assert.deepEqual(out(await m.closeoutList(h.ctx, {})).meetings, []);
  assert.equal(await refusedWith(m.closeoutGet(h.ctx, { meetingId: id })), "validation.not_found");
});

test("the transcript landing starts the close-out by itself once the owner has opened the Meetings tab, and the tab starts any that waited", async () => {
  const h = world();
  const id = await meeting(h);
  // the host hears the transcript before Maya ever opened the tab: it cannot see her Assistant, so the meeting waits
  h.actAs("service", "svc_host");
  const before = h.calls("tasks.create").length;
  await m.onTranscriptReady(h.ctx, { payload: { meetingId: id, source: "upload" } });
  assert.equal(h.calls("tasks.create").length, before);
  h.actAs("person", MAYA);
  assert.equal(out(await m.closeoutGet(h.ctx, { meetingId: id })).state, "preparing");
  // opening the tab starts it
  assert.deepEqual(await m.closeoutSync(h.ctx, {}), { started: 1 });
  assert.deepEqual(h.calls("tasks.create").at(-1)?.input.assigned, { kind: "agent", id: ASSISTANT });
  assert.deepEqual(await m.closeoutSync(h.ctx, {}), { started: 0 }, "once");

  // from now on the next transcript starts it with nobody there
  const next = out(await m.ingest(h.ctx, { source: "calendar", providerRef: "cev_evt00007", calendarEventId: "cev_evt00007", title: "Lee Holdings legal review", startsAt: START + 72 * HOUR, endsAt: START + 73 * HOUR, attendees: [{ email: "pat@client.example" }] }));
  await m.attachRecording(h.ctx, { meetingId: String(next.meetingId), source: "upload", transcriptText: TRANSCRIPT });
  h.actAs("service", "svc_host");
  await m.onTranscriptReady(h.ctx, { payload: { meetingId: String(next.meetingId), source: "upload" } });
  await m.onTranscriptReady(h.ctx, { payload: { meetingId: String(next.meetingId), source: "upload" } });
  const asks = h.calls("tasks.create").filter((c) => (c.input.source as Json | undefined)?.id === next.meetingId);
  assert.equal(asks.length, 1, "one package per meeting, however often the transcript is heard");
  assert.deepEqual(asks[0]?.input.assigned, { kind: "agent", id: ASSISTANT });
});

test("an Assistant that submits its task with the package as outputs still hands it in; a send held by the Gate shows as waiting for approval", async () => {
  const h = world();
  const id = await meeting(h);
  const started = out(await m.closeoutPrepare(h.ctx, { meetingId: id }));
  const made = h.calls("tasks.create").at(-1)?.input as Json;
  h.script("tasks.get", () => ({
    task: {
      id: started.taskId, kind: "work", title: made.title, state: "done", assigned: made.assigned, actions: [], blocked: false, blocks: [], createdAt: NOW, createdBy: MAYA, dependsOn: [], fileIds: [],
      followers: [], reviewLoops: 0, updatedAt: NOW, recordId: id, source: { kind: "meeting", id }, workingNotes: { outputs: JSON.stringify(ANSWER), summary: "Done" },
    },
  }));
  h.actAs("service", "svc_host");
  await m.onPrepareDone(h.ctx, { payload: { taskId: started.taskId, kind: "work", recordId: id, source: { kind: "meeting", id } } });
  h.actAs("person", MAYA);
  assert.equal(out(await m.closeoutGet(h.ctx, { meetingId: id })).state, "ready");

  // an agent approving (the person's Assistant asked to "close it out"): the email is held for the person, nothing is sent
  h.actAs("agent", ASSISTANT);
  const mail = byKind(out(await m.closeoutGet(h.ctx, { meetingId: id })), "email")[0] as Json;
  await m.closeoutApprove(h.ctx, { meetingId: id, itemIds: [String(mail.itemId)] });
  h.actAs("person", MAYA);
  const after = byKind(out(await m.closeoutGet(h.ctx, { meetingId: id })), "email")[0] as Json;
  assert.deepEqual([after.status, after.made], ["approved", [{ type: "approval", id: "tsk_held0001", title: "Waiting for approval" }]]);
  assert.equal(h.calls("mail.send").length, 1, "one send, and the Gate held it");
});
