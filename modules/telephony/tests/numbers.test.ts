// Numbers and the US texting registration (P-L5_07; spec 2.18 Calls and SMS, Call routing and recording): buy, import, assign, route, hours, recording policy, release, and the registration from draft
// to approved or rejected. Twilio is a scripted capability, each call checked against its frozen contract.
// @reads /modules/telephony/migrations/0001_telephony.sql
// @reads /modules/telephony/handlers/numbers.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as h from "../handlers/index.ts";
import { CALLER, CALL_SID, MAYA, NUM_E164, NUM_SID, ROB, VOICE_URL, contractErrors, eventErrors, harness, refusedWith } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (v: unknown): Json => v as Json;
const buy = (t: ReturnType<typeof harness>, o: Json = {}) =>
  h.numberBuy(t.ctx, { e164: NUM_E164, title: "Main line", assigneeKind: "person", assigneeId: MAYA, idempotencyKey: "k-buy", ...o } as Parameters<typeof h.numberBuy>[1]);

test("buy: the number is bought, pointed at the Space, assigned and ringing its owner; duplicates and bad input are refused", async () => {
  const t = harness();
  t.settings.set("telephony.recording_default", "announce");
  const got = out(await buy(t));
  assert.deepEqual(contractErrors("telephony.number.buy", "out", got), []);
  const n = out(got.number);
  assert.deepEqual([n.e164, n.title, n.displayName, n.assigneeKind, n.assigneeId, n.recording, n.a2p, n.state], [NUM_E164, "Main line", "Main line", "person", MAYA, "announce", "none", "active"]);
  assert.deepEqual(n.route, { ring: [{ kind: "person", id: MAYA }], ringSeconds: 20, voicemail: true, voicemailTranscript: true });
  assert.deepEqual(n.capabilities, ["voice", "sms", "mms"]);
  assert.deepEqual(t.calls("twilio.number.buy")[0]?.input, { e164: NUM_E164, friendlyName: "Main line", idempotencyKey: "k-buy:buy" });
  assert.deepEqual(t.calls("twilio.number.configure")[0]?.input, { sid: NUM_SID, idempotencyKey: "k-buy:configure" });
  assert.deepEqual(t.named("number.purchased")[0]?.payload, { numberId: n.id, e164: NUM_E164 });

  assert.equal(await refusedWith(buy(t)), "validation.duplicate");
  assert.equal(t.calls("twilio.number.buy").length, 1, "Twilio was not asked twice");
  assert.equal(await refusedWith(buy(t, { e164: "4155550123" })), "validation.bad_input");
  assert.equal(await refusedWith(buy(t, { e164: "+14155550124", title: " " })), "validation.bad_input");
  assert.equal(await refusedWith(buy(t, { e164: "+14155550124", assigneeId: "maya" })), "validation.bad_input");
  assert.equal(await refusedWith(buy(t, { e164: "+14155550124", assigneeKind: "robot" })), "validation.bad_input");
  assert.equal(await refusedWith(buy(t, { e164: "+14155550124", assigneeKind: "inbox", assigneeId: "" })), "validation.bad_input");
  assert.equal(await refusedWith(buy(t, { e164: "+14155550124", idempotencyKey: "" })), "validation.bad_input");
  t.script("twilio.number.buy", () => { throw t.err("provider.auth_failed", "no"); });
  assert.equal(await refusedWith(buy(t, { e164: "+14155550124" })), "provider.auth_failed");
  assert.equal(t.rows(`SELECT * FROM telephony_number`).length, 1, "a number Twilio would not sell is not kept");

  // a shared inbox rings nobody until a route says so
  t.script("twilio.number.buy", (i) => ({ number: { sid: "PN00000000000000000000000000000055", e164: i["e164"], capabilities: ["voice", "sms"] } }));
  const shared = out(out(await buy(t, { e164: "+14155550125", title: "Shared", assigneeKind: "inbox", assigneeId: "mbx_front0001" })).number);
  assert.deepEqual(out(shared.route).ring, []);
  assert.equal(t.named("number.purchased").length, 2);
});

test("list, get and search: numbers by assignee, one number, and what Twilio has for sale", async () => {
  const t = harness();
  const a = out(out(await buy(t)).number);
  t.owned.push({ sid: "PN00000000000000000000000000000056", e164: "+14155550124", capabilities: ["voice", "sms"] });
  t.actAs("person", ROB);
  await h.numberImport(t.ctx, { idempotencyKey: "k-imp" });
  t.actAs("person", MAYA);
  const all = out(await h.numberList(t.ctx, {}));
  assert.deepEqual(contractErrors("telephony.number.list", "out", all), []);
  assert.deepEqual((all.numbers as Json[]).map((n) => n.e164), [NUM_E164, "+14155550124"]);
  assert.equal((all.numbers as Json[])[1]?.displayName, "+1 (415) 555-0124", "no title: the number formatted for reading");
  assert.equal((all.numbers as Json[])[0]?.displayName, "Main line");
  assert.deepEqual((out(await h.numberList(t.ctx, { assigneeId: ROB })).numbers as Json[]).map((n) => n.e164), ["+14155550124"]);
  assert.equal(out(await h.numberList(t.ctx, { limit: 1 })).next, "1");
  assert.equal(await refusedWith(h.numberList(t.ctx, { limit: 0 })), "validation.bad_input");
  const one = out(await h.numberGet(t.ctx, { numberId: String(a.id) }));
  assert.deepEqual(contractErrors("telephony.number.get", "out", one), []);
  assert.equal(await refusedWith(h.numberGet(t.ctx, { numberId: "num_nope" })), "validation.not_found");
  assert.equal(await refusedWith(h.numberGet(t.ctx, { numberId: "nope" })), "validation.bad_input");

  const found = out(await h.numberSearch(t.ctx, { country: "US", areaCode: "415" }));
  assert.deepEqual(contractErrors("telephony.number.search", "out", found), []);
  assert.deepEqual(t.calls("twilio.number.search")[0]?.input, { country: "US", areaCode: "415" });
});

test("import brings the account's own numbers into the Space once, owned by whoever imports", async () => {
  const t = harness();
  await buy(t);
  t.owned.push(
    { sid: NUM_SID, e164: NUM_E164, capabilities: ["voice", "sms"] },
    { sid: "PN00000000000000000000000000000010", e164: "+14155550124", friendlyName: "Front desk", capabilities: ["voice", "sms"], voiceUrl: VOICE_URL },
    { sid: "PN00000000000000000000000000000011", e164: "+14155550125", capabilities: ["fax"] },
  );
  assert.equal(await refusedWith(h.numberImport(t.ctx, { e164: ["12"], idempotencyKey: "k" })), "validation.bad_input");
  assert.equal(await refusedWith(h.numberImport(t.ctx, { idempotencyKey: "" })), "validation.bad_input");
  const some = out(await h.numberImport(t.ctx, { e164: ["+14155550124", "+14155550999"], idempotencyKey: "k-imp" }));
  assert.deepEqual(contractErrors("telephony.number.import", "out", some), []);
  assert.equal(some.imported, 1);
  const n = (some.numbers as Json[])[0] ?? {};
  assert.deepEqual([n.e164, n.title, n.assigneeKind, n.assigneeId, n.capabilities], ["+14155550124", "Front desk", "person", MAYA, ["voice", "sms"]]);
  assert.deepEqual(t.named("number.assigned")[0]?.payload, { numberId: n.id, assigneeKind: "person", assigneeId: MAYA });
  const rest = out(await h.numberImport(t.ctx, { idempotencyKey: "k-imp2" }));
  assert.equal(rest.imported, 1, "the bought number and the first import are skipped");
  assert.equal((rest.numbers as Json[])[0]?.e164, "+14155550125");
  assert.deepEqual((rest.numbers as Json[])[0]?.capabilities, ["voice"], "a number with no known capability starts as voice only");
  assert.equal(out(await h.numberImport(t.ctx, { idempotencyKey: "k-imp3" })).imported, 0);
});

test("assign moves the number and, when its route only rang the old owner, the route follows", async () => {
  const t = harness();
  const id = String(out(out(await buy(t)).number).id);
  const moved = out(out(await h.numberAssign(t.ctx, { numberId: id, assigneeKind: "person", assigneeId: ROB })).number);
  assert.deepEqual([moved.assigneeId, out(moved.route).ring], [ROB, [{ kind: "person", id: ROB }]]);
  assert.deepEqual(t.named("number.assigned")[0]?.payload, { numberId: id, assigneeKind: "person", assigneeId: ROB });
  // a route someone set by hand stays as it is
  await h.numberSetRoute(t.ctx, { numberId: id, route: { ring: [{ kind: "person", id: MAYA }, { kind: "person", id: ROB }], ringSeconds: 40, voicemail: false, voicemailTranscript: false } });
  const again = out(out(await h.numberAssign(t.ctx, { numberId: id, assigneeKind: "agent", assigneeId: "agt_intake01" })).number);
  assert.deepEqual([again.assigneeKind, out(again.route).ring], ["agent", [{ kind: "person", id: MAYA }, { kind: "person", id: ROB }]]);
  assert.equal(await refusedWith(h.numberAssign(t.ctx, { numberId: id, assigneeKind: "person", assigneeId: "rob" })), "validation.bad_input");
  assert.equal(await refusedWith(h.numberAssign(t.ctx, { numberId: "num_nope", assigneeKind: "person", assigneeId: ROB })), "validation.not_found");
});

test("route, hours and recording policy are validated, saved and announced", async () => {
  const t = harness();
  const id = String(out(out(await buy(t)).number).id);
  const route = { ring: [{ kind: "person", id: MAYA }, { kind: "group", id: "grp_front0001" }], ringSeconds: 45, voicemail: true, voicemailTranscript: false };
  const saved = out(out(await h.numberSetRoute(t.ctx, { numberId: id, route })).number);
  assert.deepEqual(saved.route, route);
  assert.deepEqual(t.named("number.route_changed")[0]?.payload, { numberId: id, fields: ["route"] });
  assert.equal(await refusedWith(h.numberSetRoute(t.ctx, { numberId: id, route: { ...route, ringSeconds: 3 } })), "validation.bad_input");
  assert.equal(await refusedWith(h.numberSetRoute(t.ctx, { numberId: id, route: { ...route, voicemail: "yes" as unknown as boolean } })), "validation.bad_input");
  assert.equal(await refusedWith(h.numberSetRoute(t.ctx, { numberId: id, route: { ...route, ring: [route.ring[0] as never, route.ring[0] as never] } })), "validation.bad_input");
  assert.equal(await refusedWith(h.numberSetRoute(t.ctx, { numberId: id, route: { ...route, ring: [{ kind: "robot", id: "x" } as never] } })), "validation.bad_input");
  assert.equal(await refusedWith(h.numberSetRoute(t.ctx, { numberId: id, route: { ...route, ring: [{ kind: "person", id: "maya" } as never] } })), "validation.bad_input");

  const hours = { zone: "America/Los_Angeles", weekly: [{ day: 1, start: "09:00", end: "17:00" }, { day: 2, start: "09:00", end: "12:30" }], outsideHours: "reject" as const };
  assert.deepEqual(out(out(await h.numberSetHours(t.ctx, { numberId: id, hours })).number).hours, hours);
  assert.deepEqual(t.named("number.route_changed")[1]?.payload, { numberId: id, fields: ["hours"] });
  for (const bad of [{ ...hours, zone: "Mars/Base" }, { ...hours, outsideHours: "sing" }, { ...hours, weekly: [{ day: 7, start: "09:00", end: "17:00" }] },
    { ...hours, weekly: [{ day: 1, start: "9:00", end: "17:00" }] }, { ...hours, weekly: [{ day: 1, start: "17:00", end: "09:00" }] }]) {
    assert.equal(await refusedWith(h.numberSetHours(t.ctx, { numberId: id, hours: bad as never })), "validation.bad_input");
  }

  assert.equal(out(out(await h.numberSetRecording(t.ctx, { numberId: id, recording: "ask" })).number).recording, "ask");
  assert.deepEqual(t.named("number.route_changed")[2]?.payload, { numberId: id, fields: ["recording"] });
  await h.numberSetRecording(t.ctx, { numberId: id, recording: "ask" });
  assert.equal(t.named("number.route_changed").length, 3, "the same policy again changes nothing");
  assert.equal(await refusedWith(h.numberSetRecording(t.ctx, { numberId: id, recording: "always" })), "validation.bad_input");
  const read = out(await h.numberGet(t.ctx, { numberId: id }));
  assert.deepEqual(contractErrors("telephony.number.get", "out", read), []);
  for (const e of t.named("number.route_changed")) assert.deepEqual(eventErrors("number.route_changed", e.payload), []);
});

test("release hands the number back to Twilio once no call is in progress, and a released number takes no calls", async () => {
  const t = harness();
  const id = String(out(out(await buy(t)).number).id);
  const call = out(await h.ingestVoice(t.ctx, { callSid: CALL_SID, from: CALLER, to: NUM_E164, status: "ringing" }));
  assert.equal(await refusedWith(h.numberRelease(t.ctx, { numberId: id, idempotencyKey: "k-rel" })), "validation.precondition_failed", "a call is ringing");
  assert.equal(t.calls("twilio.number.release").length, 0);
  await h.hangup(t.ctx, { callId: String(call.callId) });
  assert.deepEqual(await h.numberRelease(t.ctx, { numberId: id, idempotencyKey: "k-rel" }), { released: true });
  assert.deepEqual(t.calls("twilio.number.release")[0]?.input, { sid: NUM_SID, idempotencyKey: "k-rel:release" });
  assert.deepEqual(t.named("number.released")[0]?.payload, { numberId: id, e164: NUM_E164 });
  assert.deepEqual(await h.numberRelease(t.ctx, { numberId: id, idempotencyKey: "k-rel2" }), { released: true });
  assert.equal(t.calls("twilio.number.release").length, 1, "releasing twice is one release");
  assert.deepEqual((out(await h.numberList(t.ctx, {})).numbers as Json[]).length, 0, "a released number is out of the list");
  assert.equal(await refusedWith(h.ingestVoice(t.ctx, { callSid: "CA00000000000000000000000000000099", from: CALLER, to: NUM_E164, status: "ringing" })), "validation.not_found");
  assert.equal(await refusedWith(h.numberAssign(t.ctx, { numberId: id, assigneeKind: "person", assigneeId: ROB })), "validation.precondition_failed");
  assert.equal(await refusedWith(h.numberRelease(t.ctx, { numberId: "num_nope", idempotencyKey: "k" })), "validation.not_found");

  // Twilio refuses the release: the number stays
  const t2 = harness();
  const id2 = String(out(out(await buy(t2)).number).id);
  t2.script("twilio.number.release", () => { throw t2.err("provider.auth_failed", "no"); });
  assert.equal(await refusedWith(h.numberRelease(t2.ctx, { numberId: id2, idempotencyKey: "k-rel" })), "provider.auth_failed");
  assert.equal(out(out(await h.numberGet(t2.ctx, { numberId: id2 })).number).state, "active");
});

const draft = {
  legalName: "Freeman Wine LLC", ein: "12-3456789", website: "https://example.com", contactName: "Dana Wine", contactEmail: "dana@example.com", useCase: "MIXED",
  sampleMessages: ["Your consult is Friday at 3. Reply STOP to opt out."], optInDescription: "Clients give their number on the intake form and agree to texts.",
  address: { line1: "1 Main St", city: "Charleston", region: "SC", postal: "29401", country: "US" },
};

test("registration: draft, validate, submit to Twilio, then follow Twilio's review to approved; numbers follow", async () => {
  const t = harness();
  const id = String(out(out(await buy(t)).number).id);
  assert.deepEqual(await h.registrationGet(t.ctx), {}, "no registration yet");
  assert.equal(await refusedWith(h.registrationSave(t.ctx, { legalName: "" })), "validation.bad_input");
  assert.equal(await refusedWith(h.registrationSave(t.ctx, { legalName: "X", ein: "123" })), "validation.bad_input");
  assert.equal(await refusedWith(h.registrationSave(t.ctx, { legalName: "X", website: "ftp://x" })), "validation.bad_input");
  assert.equal(await refusedWith(h.registrationSave(t.ctx, { legalName: "X", contactEmail: "nope" })), "validation.bad_input");
  assert.equal(await refusedWith(h.registrationSave(t.ctx, { legalName: "X", sampleMessages: Array(6).fill("hi") })), "validation.bad_input");
  assert.equal(await refusedWith(h.registrationSave(t.ctx, { legalName: "X", address: { line1: "1 Main St" } })), "validation.bad_input");

  const partial = out(out(await h.registrationSave(t.ctx, { legalName: "Freeman Wine LLC", ein: "12-3456789" })).registration);
  assert.deepEqual(contractErrors("telephony.registration.save", "out", { registration: partial }), []);
  assert.deepEqual([partial.state, partial.legalName, partial.ein], ["draft", "Freeman Wine LLC", "12-3456789"]);
  assert.equal(await refusedWith(h.registrationSubmit(t.ctx, { registrationId: String(partial.id), idempotencyKey: "k-sub" })), "validation.precondition_failed", "it still needs the rest");
  assert.equal(t.calls("twilio.a2p.create_brand").length, 0);

  const full = out(out(await h.registrationSave(t.ctx, draft)).registration);
  assert.equal(full.id, partial.id, "one registration per Space");
  assert.equal(t.rows(`SELECT * FROM telephony_registration`).length, 1);
  assert.equal(await refusedWith(h.registrationSubmit(t.ctx, { registrationId: "reg_nope", idempotencyKey: "k" })), "validation.not_found");
  assert.equal(await refusedWith(h.registrationRefresh(t.ctx, { registrationId: String(full.id) })), "validation.precondition_failed", "not submitted yet");

  const sent = out(out(await h.registrationSubmit(t.ctx, { registrationId: String(full.id), idempotencyKey: "k-sub" })).registration);
  assert.deepEqual(contractErrors("telephony.registration.submit", "out", { registration: sent }), []);
  assert.equal(sent.state, "submitted");
  assert.deepEqual(t.calls("twilio.a2p.create_brand")[0]?.input, {
    legalName: "Freeman Wine LLC", ein: "12-3456789", website: "https://example.com", address: draft.address, contactName: "Dana Wine", contactEmail: "dana@example.com", idempotencyKey: "k-sub:brand",
  });
  assert.deepEqual(t.calls("twilio.a2p.create_campaign")[0]?.input, {
    brandSid: "BN00000000000000000000000000000007", useCase: "MIXED", description: "Freeman Wine LLC: MIXED", sampleMessages: draft.sampleMessages, optInDescription: draft.optInDescription, idempotencyKey: "k-sub:campaign",
  });
  assert.deepEqual(t.named("registration.submitted")[0]?.payload, { registrationId: full.id });
  assert.equal(out(out(await h.numberGet(t.ctx, { numberId: id })).number).a2p, "pending");
  assert.equal(await refusedWith(h.registrationSave(t.ctx, draft)), "validation.precondition_failed", "it cannot change while Twilio reviews it");
  assert.equal(await refusedWith(h.registrationSubmit(t.ctx, { registrationId: String(full.id), idempotencyKey: "k-sub2" })), "validation.precondition_failed");

  // Twilio is still reviewing: in review, announced once
  await h.registrationRefresh(t.ctx, { registrationId: String(full.id) });
  assert.equal(out(out(await h.registrationGet(t.ctx)).registration).state, "in_review");
  await h.registrationRefresh(t.ctx, { registrationId: String(full.id) });
  assert.equal(t.named("registration.status_changed").length, 1);
  t.script("twilio.a2p.status", () => ({ brand: "approved", campaign: "verified" }));
  const approved = out(out(await h.registrationRefresh(t.ctx, { registrationId: String(full.id) })).registration);
  assert.equal(approved.state, "approved");
  assert.deepEqual(t.named("registration.status_changed").map((e) => e.payload.state), ["in_review", "approved"]);
  assert.equal(out(out(await h.numberGet(t.ctx, { numberId: id })).number).a2p, "approved");
  assert.equal(await refusedWith(h.registrationSave(t.ctx, draft)), "validation.precondition_failed", "approved registrations are final");
});

test("a rejected registration says why, goes back to draft when saved again, and numbers follow", async () => {
  const t = harness();
  const id = String(out(out(await buy(t)).number).id);
  const reg = out(out(await h.registrationSave(t.ctx, draft)).registration);
  await h.registrationSubmit(t.ctx, { registrationId: String(reg.id), idempotencyKey: "k-sub" });
  t.script("twilio.a2p.status", () => ({ brand: "failed", campaign: "pending", rejectedReason: "Business name does not match the EIN" }));
  const rejected = out(out(await h.registrationRefresh(t.ctx, { registrationId: String(reg.id) })).registration);
  assert.deepEqual([rejected.state, rejected.rejectedReason], ["rejected", "Business name does not match the EIN"]);
  assert.deepEqual(contractErrors("telephony.registration.refresh", "out", { registration: rejected }), []);
  assert.equal(out(out(await h.numberGet(t.ctx, { numberId: id })).number).a2p, "rejected");
  assert.equal(t.named("registration.status_changed").at(-1)?.payload.state, "rejected");

  const fixed = out(out(await h.registrationSave(t.ctx, { ...draft, legalName: "Freeman Wine, LLC" })).registration);
  assert.deepEqual([fixed.id, fixed.state, fixed.rejectedReason], [reg.id, "draft", undefined]);
  assert.equal(out(out(await h.numberGet(t.ctx, { numberId: id })).number).a2p, "none");
  t.script("twilio.a2p.status", () => ({ brand: "pending", campaign: "failed" }));
  await h.registrationSubmit(t.ctx, { registrationId: String(reg.id), idempotencyKey: "k-sub-again" });
  const again = out(out(await h.registrationRefresh(t.ctx, { registrationId: String(reg.id) })).registration);
  assert.deepEqual([again.state, again.rejectedReason], ["rejected", "Twilio rejected the registration."], "a campaign rejection without words still has a reason");
});
