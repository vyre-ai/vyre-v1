// A number is private to the people on it (owner, 2 Nov). Only they read its texts and calls and text or call from it; an unassigned number is for admins; an agent acts only for a person on the number.
// A call with a known contact is that contact's history: whoever can open the record reads it. Twilio, contacts and files are scripted.
import test from "node:test";
import assert from "node:assert/strict";
import * as h from "../handlers/index.ts";
import { AGENT, CALLER, CALL_SID, MAYA, NOW, NUM_E164, NUM_SID, ROB, contractErrors, harness, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (v: unknown): Json => v as Json;
const CONSENTED = "rec_pat00001";
const LEE = "usr_lee00003", NOAH = "usr_noah0004", ADMIN = "usr_adm00005";

/** A number bought for Maya, and access rules where only the admin holds comms.numbers. */
async function line(t: Harness): Promise<string> {
  const id = String(out(out(await h.numberBuy(t.ctx, { e164: NUM_E164, title: "Front desk", assigneeKind: "person", assigneeId: MAYA, idempotencyKey: "buy" })).number).id);
  t.prefs.set(CONSENTED, { smsConsent: "granted" });
  t.contacts.set(CALLER, CONSENTED);
  (t.ctx as unknown as { authorize: unknown }).authorize = (action: { perm: string | null }) => ({ effect: action.perm !== "comms.numbers" || t.ctx.principal.id === ADMIN ? "allow" : "deny" });
  return id;
}
const set = (t: Harness, numberId: string, ...people: string[]) => {
  const was = t.ctx.principal.id;
  t.actAs("person", ADMIN);
  const done = h.numberSetAssignees(t.ctx, { numberId, assignees: people.map((id) => ({ kind: id.startsWith("agt_") ? "agent" : "person", id })) });
  t.actAs("person", was);
  return done;
};
const ring = (t: Harness) => h.ingestVoice(t.ctx, { callSid: CALL_SID, from: CALLER, to: NUM_E164, status: "ringing" });
const text = (t: Harness, numberId: string) => h.sendSms(t.ctx, { numberId, to: CALLER, body: "Hello", idempotencyKey: `s-${Math.random()}` });

test("someone on the number reads its calls and texts; someone who is not does not, by list or by id", async () => {
  const t = harness();
  const numberId = await line(t);
  const call = String(out(await ring(t)).callId);
  await text(t, numberId);
  assert.equal(out(await h.callList(t.ctx, {})).total, 1);
  assert.equal(out(await h.smsList(t.ctx, {})).total, 1);
  assert.equal(out(await h.callGet(t.ctx, { callId: call })).call !== undefined, true);
  t.actAs("person", ROB);
  t.script("records.get", () => { throw t.err("permission.not_found", "no"); });
  assert.equal(out(await h.callList(t.ctx, {})).total, 0);
  assert.equal(out(await h.smsList(t.ctx, {})).total, 0);
  assert.equal(await refusedWith(h.callGet(t.ctx, { callId: call })), "validation.not_found");
  assert.equal(out(await h.numberList(t.ctx, {})).total, 0, "a number you are not on is not listed");
  assert.equal(await refusedWith(h.numberGet(t.ctx, { numberId })), "validation.not_found");
});

test("only someone on the number can text or call from it, and the words say what to do", async () => {
  const t = harness();
  const numberId = await line(t);
  t.actAs("person", ROB);
  assert.equal(await refusedWith(text(t, numberId)), "permission.no_grant");
  assert.equal(await refusedWith(h.dial(t.ctx, { numberId, to: CALLER, idempotencyKey: "d" })), "permission.no_grant");
  assert.equal(await refusedWith(h.voiceToken(t.ctx, { numberId })), "permission.no_grant");
  assert.equal(t.calls("twilio.sms.send").length + t.calls("twilio.call.create").length, 0, "nothing reached Twilio");
});

test("several people can be on a number, and each reads and sends", async () => {
  const t = harness();
  const numberId = await line(t);
  const done = out(await set(t, numberId, MAYA, ROB));
  assert.deepEqual(contractErrors("telephony.number.set_assignees", "out", done), []);
  assert.deepEqual(out(done.number).assignees, [{ kind: "person", id: MAYA }, { kind: "person", id: ROB }]);
  const call = String(out(await ring(t)).callId);
  for (const id of [MAYA, ROB]) {
    t.actAs("person", id);
    assert.equal(out(await h.callList(t.ctx, {})).total, 1, id);
    assert.ok(["sent", "queued"].includes(String(out(await text(t, numberId)).status)), id);
  }
  assert.deepEqual(out(out(await ring(t)).instruction).targets, [{ kind: "person", id: MAYA }, { kind: "person", id: ROB }], "a route that rang the people on it follows them");
  void call;
});

test("taking someone off a number cuts them off at once", async () => {
  const t = harness();
  const numberId = await line(t);
  await set(t, numberId, MAYA, ROB);
  await ring(t);
  await h.ingestStatus(t.ctx, { sid: CALL_SID, kind: "call", status: "completed", at: NOW });
  t.actAs("person", ROB);
  assert.equal(out(await h.callList(t.ctx, {})).total, 1);
  await set(t, numberId, MAYA);
  t.script("records.get", () => { throw t.err("permission.not_found", "no"); });
  assert.equal(out(await h.callList(t.ctx, {})).total, 0);
  assert.equal(await refusedWith(text(t, numberId)), "permission.no_grant");
});

test("a number with nobody on it is for admins, and an admin is not on a line by being one", async () => {
  const t = harness();
  const numberId = await line(t);
  await set(t, numberId);
  await ring(t);
  t.actAs("person", ROB);
  assert.equal(out(await h.callList(t.ctx, {})).total, 0);
  t.actAs("person", ADMIN);
  assert.equal(out(await h.callList(t.ctx, {})).total, 1, "unassigned: an admin sees it");
  await set(t, numberId, MAYA);
  assert.equal(out(await h.callList(t.ctx, {})).total, 0, "assigned: they do not");
  assert.equal(out(await h.numberList(t.ctx, {})).total, 1, "they still run it");
});

test("an agent uses a person's number only for that person, and its own number for anyone", async () => {
  const t = harness();
  const numberId = await line(t);
  t.actAs("agent", AGENT);
  t.ctx.actingFor = ROB;
  assert.equal(out(await h.smsList(t.ctx, {})).total, 0);
  assert.equal(await refusedWith(text(t, numberId)), "permission.no_grant");
  t.ctx.actingFor = MAYA;
  assert.notEqual(out(await text(t, numberId)).status, undefined, "working for Maya, on Maya's number");
  await set(t, numberId, AGENT);
  t.actAs("agent", AGENT);
  t.ctx.actingFor = ROB;
  assert.notEqual(out(await text(t, numberId)).status, undefined, "its own number");
  delete t.ctx.actingFor;
});

test("a call with a known contact is that contact's history: the record opens it, transcript and all; with no record access it stays closed", async () => {
  const t = harness();
  await line(t);
  const callId = String(out(await ring(t)).callId);
  await h.callAttachSummary(t.ctx, { callId, transcript: "Lease is ready.", summary: "Lease" });
  t.actAs("person", LEE);
  t.script("records.get", (i) => { if (i["recordId"] === CONSENTED && i["type"] === "contact") return { record: { id: String(i["recordId"]), type: "contact", fields: {}, version: 1, label: 0, holds: 0, createdAt: NOW, updatedAt: NOW } }; throw t.err("permission.not_found", "no"); });
  const seen = out(await h.callGet(t.ctx, { callId }));
  assert.equal(seen.transcript, "Lease is ready.");
  assert.equal(out(await h.callList(t.ctx, {})).total, 0, "not in their own calls: the record opens the history, not the line");
  assert.equal(await refusedWith(h.hangup(t.ctx, { callId })), "validation.not_found", "reading the history does not work the call");
  t.actAs("person", NOAH);
  t.script("records.get", () => { throw t.err("permission.not_found", "no"); });
  assert.equal(await refusedWith(h.callGet(t.ctx, { callId })), "validation.not_found");
});

test("a hook from Twilio works every line: the server is not a person", async () => {
  const t = harness();
  const numberId = await line(t);
  t.actAs("service", "svc_host", "hook");
  assert.equal(String(out(await ring(t)).callId).startsWith("cal_"), true);
  assert.equal(out(await h.callList(t.ctx, {})).total, 1);
  void numberId;
});

test("my numbers: the ones you are on, and the one you used last is the default", async () => {
  const t = harness();
  const a = await line(t);
  t.script("twilio.number.buy", () => ({ number: { sid: NUM_SID, e164: "+14155550124", capabilities: ["voice", "sms"] } }));
  const b = String(out(out(await h.numberBuy(t.ctx, { e164: "+14155550124", title: "Back line", assigneeKind: "person", assigneeId: MAYA, idempotencyKey: "buy2" })).number).id);
  await text(t, b);
  const mine = out(await h.numberMine(t.ctx));
  assert.deepEqual(contractErrors("telephony.number.mine", "out", mine), []);
  assert.deepEqual((mine.numbers as Json[]).map((n) => n.id).sort(), [a, b].sort());
  assert.equal(mine.lastUsedId, b);
  t.actAs("person", NOAH);
  assert.deepEqual(out(await h.numberMine(t.ctx)), { numbers: [] }, "none: the composer says so");
});

test("connect tests the credentials at once: a refusal is plain words, a pass brings in every number and points each at this Space", async () => {
  const t = harness();
  t.script("twilio.health", () => ({ state: "down", detail: "Twilio did not accept the credentials. Check Twilio_Account and Twilio_Auth in the Vault." }));
  const no = out(await h.connect(t.ctx, { idempotencyKey: "c1" }));
  assert.deepEqual(contractErrors("telephony.connect", "out", no), []);
  assert.deepEqual([no.connected, no.imported], [false, 0]);
  assert.match(String(no.detail), /did not accept/);
  assert.equal(t.calls("twilio.number.list_owned").length, 0, "nothing else ran");
  t.script("twilio.health", () => ({ state: "healthy", detail: "Twilio has no credentials yet. Add Twilio_Account and Twilio_Auth to the Vault." }));
  assert.equal(out(await h.connect(t.ctx, { idempotencyKey: "c2" })).connected, false, "healthy with nothing to test is not connected");
  t.script("twilio.health", () => ({ state: "healthy" }));
  t.owned.push({ sid: NUM_SID, e164: NUM_E164, capabilities: ["voice", "sms"] }, { sid: "PN00000000000000000000000000000010", e164: "+14155550124", capabilities: ["sms"] });
  const yes = out(await h.connect(t.ctx, { idempotencyKey: "c3" }));
  assert.deepEqual([yes.connected, yes.imported, yes.total, yes.notSetUp], [true, 2, 2, 0]);
  assert.equal(t.calls("twilio.number.configure").length, 2, "webhooks are set by the connect, no per-number setup");
  assert.ok((yes.numbers as Json[]).every((n) => (n.assignees as unknown[]).length === 0), "every new number needs an owner");
  void NOW;
});

test("one number Twilio will not point here does not stop the rest, and it is counted", async () => {
  const t = harness();
  t.script("twilio.health", () => ({ state: "healthy" }));
  t.owned.push({ sid: NUM_SID, e164: NUM_E164, capabilities: ["sms"] }, { sid: "PN00000000000000000000000000000010", e164: "+14155550124", capabilities: ["sms"] });
  t.script("twilio.number.configure", (i) => { if (i["sid"] === NUM_SID) throw t.err("provider.unavailable", "no"); return { number: { sid: String(i["sid"]), e164: "+14155550124", capabilities: ["sms"] } }; });
  const r = out(await h.connect(t.ctx, { idempotencyKey: "c4" }));
  assert.deepEqual([r.connected, r.total, r.notSetUp], [true, 2, 1]);
});

test("a recording is closed in Files and plays only for those the call belongs to", async () => {
  const t = harness();
  await line(t);
  const callId = String(out(await ring(t)).callId);
  await h.ingestRecording(t.ctx, { callSid: CALL_SID, recordingSid: "RE00000000000000000000000000000006", url: "https://api.twilio.com/r.mp3" });
  assert.deepEqual(t.calls("access.labels.set")[0]?.input.label, "restricted", "the shared Calls folder does not show it");
  assert.deepEqual(contractErrors("telephony.call.recording", "out", await h.callRecording(t.ctx, { callId })), []);
  t.actAs("person", ROB);
  t.script("records.get", () => { throw t.err("permission.not_found", "no"); });
  assert.equal(await refusedWith(h.callRecording(t.ctx, { callId })), "validation.not_found");
  assert.equal(t.calls("twilio.recording.read").length, 1, "the audio was never read for them");
});

test("a recording that cannot be closed is not kept where anyone could open it", async () => {
  const t = harness();
  await line(t);
  await ring(t);
  t.script("access.labels.set", () => { throw t.err("internal.unavailable", "no"); });
  await assert.rejects(h.ingestRecording(t.ctx, { callSid: CALL_SID, recordingSid: "RE00000000000000000000000000000006", url: "https://api.twilio.com/r.mp3" }));
  assert.equal(t.calls("files.purge").length, 1);
});

