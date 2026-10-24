import test from "node:test";
import assert from "node:assert/strict";
import { VyreErr } from "../../../host/src/routes/errors.ts";
import { handlers } from "../impl.ts";
import { handleHook, saveAccount, twilioSignature } from "../handlers/hooks.ts";
import type { TwilioAccount } from "../handlers/hooks.ts";
import { decideVoice, defaultHours, getNumber, saveNumber, setNumberHours, setNumberRoute, voiceTwiml, withinHours } from "../handlers/numbers.ts";
import type { NumberHours, NumberRoute, StoredNumber } from "../handlers/numbers.ts";
import { testBag } from "../fixtures/harness.ts";

const MON_1500 = 1_767_625_200_000;
const MON_1800 = 1_767_636_000_000;
const SUN_1500 = 1_767_538_800_000;
const LA_OUT = 1_767_664_800_000;
const TOKEN = "12345";
const E164 = "+14155550100";

const weekdays = (): NumberHours => defaultHours();

function route(ids: string[], over: Partial<NumberRoute> = {}): NumberRoute {
  return {
    ring: ids.map((id, i) => ({ kind: i === 0 ? "person" : id.startsWith("agt_") ? "agent" : "person", id })),
    ringSeconds: 15,
    voicemail: true,
    voicemailTranscript: true,
    ...over,
  };
}

function seedNumber(bag: ReturnType<typeof testBag>, hours: NumberHours, r: NumberRoute): void {
  const n: StoredNumber = {
    sid: "PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    e164: E164,
    friendlyName: "Desk",
    capabilities: ["voice", "sms"],
    voiceUrl: null,
    smsUrl: null,
    statusUrl: null,
    twimlAppSid: null,
    route: r,
    hours,
  };
  saveNumber(bag.ctx, n);
}

const acct = (): TwilioAccount => ({
  accountSid: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  authToken: TOKEN,
  apiKeySid: null,
  apiKeySecret: null,
  twimlAppSid: null,
  voiceUrl: null,
});

test("during hours the route rings the owner, then the list, then voicemail", () => {
  const hours = weekdays();
  const r = route(["usr_owner", "usr_ana", "agt_desk"]);
  assert.equal(withinHours(hours, MON_1500), true);
  assert.equal(withinHours(hours, MON_1800), false);
  assert.equal(withinHours(hours, SUN_1500), false);
  const open = decideVoice(r, hours, MON_1500);
  assert.equal(open.action, "ring");
  if (open.action !== "ring") return;
  assert.deepEqual(open.targets.map((p) => p.id), ["usr_owner", "usr_ana", "agt_desk"]);
  assert.equal(open.thenVoicemail, true);
  const twiml = voiceTwiml(open, "https://example.test/hooks/twilio/voice?step=after-dial");
  const owner = twiml.indexOf("<Client>usr_owner</Client>");
  const ana = twiml.indexOf("<Client>usr_ana</Client>");
  const desk = twiml.indexOf("<Client>agt_desk</Client>");
  assert.ok(owner >= 0 && owner < ana && ana < desk);
  assert.match(twiml, /sequential="true"/);
  assert.match(twiml, /timeout="15"/);
  assert.match(twiml, /step=after-dial/);
  assert.doesNotMatch(twiml, /<Record/);
});

test("outside hours follows voicemail, reject or ring", () => {
  const r = route(["usr_owner", "usr_ana"]);
  const closed = decideVoice(r, weekdays(), MON_1800);
  assert.equal(closed.action, "voicemail");
  if (closed.action === "voicemail") {
    const twiml = voiceTwiml(closed, "");
    assert.match(twiml, /<Record/);
    assert.match(twiml, /transcribe="true"/);
    assert.doesNotMatch(twiml, /<Client/);
  }
  const rejectHours: NumberHours = { ...weekdays(), outsideHours: "reject" };
  assert.equal(decideVoice(r, rejectHours, SUN_1500).action, "reject");
  assert.match(voiceTwiml({ action: "reject" }, ""), /<Reject\/>/);
  const ringHours: NumberHours = { ...weekdays(), outsideHours: "ring" };
  assert.equal(decideVoice(r, ringHours, MON_1800).action, "ring");
});

test("Los Angeles hours use the number zone, not UTC", () => {
  const hours: NumberHours = { zone: "America/Los_Angeles", weekly: [{ day: 1, start: "09:00", end: "17:00" }], outsideHours: "voicemail" };
  assert.equal(withinHours(hours, MON_1800), true);
  assert.equal(withinHours(hours, LA_OUT), false);
});

test("a bought number keeps the owner route and hours, and the voice hook follows them", async () => {
  const bag = testBag(MON_1500);
  saveAccount(bag.ctx, acct());
  bag.ctx.http = async (_url, init) => {
    assert.equal(init?.method, "POST");
    return {
      status: 201,
      text: async () => JSON.stringify({
        sid: "PNbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        phone_number: E164,
        friendly_name: "Desk",
        capabilities: { voice: true, sms: true, mms: false },
      }),
    };
  };
  const bought = await handlers["twilio.number.buy"](bag.ctx, { e164: E164, friendlyName: "Desk", idempotencyKey: "buy-1" });
  assert.equal(bought.number.sid, "PNbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  const stored = getNumber(bag.ctx, bought.number.sid);
  assert.ok(stored);
  assert.deepEqual(stored?.route.ring.map((p) => p.id), ["usr_owner"]);
  assert.equal(stored?.route.voicemail, true);
  assert.equal(stored?.hours.outsideHours, "voicemail");
  assert.equal(stored?.hours.weekly.length, 5);

  const next = route(["usr_owner", "usr_ana", "agt_desk"]);
  setNumberRoute(bag.ctx, bought.number.sid, next);
  const open = await signedVoice(bag, E164, "ringing");
  assert.match(open.body, /<Client>usr_owner<\/Client><Client>usr_ana<\/Client><Client>agt_desk<\/Client>/);

  bag.clock.now = MON_1800;
  const closed = await signedVoice(bag, E164, "ringing-late", "CA999late");
  assert.match(closed.body, /<Record/);
  assert.doesNotMatch(closed.body, /<Dial/);

  setNumberHours(bag.ctx, bought.number.sid, { ...weekdays(), outsideHours: "reject" });
  const rejected = await signedVoice(bag, E164, "ringing-reject", "CA999rej");
  assert.match(rejected.body, /<Reject\/>/);
});

test("after the ring list, an unanswered call goes to voicemail and an answered call does not", async () => {
  const bag = testBag(MON_1500);
  saveAccount(bag.ctx, acct());
  seedNumber(bag, weekdays(), route(["usr_owner", "usr_ana"], { voicemailTranscript: false }));
  const missed = await signedVoice(bag, E164, "completed", "CA777", "https://example.test/hooks/twilio/voice?step=after-dial", { DialCallStatus: "no-answer" });
  assert.match(missed.body, /<Record/);
  assert.match(missed.body, /transcribe="false"/);
  const answered = await signedVoice(bag, E164, "completed", "CA778", "https://example.test/hooks/twilio/voice?step=after-dial", { DialCallStatus: "completed" });
  assert.doesNotMatch(answered.body, /<Record/);
  assert.match(answered.body, /<Response><\/Response>/);
});

test("a route with no ring time is refused", () => {
  const bag = testBag();
  seedNumber(bag, weekdays(), route(["usr_owner"]));
  assert.throws(() => setNumberRoute(bag.ctx, "PNaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", route(["usr_owner"], { ringSeconds: 1 })), (e: unknown) => e instanceof VyreErr && e.error.code === "validation.bad_input");
});

async function signedVoice(
  bag: ReturnType<typeof testBag>,
  to: string,
  status: string,
  sid = "CA1234567890ABCDE",
  url = "https://example.test/hooks/twilio/voice",
  extra: Record<string, string> = {},
) {
  const params = { CallSid: sid, CallStatus: status, From: "+14158675309", To: to, Caller: "+14158675309", ...extra };
  const signature = await twilioSignature(url, params, TOKEN);
  return handleHook(bag.ctx, { kind: "voice", url, params, signature });
}
