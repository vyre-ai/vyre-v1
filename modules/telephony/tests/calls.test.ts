// Calls (P-L5_07; spec 2.18 Calls and SMS, Call routing and recording; 3.3 flow 3): an incoming call is routed by the number's route and hours, answered, held, transferred, recorded and ended; every call is written
// to the contact's conversation (inbox.link_message); dial places a call that the voice hook bridges to the dialer; voicemail lands in Files. Twilio, contacts, inbox and files are scripted capabilities,
// each call checked against its frozen contract.
// @reads /modules/telephony/migrations/0001_telephony.sql
// @reads /modules/telephony/handlers/calls.ts
// @reads /modules/telephony/handlers/ingest.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as h from "../handlers/index.ts";
import { AGENT, CALLER, CALL_SID, MAYA, NUM_E164, NUM_SID, REC_SID, ROB, VOICE_URL, contractErrors, eventErrors, harness, refusedWith } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const PAT = "rec_pat00001";
type Json = Record<string, unknown>;
const out = (v: unknown): Json => v as Json;

async function number(t: Harness, recording?: string): Promise<string> {
  const made = out(out(await h.numberBuy(t.ctx, { e164: NUM_E164, title: "Main line", assigneeKind: "person", assigneeId: MAYA, idempotencyKey: "k-buy" })).number);
  const id = String(made.id);
  if (recording) await h.numberSetRecording(t.ctx, { numberId: id, recording });
  return id;
}

const ring = (t: Harness, sid = CALL_SID) => h.ingestVoice(t.ctx, { callSid: sid, from: CALLER, to: NUM_E164, status: "ringing", callerName: "LEE PAT" });
const row = (t: Harness, id: string) => t.rows(`SELECT * FROM telephony_call WHERE id = ?`, id)[0] as Record<string, string | number | null>;

test("an incoming call rings the assignee, is written to the contact's conversation and a replay lands nothing twice", async () => {
  const t = harness();
  t.contacts.set(CALLER, PAT);
  const numberId = await number(t);
  const got = out(await ring(t));
  assert.deepEqual(contractErrors("telephony.ingest_voice", "out", got), []);
  assert.deepEqual(got.instruction, { action: "ring", targets: [{ kind: "person", id: MAYA }], ringSeconds: 20, record: false });

  const call = row(t, String(got.callId));
  assert.deepEqual([call.direction, call.state, call.from, call.to, call.numberId, call.contactId, call.twilioSid], ["in", "ringing", CALLER, NUM_E164, numberId, PAT, CALL_SID]);
  // the call is written to the contact's conversation
  const link = t.calls("inbox.link_message");
  assert.equal(link.length, 1);
  assert.deepEqual(link[0]?.input, { channel: "call", ref: { kind: "call", id: got.callId }, address: CALLER, direction: "in", at: call.startedAt, numberId, preview: "Call from LEE PAT" });
  const ringing = t.named("call.ringing");
  assert.equal(ringing.length, 1);
  assert.equal(ringing[0]?.vis, "participants");
  assert.deepEqual(ringing[0]?.payload, { callId: got.callId, numberId, from: CALLER, contactId: PAT, ringing: [{ kind: "person", id: MAYA }] });

  // Twilio sent the hook twice: one call, one conversation entry, one ring
  const again = out(await ring(t));
  assert.equal(again.callId, got.callId);
  assert.equal(t.rows(`SELECT * FROM telephony_call`).length, 1);
  assert.equal(t.calls("inbox.link_message").length, 1);
  assert.equal(t.named("call.ringing").length, 1);
});

test("hours and the route decide: voicemail outside hours, ring inside, reject when the number turns callers away, a group rings its members", async () => {
  const t = harness();
  const numberId = await number(t);
  await h.numberSetHours(t.ctx, { numberId, hours: { zone: "UTC", weekly: [{ day: 4, start: "09:00", end: "17:00" }], outsideHours: "voicemail" } });
  // 08:53 UTC on a Thursday: the number opens at 09:00
  const closed = out(await ring(t));
  assert.deepEqual(closed.instruction, { action: "voicemail", targets: [], greeting: "Please leave a message after the tone.", record: true });
  assert.equal(row(t, String(closed.callId)).state, "voicemail");
  assert.equal(t.named("call.ringing").length, 0, "nobody is rung outside hours");

  t.advance(7 * 60_000);
  const open = out(await ring(t, "CA00000000000000000000000000000008"));
  assert.equal(out(open.instruction).action, "ring");

  await h.numberSetHours(t.ctx, { numberId, hours: { zone: "UTC", weekly: [{ day: 4, start: "17:00", end: "18:00" }], outsideHours: "reject" } });
  const rejected = out(await ring(t, "CA00000000000000000000000000000009"));
  assert.deepEqual(rejected.instruction, { action: "reject", targets: [], record: false });
  assert.equal(row(t, String(rejected.callId)).state, "missed");
  assert.equal(t.named("call.missed").length, 1, "a turned-away call is a missed call");

  await h.numberSetHours(t.ctx, { numberId, hours: { zone: "UTC", weekly: [], outsideHours: "voicemail" } });
  t.groups.set("grp_front0001", [{ kind: "person", id: MAYA }, { kind: "person", id: ROB }, { kind: "agent", id: AGENT }, { kind: "service", id: "svc_x00001" }]);
  await h.numberSetRoute(t.ctx, { numberId, route: { ring: [{ kind: "group", id: "grp_front0001" }, { kind: "person", id: MAYA }], ringSeconds: 30, voicemail: true, voicemailTranscript: true } });
  const grouped = out(await ring(t, "CA00000000000000000000000000000010"));
  assert.deepEqual(out(grouped.instruction).targets, [{ kind: "person", id: MAYA }, { kind: "person", id: ROB }, { kind: "agent", id: AGENT }], "the group is expanded to people and agents, once each");
  assert.equal(out(grouped.instruction).action, "ring");
  assert.equal(out(grouped.instruction).ringSeconds, 30);
  assert.deepEqual(eventErrors("call.ringing", t.named("call.ringing").at(-1)?.payload), []);

  // no route target and voicemail off: the caller is turned away
  await h.numberAssign(t.ctx, { numberId, assigneeKind: "inbox", assigneeId: "mbx_shared001" });
  await h.numberSetRoute(t.ctx, { numberId, route: { ring: [], ringSeconds: 20, voicemail: false, voicemailTranscript: false } });
  const nobody = out(await ring(t, "CA00000000000000000000000000000011"));
  assert.equal(out(nobody.instruction).action, "reject");

  // a number that is not ours refuses the hook
  assert.equal(await refusedWith(h.ingestVoice(t.ctx, { callSid: "CA00000000000000000000000000000012", from: CALLER, to: "+14155550999", status: "ringing" })), "validation.not_found");
});

test("answer: the first person to answer takes the call; someone it is not ringing for, and a second person, are refused", async () => {
  const t = harness();
  t.contacts.set(CALLER, PAT);
  await number(t);
  const id = String(out(await ring(t)).callId);
  t.actAs("person", ROB);
  assert.equal(await refusedWith(h.answer(t.ctx, { callId: id })), "permission.no_grant", "the call rings Maya, not Rob");
  t.actAs("person", MAYA);
  const answered = out(out(await h.answer(t.ctx, { callId: id })).call);
  assert.deepEqual(contractErrors("telephony.answer", "out", { call: answered }), []);
  assert.deepEqual([answered.state, answered.handledBy, answered.answeredAt], ["answered", { kind: "person", id: MAYA }, 1_760_000_000_000]);
  assert.deepEqual(t.named("call.started")[0]?.payload, { callId: id, numberId: answered.numberId, direction: "in", contactId: PAT });
  assert.equal(await refusedWith(h.answer(t.ctx, { callId: id })), "validation.precondition_failed", "already answered");
  assert.equal(await refusedWith(h.answer(t.ctx, { callId: "cal_nope" })), "validation.not_found");
  assert.equal(await refusedWith(h.answer(t.ctx, { callId: "nope" })), "validation.bad_input");
  t.actAs("service", "svc_engine01");
  const second = String(out(await ring(t, "CA00000000000000000000000000000014")).callId);
  assert.equal(await refusedWith(h.answer(t.ctx, { callId: second })), "validation.precondition_failed", "only a person or an agent holds a call");
});

test("decline: without voicemail the call is missed once nobody else is ringing; with voicemail it goes there", async () => {
  const t = harness();
  const numberId = await number(t);
  await h.numberSetRoute(t.ctx, { numberId, route: { ring: [{ kind: "person", id: MAYA }, { kind: "person", id: ROB }], ringSeconds: 20, voicemail: true, voicemailTranscript: true } });
  const id = String(out(await ring(t)).callId);
  const first = out(out(await h.decline(t.ctx, { callId: id })).call);
  assert.equal(first.state, "ringing", "Rob is still ringing");
  t.actAs("person", ROB);
  const second = out(out(await h.decline(t.ctx, { callId: id })).call);
  assert.equal(second.state, "missed");
  assert.equal(t.named("call.missed").length, 1);
  assert.equal(await refusedWith(h.decline(t.ctx, { callId: id })), "validation.precondition_failed");

  t.actAs("person", MAYA);
  const other = String(out(await ring(t, "CA00000000000000000000000000000015")).callId);
  const vm = out(out(await h.decline(t.ctx, { callId: other, toVoicemail: true })).call);
  assert.equal(vm.state, "voicemail");
  assert.equal(await refusedWith(h.decline(t.ctx, { callId: other, toVoicemail: "yes" as unknown as boolean })), "validation.bad_input");
});

test("hangup ends an answered call with its duration, tells Twilio, and says so once", async () => {
  const t = harness();
  await number(t);
  const id = String(out(await ring(t)).callId);
  await h.answer(t.ctx, { callId: id });
  t.advance(65_000);
  const ended = out(out(await h.hangup(t.ctx, { callId: id })).call);
  assert.deepEqual([ended.state, ended.durationSec], ["completed", 65]);
  assert.deepEqual(t.calls("twilio.call.update")[0]?.input, { sid: CALL_SID, action: "hangup", idempotencyKey: `tel:${id}:hangup` });
  assert.deepEqual(t.named("call.ended")[0]?.payload, { callId: id, numberId: ended.numberId, direction: "in", durationSec: 65 });
  assert.equal(await refusedWith(h.hangup(t.ctx, { callId: id })), "validation.precondition_failed", "already over");
  // Twilio's own completed callback after our hangup changes nothing
  assert.deepEqual(await h.ingestStatus(t.ctx, { sid: CALL_SID, kind: "call", status: "completed", durationSec: 66, at: t.ctx.now() }), { applied: true });
  assert.equal(t.named("call.ended").length, 1);

  // hanging up a ringing inbound call is a missed call
  const ringing = String(out(await ring(t, "CA00000000000000000000000000000016")).callId);
  assert.equal(out(out(await h.hangup(t.ctx, { callId: ringing })).call).state, "missed");
});

test("hold and resume go to Twilio once each way", async () => {
  const t = harness();
  await number(t);
  t.owned.push({ sid: NUM_SID, e164: NUM_E164, capabilities: ["voice", "sms"], voiceUrl: VOICE_URL });
  const id = String(out(await ring(t)).callId);
  assert.equal(await refusedWith(h.hold(t.ctx, { callId: id, hold: true })), "validation.precondition_failed", "a ringing call cannot be held");
  await h.answer(t.ctx, { callId: id });
  await h.hold(t.ctx, { callId: id, hold: true });
  await h.hold(t.ctx, { callId: id, hold: true });
  assert.equal(t.calls("twilio.call.update").length, 1, "holding twice is one hold");
  assert.equal(t.calls("twilio.call.update")[0]?.input.action, "hold");
  await h.hold(t.ctx, { callId: id, hold: false });
  const resume = t.calls("twilio.call.update")[1]?.input;
  assert.deepEqual([resume?.action, resume?.targetUrl], ["resume", VOICE_URL]);
  assert.equal(await refusedWith(h.hold(t.ctx, { callId: id, hold: "yes" as unknown as boolean })), "validation.bad_input");
});

test("transfer: a call in progress moves to a teammate or an agent, warm or cold; groups, the same person and calls not in progress are refused", async () => {
  const t = harness();
  await number(t);
  t.owned.push({ sid: NUM_SID, e164: NUM_E164, capabilities: ["voice", "sms"], voiceUrl: VOICE_URL });
  const id = String(out(await ring(t)).callId);
  assert.equal(await refusedWith(h.transfer(t.ctx, { callId: id, to: { kind: "person", id: ROB }, mode: "warm" })), "validation.precondition_failed", "still ringing");
  await h.answer(t.ctx, { callId: id });

  assert.equal(await refusedWith(h.transfer(t.ctx, { callId: id, to: { kind: "group", id: "grp_front0001" }, mode: "cold" })), "validation.precondition_failed");
  assert.equal(await refusedWith(h.transfer(t.ctx, { callId: id, to: { kind: "person", id: MAYA }, mode: "cold" })), "validation.precondition_failed", "the call is already with Maya");
  assert.equal(await refusedWith(h.transfer(t.ctx, { callId: id, to: { kind: "person", id: ROB }, mode: "lukewarm" })), "validation.bad_input");
  assert.equal(await refusedWith(h.transfer(t.ctx, { callId: id, to: { kind: "person", id: "rob" }, mode: "warm" })), "validation.bad_input");

  const moved = out(out(await h.transfer(t.ctx, { callId: id, to: { kind: "person", id: ROB }, mode: "warm" })).call);
  assert.deepEqual(moved.handledBy, { kind: "person", id: ROB });
  const redirect = t.calls("twilio.call.update").at(-1)?.input;
  assert.deepEqual([redirect?.sid, redirect?.action, redirect?.targetUrl], [CALL_SID, "redirect", `${VOICE_URL}?to=${ROB}&kind=person&call=${id}`]);
  assert.deepEqual(t.named("call.transferred")[0]?.payload, { callId: id, to: { kind: "person", id: ROB }, mode: "warm" });

  const toAgent = out(out(await h.transfer(t.ctx, { callId: id, to: { kind: "agent", id: AGENT }, mode: "cold" })).call);
  assert.deepEqual(toAgent.handledBy, { kind: "agent", id: AGENT });
  assert.equal(t.named("call.transferred").length, 2);
});

test("record follows the number's policy and logs the consent", async () => {
  const t = harness();
  const numberId = await number(t, "ask");
  const id = String(out(await ring(t)).callId);
  assert.equal(await refusedWith(h.record(t.ctx, { callId: id, action: "start" })), "validation.precondition_failed", "a ringing call is not recorded");
  await h.answer(t.ctx, { callId: id });
  assert.equal(await refusedWith(h.record(t.ctx, { callId: id, action: "stop" })), "validation.precondition_failed", "nothing is being recorded");
  assert.equal(await refusedWith(h.record(t.ctx, { callId: id, action: "start" })), "validation.precondition_failed", "no consent given");
  assert.equal(await refusedWith(h.record(t.ctx, { callId: id, action: "start", consent: { announced: true } })), "validation.precondition_failed", "asking needs someone who agreed");
  assert.equal(t.calls("twilio.recording.start").length, 0, "nothing reached Twilio");

  const started = await h.record(t.ctx, { callId: id, action: "start", consent: { announced: true, confirmedBy: "Pat Lee" } });
  assert.deepEqual(started, { recording: true, consentLogged: true });
  assert.deepEqual(contractErrors("telephony.record", "out", started), []);
  assert.deepEqual([t.calls("twilio.recording.start")[0]?.input.callSid, t.calls("twilio.recording.start")[0]?.input.announced], [CALL_SID, true]);
  assert.equal(row(t, id).consentLogged, 1);
  assert.deepEqual(t.named("call.recording_changed")[0]?.payload, { callId: id, recording: true, consentLogged: true });
  assert.deepEqual(await h.record(t.ctx, { callId: id, action: "start", consent: { announced: true, confirmedBy: "Pat Lee" } }), { recording: true, consentLogged: true });
  assert.equal(t.calls("twilio.recording.start").length, 1, "starting twice is one recording");

  const stopped = await h.record(t.ctx, { callId: id, action: "stop" });
  assert.deepEqual(stopped, { recording: false, consentLogged: true }, "the logged consent stays");
  assert.deepEqual([t.calls("twilio.recording.stop")[0]?.input.callSid, t.calls("twilio.recording.stop")[0]?.input.recordingSid], [CALL_SID, REC_SID]);
  assert.equal(t.named("call.recording_changed").length, 2);

  await h.numberSetRecording(t.ctx, { numberId, recording: "off" });
  assert.equal(await refusedWith(h.record(t.ctx, { callId: id, action: "start", consent: { announced: true, confirmedBy: "Pat Lee" } })), "validation.precondition_failed", "recording is off for this number");
  await h.numberSetRecording(t.ctx, { numberId, recording: "announce" });
  assert.equal(await refusedWith(h.record(t.ctx, { callId: id, action: "start" })), "validation.precondition_failed", "announce needs the announcement");
  assert.deepEqual(await h.record(t.ctx, { callId: id, action: "start", consent: { announced: true } }), { recording: true, consentLogged: true });
  assert.equal(await refusedWith(h.record(t.ctx, { callId: id, action: "pause" })), "validation.bad_input");
});

test("a number that announces recording records from the first ring and logs the consent on the call", async () => {
  const t = harness();
  await number(t, "announce");
  const got = out(await ring(t));
  assert.deepEqual(got.instruction, { action: "ring", targets: [{ kind: "person", id: MAYA }], ringSeconds: 20, record: true, announcement: "This call may be recorded." });
  assert.equal(row(t, String(got.callId)).consentLogged, 1);
});

test("dial places the call through Twilio, writes it to the conversation and the voice hook bridges it to the dialer", async () => {
  const t = harness();
  t.contacts.set(CALLER, PAT);
  const numberId = await number(t);
  const placed = out(await h.dial(t.ctx, { numberId, to: CALLER, idempotencyKey: "k-dial" }));
  assert.deepEqual(contractErrors("telephony.dial", "out", placed), []);
  assert.deepEqual(placed.params, { CallId: placed.callId, From: NUM_E164, To: CALLER });
  assert.deepEqual(t.calls("twilio.call.create")[0]?.input, { from: NUM_E164, to: CALLER, idempotencyKey: "k-dial:call" });
  const call = row(t, String(placed.callId));
  assert.deepEqual([call.direction, call.state, call.contactId, call.twilioSid, call.handledBy], ["out", "ringing", PAT, CALL_SID, JSON.stringify({ kind: "person", id: MAYA })]);
  assert.deepEqual(t.calls("inbox.link_message")[0]?.input, { channel: "call", ref: { kind: "call", id: placed.callId }, address: CALLER, direction: "out", at: call.startedAt, numberId, preview: "Outgoing call" });

  // Twilio asks the voice hook what to do when the far end answers: ring the dialer's softphone
  const hook = out(await h.ingestVoice(t.ctx, { callSid: CALL_SID, from: NUM_E164, to: CALLER, status: "in-progress" }));
  assert.equal(hook.callId, placed.callId);
  assert.deepEqual(hook.instruction, { action: "ring", targets: [{ kind: "person", id: MAYA }], ringSeconds: 20, record: false });
  assert.equal(t.rows(`SELECT * FROM telephony_call`).length, 1, "the hook did not make a second call");

  assert.deepEqual(await h.ingestStatus(t.ctx, { sid: CALL_SID, kind: "call", status: "in-progress", at: t.ctx.now() + 5000 }), { applied: true });
  assert.equal(row(t, String(placed.callId)).state, "answered");
  assert.equal(t.named("call.started").length, 1);
  t.advance(30_000);
  await h.ingestStatus(t.ctx, { sid: CALL_SID, kind: "call", status: "completed", durationSec: 30, at: t.ctx.now() });
  assert.deepEqual(t.named("call.ended")[0]?.payload, { callId: placed.callId, numberId, direction: "out", durationSec: 30, contactId: PAT });
});

test("dial refuses what it must: suppressed numbers, Do not contact, recording the number does not allow, numbers that cannot call, callers that cannot hold a call", async () => {
  const t = harness();
  t.contacts.set(CALLER, PAT);
  const numberId = await number(t);
  const dial = (o: Json = {}) => h.dial(t.ctx, { numberId, to: CALLER, idempotencyKey: "k", ...o } as Parameters<typeof h.dial>[1]);
  t.suppressed.set("call", [{ address: CALLER, reason: "do_not_contact" }]);
  assert.equal(await refusedWith(dial()), "validation.precondition_failed");
  t.suppressed.clear();
  t.prefs.set(PAT, { doNotContact: true });
  assert.equal(await refusedWith(dial()), "validation.precondition_failed");
  t.prefs.clear();
  assert.equal(await refusedWith(dial({ record: true })), "validation.precondition_failed", "recording is off");
  await h.numberSetRecording(t.ctx, { numberId, recording: "ask" });
  assert.equal(await refusedWith(dial({ record: true })), "validation.precondition_failed", "this number asks first");
  assert.equal(t.calls("twilio.call.create").length, 0, "nothing was dialed");
  assert.equal(await refusedWith(dial({ to: "4155550177" })), "validation.bad_input");
  assert.equal(await refusedWith(dial({ to: NUM_E164 })), "validation.precondition_failed", "a number cannot call itself");
  assert.equal(await refusedWith(dial({ numberId: "num_nope" })), "validation.not_found");
  assert.equal(await refusedWith(dial({ idempotencyKey: "" })), "validation.bad_input");
  t.actAs("service", "svc_engine01");
  assert.equal(await refusedWith(dial()), "validation.precondition_failed");

  // Twilio refuses: the call row is kept as failed
  t.actAs("person", MAYA);
  t.script("twilio.call.create", () => { throw t.err("provider.rate_limited", "slow down"); });
  assert.equal(await refusedWith(dial()), "provider.rate_limited");
  assert.deepEqual(t.rows(`SELECT * FROM telephony_call`).map((r) => r.state), ["failed"]);

  t.script("twilio.number.buy", (i) => ({ number: { sid: "PN00000000000000000000000000000044", e164: i["e164"], capabilities: ["sms"] } }));
  const smsOnly = out(out(await h.numberBuy(t.ctx, { e164: "+14155550188", title: "Texts", assigneeKind: "person", assigneeId: MAYA, idempotencyKey: "k2" })).number);
  assert.equal(await refusedWith(h.dial(t.ctx, { numberId: String(smsOnly.id), to: CALLER, idempotencyKey: "k3" })), "validation.precondition_failed", "a text-only number cannot call");
});

test("an agent that dials is bridged as an agent, and a record on announce is announced to the callee", async () => {
  const t = harness();
  const numberId = await number(t, "announce");
  t.actAs("agent", AGENT);
  const placed = out(await h.dial(t.ctx, { numberId, to: CALLER, record: true, idempotencyKey: "k-agent" }));
  assert.equal(t.calls("twilio.call.create")[0]?.input.record, true);
  const hook = out(await h.ingestVoice(t.ctx, { callSid: CALL_SID, from: NUM_E164, to: CALLER, status: "in-progress" }));
  assert.equal(hook.callId, placed.callId);
  assert.deepEqual(hook.instruction, { action: "agent", targets: [{ kind: "agent", id: AGENT }], ringSeconds: 20, record: true, announcement: "This call may be recorded." });
  assert.equal(row(t, String(placed.callId)).consentLogged, 1);
});

test("a voicemail lands in Files with the call, once, and a recording for an unknown call is refused", async () => {
  const t = harness();
  t.contacts.set(CALLER, PAT);
  const numberId = await number(t);
  await h.numberSetHours(t.ctx, { numberId, hours: { zone: "UTC", weekly: [{ day: 4, start: "09:00", end: "17:00" }], outsideHours: "voicemail" } });
  const id = String(out(await ring(t)).callId);
  const url = "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE00000000000000000000000000000006";
  const saved = out(await h.ingestRecording(t.ctx, { callSid: CALL_SID, recordingSid: REC_SID, url, durationSec: 17 }));
  assert.deepEqual(contractErrors("telephony.ingest_recording", "out", saved), []);
  assert.deepEqual(t.calls("twilio.recording.download")[0]?.input, { recordingSid: REC_SID });
  const made = t.calls("files.create")[0]?.input as Json;
  assert.equal(made.folderId, "fld_calls0001");
  assert.match(String(made.name), /^Voicemail 2025-10-09 08-53 \+14155550177 /);
  assert.deepEqual([made.content, made.mime, made.kind], [{ blobId: "blb_00000000000000000000000000000001" }, "audio/mpeg", "audio"]);
  assert.deepEqual(t.calls("files.folder.create")[0]?.input, { parentId: "fld_knowledge1", name: "Calls", idempotencyKey: "tel:calls-folder" });
  assert.deepEqual([row(t, id).state, row(t, id).recordingFileId], ["voicemail", saved.fileId]);
  assert.deepEqual(t.named("call.voicemail_left")[0]?.payload, { callId: id, numberId, contactId: PAT });
  assert.deepEqual(t.named("call.recording_ready")[0]?.payload, { callId: id, fileId: saved.fileId });

  // Twilio posts the recording hook again: the same file, nothing saved twice
  assert.deepEqual(await h.ingestRecording(t.ctx, { callSid: CALL_SID, recordingSid: REC_SID, url }), saved);
  assert.equal(t.calls("files.create").length, 1);
  assert.equal(t.named("call.recording_ready").length, 1);

  assert.equal(await refusedWith(h.ingestRecording(t.ctx, { callSid: "CA00000000000000000000000000000099", recordingSid: REC_SID, url })), "validation.not_found");
  assert.equal(await refusedWith(h.ingestRecording(t.ctx, { callSid: CALL_SID, recordingSid: "RE2", url: "http://insecure.example/x" })), "validation.bad_input");

  // the folder is made once and remembered
  const other = String(out(await ring(t, "CA00000000000000000000000000000020")).callId);
  await h.ingestRecording(t.ctx, { callSid: "CA00000000000000000000000000000020", recordingSid: "RE00000000000000000000000000000021", url });
  assert.equal(t.calls("files.folder.create").length, 1);
});

test("an answered call's recording is filed as a Call, not a voicemail", async () => {
  const t = harness();
  await number(t, "announce");
  const id = String(out(await ring(t)).callId);
  await h.answer(t.ctx, { callId: id });
  await h.ingestRecording(t.ctx, { callSid: CALL_SID, recordingSid: REC_SID, url: "https://api.twilio.com/rec/RE6", durationSec: 40 });
  assert.match(String((t.calls("files.create")[0]?.input as Json).name), /^Call 2025-10-09 08-53 \+14155550177 /);
  assert.equal(row(t, id).state, "answered");
  assert.equal(t.named("call.voicemail_left").length, 0);
});

test("status callbacks: unanswered inbound calls are missed, unknown Sids are not applied, and an ended call stays ended", async () => {
  const t = harness();
  await number(t);
  const id = String(out(await ring(t)).callId);
  assert.deepEqual(await h.ingestStatus(t.ctx, { sid: "CA00000000000000000000000000000077", kind: "call", status: "completed", at: t.ctx.now() }), { applied: false });
  assert.deepEqual(await h.ingestStatus(t.ctx, { sid: CALL_SID, kind: "call", status: "ringing", at: t.ctx.now() }), { applied: true });
  assert.equal(row(t, id).state, "ringing");
  assert.deepEqual(await h.ingestStatus(t.ctx, { sid: CALL_SID, kind: "call", status: "no-answer", at: t.ctx.now() }), { applied: true });
  assert.equal(row(t, id).state, "missed");
  assert.deepEqual(t.named("call.missed")[0]?.payload, { callId: id, numberId: row(t, id).numberId, from: CALLER });
  await h.ingestStatus(t.ctx, { sid: CALL_SID, kind: "call", status: "in-progress", at: t.ctx.now() });
  assert.equal(row(t, id).state, "missed", "a late callback does not reopen it");
  assert.equal(await refusedWith(h.ingestStatus(t.ctx, { sid: CALL_SID, kind: "voice" as "call", status: "completed", at: 1 })), "validation.bad_input");

  const failed = String(out(await ring(t, "CA00000000000000000000000000000031")).callId);
  await h.ingestStatus(t.ctx, { sid: "CA00000000000000000000000000000031", kind: "call", status: "failed", at: t.ctx.now() });
  assert.equal(row(t, failed).state, "failed");
  assert.equal(t.named("call.missed").length, 1, "a failed call is not announced as missed");

  // completed without an answer is also a missed inbound call; a voicemail stays a voicemail
  const never = String(out(await ring(t, "CA00000000000000000000000000000032")).callId);
  await h.ingestStatus(t.ctx, { sid: "CA00000000000000000000000000000032", kind: "call", status: "completed", durationSec: 0, at: t.ctx.now() });
  assert.equal(row(t, never).state, "missed");
});

test("the call list, one call, a task logged from a call and an attached summary", async () => {
  const t = harness();
  t.contacts.set(CALLER, PAT);
  const numberId = await number(t);
  const a = String(out(await ring(t, "CA00000000000000000000000000000041")).callId);
  t.advance(1000);
  const b = String(out(await h.dial(t.ctx, { numberId, to: "+14155550166", idempotencyKey: "k-b" })).callId);
  t.advance(1000);
  const c = String(out(await ring(t, "CA00000000000000000000000000000043")).callId);

  const all = out(await h.callList(t.ctx, {}));
  assert.deepEqual(contractErrors("telephony.call.list", "out", all), []);
  assert.deepEqual((all.calls as Json[]).map((x) => x.id), [c, b, a], "newest first");
  assert.deepEqual((out(await h.callList(t.ctx, { direction: "out" })).calls as Json[]).map((x) => x.id), [b]);
  assert.deepEqual((out(await h.callList(t.ctx, { contactId: PAT })).calls as Json[]).map((x) => x.id), [c, a]);
  assert.deepEqual((out(await h.callList(t.ctx, { state: "ringing", numberId })).calls as Json[]).length, 3);
  const page = out(await h.callList(t.ctx, { limit: 2 }));
  assert.deepEqual([(page.calls as Json[]).length, page.next, page.total], [2, "2", 3]);
  assert.deepEqual((out(await h.callList(t.ctx, { limit: 2, cursor: "2" })).calls as Json[]).map((x) => x.id), [a]);
  assert.equal(await refusedWith(h.callList(t.ctx, { direction: "sideways" })), "validation.bad_input");
  assert.equal(await refusedWith(h.callList(t.ctx, { limit: 0 })), "validation.bad_input");
  assert.equal(await refusedWith(h.callList(t.ctx, { cursor: "x" })), "validation.bad_input");

  const task = out(await h.callLogTask(t.ctx, { callId: a, title: "Call Pat back", idempotencyKey: "k-task" }));
  assert.deepEqual(task, { taskId: "tsk_call0001" });
  assert.deepEqual(t.calls("tasks.create")[0]?.input, { title: "Call Pat back", assigned: { kind: "person", id: MAYA }, recordId: PAT, source: { kind: "manual", id: a }, idempotencyKey: "k-task:task" });
  assert.equal(await refusedWith(h.callLogTask(t.ctx, { callId: a, title: " ", idempotencyKey: "k" })), "validation.bad_input");

  assert.equal(await refusedWith(h.callAttachSummary(t.ctx, { callId: a })), "validation.bad_input");
  const withText = out(out(await h.callAttachSummary(t.ctx, { callId: a, transcript: "Pat: please call me.", summary: "Pat wants a call back." })).call);
  assert.deepEqual([withText.hasTranscript, withText.summary], [true, "Pat wants a call back."]);
  assert.deepEqual(t.named("call.transcript_ready")[0]?.payload, { callId: a, contactId: PAT });
  const got = out(await h.callGet(t.ctx, { callId: a }));
  assert.deepEqual(contractErrors("telephony.call.get", "out", got), []);
  assert.equal(got.transcript, "Pat: please call me.");
  assert.equal(out(await h.callGet(t.ctx, { callId: b })).transcript, undefined);
});

test("the softphone token is for people", async () => {
  const t = harness();
  const numberId = await number(t);
  const token = out(await h.voiceToken(t.ctx, { numberId }));
  assert.deepEqual(contractErrors("telephony.voice_token", "out", token), []);
  assert.deepEqual([token.identity, t.calls("twilio.access_token")[0]?.input], [MAYA, { identity: MAYA }]);
  assert.equal(await refusedWith(h.voiceToken(t.ctx, { numberId: "num_nope" })), "validation.not_found");
  t.actAs("agent", AGENT);
  assert.equal(await refusedWith(h.voiceToken(t.ctx, {})), "validation.precondition_failed");
});
