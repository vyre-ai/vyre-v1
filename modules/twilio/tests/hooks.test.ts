// The Twilio hooks and the live side of calls and texts against recorded responses (spec 2.18; ARCH 8): the request signature, the four webhooks replayed (each
// delivery applied once), the TwiML a call is answered with, the Voice JS access token, calls, recordings and texts.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  accessToken, acceptHook, callCreate, callGet, callUpdate, hookInput, receiveWebhook, recordingDelete, recordingDownload, recordingStart, recordingStop, signatureMatches, signatureOf, smsSend, voiceTwiml,
} from "../handlers/index.ts";
import { handlers, setTwilioHost } from "../impl.ts";
import { registry } from "../../../generated/registry.ts";
import {
  ACCOUNT, API_KEY, APP_SID, AUTH, BASIC_ACCOUNT, CALL_SID, codeOf, contractErrors, harness, HOOKS, NOW, PUBLIC_URL, REC_SID, RECORDED, REST,
} from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

const API = "api.twilio.com";
const HOOK_URL = `${PUBLIC_URL}/hooks/twilio/voice`;
const sign = (url: string, params: Record<string, string>): string => signatureOf(AUTH, url, params);

// ---- the signature

test("Twilio signs the full address followed by each parameter name and value, names in order, with HMAC-SHA1 and the auth token", () => {
  const params = { To: "+18005551212", Digits: "1234", CallSid: "CA1234567890ABCDE", From: "+14158675310" };
  const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const joined = `${url}CallSidCA1234567890ABCDEDigits1234From+14158675310To+18005551212`;
  const expected = createHmac("sha1", "12345").update(joined).digest("base64");
  assert.equal(signatureOf("12345", url, params), expected);
  assert.equal(signatureMatches("12345", url, params, expected), true);
});

test("a signature fails when the token, the address, a value or a name differs, or when it has a different length", () => {
  const url = HOOK_URL;
  const params = { A: "1", B: "2" };
  const good = signatureOf(AUTH, url, params);
  assert.equal(signatureMatches(AUTH, url, params, good), true);
  assert.equal(signatureMatches("other-token", url, params, good), false);
  assert.equal(signatureMatches(AUTH, `${url}x`, params, good), false);
  assert.equal(signatureMatches(AUTH, url, { A: "1", B: "3" }, good), false);
  assert.equal(signatureMatches(AUTH, url, { A: "1", C: "2" }, good), false);
  assert.equal(signatureMatches(AUTH, url, params, "short"), false);
  assert.equal(signatureMatches(AUTH, url, params, ""), false);
});

test("a delivery with a valid signature is accepted and named by its Sid; one with an invalid signature is refused and nothing is landed", async () => {
  const h = harness();
  const params = { ...HOOKS.voice };
  const accepted = await acceptHook(h.ctx, { kind: "voice", url: HOOK_URL, params, signature: sign(HOOK_URL, params) });
  assert.deepEqual(accepted, { kind: "voice", sid: CALL_SID, dedupeKey: `voice:${CALL_SID}`, params });
  assert.deepEqual(contractErrors("twilio.receive_webhook", "in", accepted), []);

  await refused(acceptHook(h.ctx, { kind: "voice", url: HOOK_URL, params, signature: sign(HOOK_URL, { ...params, From: "+19998887777" }) }), "auth.bad_credentials");   // a changed value
  await refused(acceptHook(h.ctx, { kind: "voice", url: HOOK_URL, params, signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=" }), "auth.bad_credentials");
  await refused(acceptHook(h.ctx, { kind: "voice", url: HOOK_URL, params, signature: undefined }), "auth.bad_credentials");
  await refused(acceptHook(h.ctx, { kind: "voice", url: `${PUBLIC_URL}/hooks/twilio/sms`, params, signature: sign(HOOK_URL, params) }), "auth.bad_credentials");   // signed for another address
  await refused(acceptHook(h.ctx, { kind: "fax", url: HOOK_URL, params, signature: sign(HOOK_URL, params) }), "validation.bad_input");
  assert.equal(h.called.length, 0, "a refused request reaches no other capability");
  assert.equal(h.emitted.length, 0);
});

test("a signed delivery missing the Sid it is named by is refused as bad input, for each kind", async () => {
  const h = harness();
  for (const [kind, params] of [["voice", { To: "+14155550123" }], ["sms", { Body: "x" }], ["status", { CallSid: CALL_SID }], ["recording", { CallSid: CALL_SID }]] as const) {
    await refused(acceptHook(h.ctx, { kind, url: HOOK_URL, params, signature: sign(HOOK_URL, params) }), "validation.bad_input");
  }
});

test("the dedupe key is built from the Sid plus the status, so a call has one key per status", () => {
  const h = harness();
  assert.equal(hookInput(h.ctx, "status", HOOKS.statusCall).dedupeKey, `status:${CALL_SID}:completed`);
  assert.equal(hookInput(h.ctx, "status", { ...HOOKS.statusCall, CallStatus: "ringing" }).dedupeKey, `status:${CALL_SID}:ringing`);
  assert.equal(hookInput(h.ctx, "status", HOOKS.statusSms).dedupeKey, "status:SM00000000000000000000000000000021:undelivered");
  assert.equal(hookInput(h.ctx, "recording", HOOKS.recording).dedupeKey, `recording:${REC_SID}:completed`);
  assert.equal(hookInput(h.ctx, "sms", HOOKS.sms).dedupeKey, "sms:SM00000000000000000000000000000020");
});

// ---- twilio.receive_webhook: connector replay

test("replay: an incoming call is landed once, answered with TwiML that rings the person, and a second delivery gets the same answer without landing again", async () => {
  const h = harness();
  const input = hookInput(h.ctx, "voice", HOOKS.voice);
  const out = await receiveWebhook(h.ctx, input);
  assert.equal(out.accepted, true);
  assert.deepEqual(contractErrors("twilio.receive_webhook", "out", out), []);
  assert.match(out.twiml ?? "", /^<\?xml version="1.0" encoding="UTF-8"\?><Response>/);
  assert.match(out.twiml ?? "", /<Dial timeout="25" callerId="\+14155550123"><Client>usr_maya0001<\/Client><\/Dial>/);
  assert.deepEqual(h.calls("telephony.ingest_voice").map((c) => c.input), [{ callSid: CALL_SID, from: "+14155550177", to: "+14155550123", status: "ringing", callerName: "LEE PAT" }]);
  assert.deepEqual(h.named("twilio.voice_received").map((e) => [e.subject, e.payload]), [[`entity/${CALL_SID}`, { dedupeKey: `voice:${CALL_SID}`, sid: CALL_SID }]]);

  const again = await receiveWebhook(h.ctx, input);
  assert.deepEqual(again, out);
  assert.equal(h.calls("telephony.ingest_voice").length, 1, "applied once");
  assert.equal(h.named("twilio.voice_received").length, 1);
  assert.equal(h.rows(`SELECT "dedupeKey" FROM twilio_hook_log WHERE "dedupeKey" = ?`, input.dedupeKey).length, 1);
});

test("replay: a delivery whose landing failed is not remembered, so Twilio's retry is applied", async () => {
  const h = harness();
  const input = hookInput(h.ctx, "sms", HOOKS.sms);
  h.failIngest(true);
  await refused(receiveWebhook(h.ctx, input), "internal.unavailable");
  assert.equal(h.rows(`SELECT "dedupeKey" FROM twilio_hook_log`).length, 0);
  assert.equal(h.emitted.length, 0);
  h.failIngest(false);
  assert.deepEqual(await receiveWebhook(h.ctx, input), { accepted: true, twiml: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>" });
  assert.equal(h.named("twilio.sms_received").length, 1);
});

test("replay: an incoming text is landed with its pictures and answered with an empty response", async () => {
  const h = harness();
  const out = await receiveWebhook(h.ctx, hookInput(h.ctx, "sms", HOOKS.sms));
  assert.equal(out.accepted, true);
  assert.equal(out.twiml, '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  assert.deepEqual(h.calls("telephony.ingest_sms").map((c) => c.input), [{
    messageSid: "SM00000000000000000000000000000020", from: "+14155550177", to: "+14155550123", body: "Can you call me?", at: NOW, mediaUrls: ["https://api.twilio.com/media/ME1"],
  }]);
  assert.equal(h.named("twilio.sms_received")[0]!.payload.sid, "SM00000000000000000000000000000020");
  // no pictures: the key is left out
  await receiveWebhook(h.ctx, hookInput(h.ctx, "sms", { ...HOOKS.sms, MessageSid: "SM00000000000000000000000000000022", NumMedia: "0" }));
  assert.equal("mediaUrls" in h.calls("telephony.ingest_sms")[1]!.input, false);
});

test("replay: a status callback lands as a call status or a text status, with its error code and duration", async () => {
  const h = harness();
  await receiveWebhook(h.ctx, hookInput(h.ctx, "status", HOOKS.statusCall));
  await receiveWebhook(h.ctx, hookInput(h.ctx, "status", HOOKS.statusSms));
  assert.deepEqual(h.calls("telephony.ingest_status").map((c) => c.input), [
    { sid: CALL_SID, kind: "call", status: "completed", at: NOW, durationSec: 42 },
    { sid: "SM00000000000000000000000000000021", kind: "sms", status: "undelivered", at: NOW, errorCode: "30003" },
  ]);
  assert.deepEqual(h.named("twilio.status_received").length, 2);
});

test("replay: a finished recording lands once; one still in progress is remembered but not landed", async () => {
  const h = harness();
  await receiveWebhook(h.ctx, hookInput(h.ctx, "recording", HOOKS.recording));
  assert.deepEqual(h.calls("telephony.ingest_recording").map((c) => c.input), [{ callSid: CALL_SID, recordingSid: REC_SID, url: HOOKS.recording.RecordingUrl, durationSec: 17 }]);
  const running = hookInput(h.ctx, "recording", { ...HOOKS.recording, RecordingStatus: "in-progress" });
  assert.equal(running.dedupeKey, `recording:${REC_SID}:in-progress`);
  assert.deepEqual(await receiveWebhook(h.ctx, running), { accepted: true });
  assert.equal(h.calls("telephony.ingest_recording").length, 1);
  assert.equal(h.named("twilio.recording_received").length, 2);
  await refused(receiveWebhook(h.ctx, hookInput(h.ctx, "recording", { ...HOOKS.recording, RecordingSid: "RE00000000000000000000000000000099", RecordingUrl: "" })), "validation.bad_input");
});

test("a call to something that is not a number is refused as bad input and nothing is landed", async () => {
  const h = harness();
  await refused(receiveWebhook(h.ctx, hookInput(h.ctx, "voice", { ...HOOKS.voice, To: "sip:desk@example.test" })), "validation.bad_input");
  await refused(receiveWebhook(h.ctx, { kind: "voice", dedupeKey: "", sid: "", params: {} }), "validation.bad_input");
  await refused(receiveWebhook(h.ctx, { kind: "fax" as "voice", dedupeKey: "k", sid: "s", params: {} }), "validation.bad_input");
  assert.equal(h.called.length, 0);
});

// ---- TwiML

test("the instruction becomes TwiML: ring people with an announcement and recording, take a message, or turn the caller away", () => {
  const o = { callerId: "+14155550123", recordingUrl: `${PUBLIC_URL}/hooks/twilio/recording` };
  const ring = voiceTwiml({
    action: "ring", targets: [{ kind: "person", id: "usr_a" }, { kind: "agent", id: "agt_b" }], ringSeconds: 400, record: true, announcement: "This call is recorded & logged.",
  }, o);
  assert.equal(ring, `<?xml version="1.0" encoding="UTF-8"?><Response><Say>This call is recorded &amp; logged.</Say><Dial timeout="120" callerId="+14155550123" record="record-from-answer-dual" recordingStatusCallback="${PUBLIC_URL}/hooks/twilio/recording" recordingStatusCallbackMethod="POST"><Client>usr_a</Client><Client>agt_b</Client></Dial></Response>`);
  assert.match(voiceTwiml({ action: "ring", targets: [{ kind: "person", id: "usr_a" }], ringSeconds: 1, record: false }, o), /timeout="5"/);
  const mail = voiceTwiml({ action: "voicemail", targets: [], greeting: "Leave a <message>.", record: true }, o);
  assert.match(mail, /<Say>Leave a &lt;message&gt;\.<\/Say><Record maxLength="120" playBeep="true" recordingStatusCallback="[^"]+hooks\/twilio\/recording"/);
  assert.match(mail, /<Hangup\/><\/Response>$/);
  assert.match(voiceTwiml({ action: "ring", targets: [], record: false }, o), /<Record /, "nobody to ring means a message");
  assert.equal(voiceTwiml({ action: "reject", targets: [], record: false }, o), '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
});

test("a call routed to voicemail by telephony is answered with the greeting and a recording", async () => {
  const h = harness({ instruction: { action: "voicemail", targets: [], greeting: "We are closed.", record: true } });
  const out = await receiveWebhook(h.ctx, hookInput(h.ctx, "voice", HOOKS.voice));
  assert.match(out.twiml ?? "", /<Say>We are closed\.<\/Say><Record /);
});

// ---- twilio.access_token

function decode(token: string): { header: Record<string, unknown>; claims: Record<string, unknown>; signed: string; sig: string } {
  const [a, b, c] = token.split(".") as [string, string, string];
  return { header: JSON.parse(Buffer.from(a, "base64url").toString()), claims: JSON.parse(Buffer.from(b, "base64url").toString()), signed: `${a}.${b}`, sig: c };
}

test("the Voice token is a JWT signed with the API key secret, naming the identity and the Space's TwiML app", async () => {
  const h = harness({ apiKey: true });
  h.on(`GET ${API}${REST}/Applications.json?FriendlyName=Vyre+spc_twilio`, { status: 200, body: RECORDED.app });
  h.on(`POST ${API}${REST}/Applications/${APP_SID}.json`, { status: 200, body: RECORDED.appCreated });
  const out = await accessToken(h.ctx, { identity: "usr_maya0001", ttlSec: 600 });
  assert.deepEqual(contractErrors("twilio.access_token", "out", out), []);
  assert.equal(out.expiresAt, NOW + 600_000);
  const t = decode(out.token);
  assert.deepEqual(t.header, { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" });
  assert.equal(t.claims.iss, API_KEY);
  assert.equal(t.claims.sub, ACCOUNT);
  assert.equal(t.claims.exp, NOW / 1000 + 600);
  assert.deepEqual(t.claims.grants, { identity: "usr_maya0001", voice: { incoming: { allow: true }, outgoing: { application_sid: APP_SID } } });
  assert.equal(t.sig, createHmac("sha256", AUTH).update(t.signed).digest("base64url"));
  assert.equal(h.rows(`SELECT "value" FROM twilio_state WHERE "key" = ?`, "twiml_app")[0]!.value, APP_SID, "the app is remembered");
  // the second token asks Twilio nothing
  const before = h.requests.length;
  await accessToken(h.ctx, { identity: "usr_maya0001" });
  assert.equal(h.requests.length, before);
  assert.equal(decode((await accessToken(h.ctx, { identity: "usr_maya0001" })).token).claims.exp, NOW / 1000 + 3600, "an hour by default");
});

test("the Voice token needs an API key, a valid identity and a sane lifetime", async () => {
  const h = harness();
  await refused(accessToken(h.ctx, { identity: "usr_maya0001" }), "provider.auth_failed");
  const k = harness({ apiKey: true });
  await refused(accessToken(k.ctx, { identity: "has space" }), "validation.bad_input");
  await refused(accessToken(k.ctx, { identity: "" }), "validation.bad_input");
  await refused(accessToken(k.ctx, { identity: "usr_a", ttlSec: 59 }), "validation.bad_input");
  await refused(accessToken(k.ctx, { identity: "usr_a", ttlSec: 86401 }), "validation.bad_input");
});

// ---- calls

test("a call is placed with the numbers, the Space's webhook addresses and the status events", async () => {
  const h = harness();
  h.on(`POST ${API}${REST}/Calls.json`, { status: 201, body: RECORDED.call });
  const input = { from: "+14155550123", to: "+14155550177", record: true };
  assert.deepEqual(contractErrors("twilio.call.create", "in", input), []);
  const out = await callCreate(h.ctx, input);
  assert.deepEqual(out, { sid: CALL_SID });
  assert.deepEqual(contractErrors("twilio.call.create", "out", out), []);
  const [req] = h.requests;
  assert.equal(req!.headers.authorization, BASIC_ACCOUNT);
  assert.deepEqual(req!.form, [
    ["From", "+14155550123"], ["To", "+14155550177"], ["Url", `${PUBLIC_URL}/hooks/twilio/voice`], ["Method", "POST"], ["StatusCallback", `${PUBLIC_URL}/hooks/twilio/status`],
    ["StatusCallbackMethod", "POST"], ["StatusCallbackEvent", "initiated"], ["StatusCallbackEvent", "ringing"], ["StatusCallbackEvent", "answered"], ["StatusCallbackEvent", "completed"],
    ["Record", "true"], ["RecordingStatusCallback", `${PUBLIC_URL}/hooks/twilio/recording`], ["RecordingStatusCallbackMethod", "POST"],
  ]);
  await callCreate(h.ctx, { from: "+14155550123", to: "+14155550177", url: "https://bridge.example.test/twiml", statusCallback: "https://bridge.example.test/status" });
  assert.deepEqual(h.requests[1]!.form!.slice(2, 5), [["Url", "https://bridge.example.test/twiml"], ["Method", "POST"], ["StatusCallback", "https://bridge.example.test/status"]]);
  await refused(callCreate(h.ctx, { from: "4155550123", to: "+14155550177" }), "validation.bad_input");
  await refused(callCreate(h.ctx, { from: "+14155550123", to: "+14155550177", url: "http://insecure.example.test" }), "validation.bad_input");
});

test("an API key is used as the user when the Space has one", async () => {
  const h = harness({ apiKey: true });
  h.on(`GET ${API}${REST}/Calls/${CALL_SID}.json`, { status: 200, body: RECORDED.callDone });
  await callGet(h.ctx, { sid: CALL_SID });
  assert.equal(h.requests[0]!.headers.authorization, `Basic ${Buffer.from(`${API_KEY}:${AUTH}`).toString("base64")}`);
});

test("a call is read with its status, length and numbers", async () => {
  const h = harness();
  h.on(`GET ${API}${REST}/Calls/${CALL_SID}.json`, { status: 200, body: RECORDED.callDone }, { status: 200, body: RECORDED.call });
  const done = await callGet(h.ctx, { sid: CALL_SID });
  assert.deepEqual(done, { status: "completed", durationSec: 42, from: "+14155550123", to: "+14155550177" });
  assert.deepEqual(contractErrors("twilio.call.get", "out", done), []);
  assert.deepEqual(await callGet(h.ctx, { sid: CALL_SID }), { status: "queued", from: "+14155550123", to: "+14155550177" });
  await refused(callGet(h.ctx, { sid: "not-a-sid" }), "validation.bad_input");
});

test("a live call can be hung up, held, resumed or redirected", async () => {
  const h = harness();
  h.on(`POST ${API}${REST}/Calls/${CALL_SID}.json`, { status: 200, body: { sid: CALL_SID, status: "completed" } });
  assert.deepEqual(await callUpdate(h.ctx, { sid: CALL_SID, action: "hangup" }), { status: "completed" });
  assert.deepEqual(h.requests[0]!.form, [["Status", "completed"]]);
  await callUpdate(h.ctx, { sid: CALL_SID, action: "hold" });
  assert.equal(h.requests[1]!.form![0]![0], "Twiml");
  assert.match(h.requests[1]!.form![0]![1], /<Play loop="0">/);
  await callUpdate(h.ctx, { sid: CALL_SID, action: "redirect", targetUrl: "https://space.example.test/hooks/twilio/voice?to=usr_b" });
  assert.deepEqual(h.requests[2]!.form, [["Url", "https://space.example.test/hooks/twilio/voice?to=usr_b"], ["Method", "POST"]]);
  await refused(callUpdate(h.ctx, { sid: CALL_SID, action: "redirect" }), "validation.bad_input");
  await refused(callUpdate(h.ctx, { sid: CALL_SID, action: "resume" }), "validation.bad_input");
  await refused(callUpdate(h.ctx, { sid: CALL_SID, action: "mute" as "hold" }), "validation.bad_input");
});

// ---- recordings

test("recording starts only on a call that has been told, stops, downloads into a blob with its length, and deletes", async () => {
  const h = harness();
  await refused(recordingStart(h.ctx, { callSid: CALL_SID, announced: false }), "validation.precondition_failed");
  assert.equal(h.requests.length, 0, "nothing is sent to Twilio when the call was not told");
  h.on(`POST ${API}${REST}/Calls/${CALL_SID}/Recordings.json`, { status: 201, body: RECORDED.recording });
  const started = await recordingStart(h.ctx, { callSid: CALL_SID, announced: true });
  assert.deepEqual(started, { recordingSid: REC_SID });
  assert.deepEqual(h.requests[0]!.form, [["RecordingStatusCallback", `${PUBLIC_URL}/hooks/twilio/recording`], ["RecordingStatusCallbackMethod", "POST"], ["RecordingChannels", "dual"]]);

  h.on(`POST ${API}${REST}/Calls/${CALL_SID}/Recordings/${REC_SID}.json`, { status: 200, body: { ...RECORDED.recording, status: "stopped" } });
  assert.deepEqual(await recordingStop(h.ctx, { callSid: CALL_SID, recordingSid: REC_SID }), { stopped: true });
  assert.deepEqual(h.requests[1]!.form, [["Status", "stopped"]]);

  h.on(`GET ${API}${REST}/Recordings/${REC_SID}.json`, { status: 200, body: RECORDED.recording });
  const got = await recordingDownload(h.ctx, { recordingSid: REC_SID });
  assert.deepEqual(got, { blobId: "blb_1", size: 2001, durationSec: 17 });
  assert.deepEqual(contractErrors("twilio.recording.download", "out", got), []);
  assert.deepEqual(h.downloads, [{ url: `https://api.twilio.com${REST}/Recordings/${REC_SID}.mp3`, mime: "audio/mpeg" }]);

  h.on(`DELETE ${API}${REST}/Recordings/${REC_SID}.json`, { status: 204 });
  assert.deepEqual(await recordingDelete(h.ctx, { recordingSid: REC_SID }), { deleted: true });
  h.on(`GET ${API}${REST}/Recordings/${REC_SID}.json`, { status: 404, body: { code: 20404, status: 404 } });
  await refused(recordingDownload(h.ctx, { recordingSid: REC_SID }), "validation.not_found");
});

// ---- texts

test("a text is sent with its pictures and the status address, and Twilio's refusal is bad_response", async () => {
  const h = harness();
  h.on(`POST ${API}${REST}/Messages.json`, { status: 201, body: RECORDED.message });
  const out = await smsSend(h.ctx, { from: "+14155550123", to: "+14155550177", body: "Hello Pat", mediaUrls: ["https://files.example.test/a.png"] });
  assert.deepEqual(out, { sid: "SM00000000000000000000000000000012", status: "queued" });
  assert.deepEqual(contractErrors("twilio.sms.send", "out", out), []);
  assert.deepEqual(h.requests[0]!.form, [["From", "+14155550123"], ["To", "+14155550177"], ["StatusCallback", `${PUBLIC_URL}/hooks/twilio/status`], ["Body", "Hello Pat"], ["MediaUrl", "https://files.example.test/a.png"]]);
  await refused(smsSend(h.ctx, { from: "+14155550123", to: "+14155550177", body: "" }), "validation.bad_input");
  await refused(smsSend(h.ctx, { from: "+14155550123", to: "+14155550177", body: "x".repeat(1601) }), "validation.bad_input");
  await refused(smsSend(h.ctx, { from: "+14155550123", to: "+14155550177", body: "x", mediaUrls: ["http://x.test/a.png"] }), "validation.bad_input");
  h.on(`POST ${API}${REST}/Messages.json`, { status: 400, body: { code: 21610, message: "recipient unsubscribed with Pat's number", status: 400 } });
  await assert.rejects(smsSend(h.ctx, { from: "+14155550123", to: "+14155550177", body: "x" }), (e: unknown) => {
    assert.equal(codeOf(e), "provider.bad_response");
    assert.doesNotMatch(JSON.stringify(e), /Pat's number/, "Twilio's own message is not passed on");
    assert.equal((e as { error: { details: { twilioCode: number } } }).error.details.twilioCode, 21610);
    return true;
  });
});

test("Twilio's refusals map to the error catalogue: auth, rate limit, outage, unreachable", async () => {
  const h = harness();
  const path = `POST ${API}${REST}/Messages.json`;
  const send = () => smsSend(h.ctx, { from: "+14155550123", to: "+14155550177", body: "x" });
  for (const [status, code] of [[401, "provider.auth_failed"], [403, "provider.auth_failed"], [429, "provider.rate_limited"], [503, "provider.unavailable"], [418, "provider.bad_response"]] as const) {
    h.on(path, { status, body: { code: 1, status } });
    await refused(send(), code);
  }
  h.on(path, { status: 200, body: "<html>" });
  await refused(send(), "provider.bad_response");
  h.on(path, { status: 200, body: {} });
  await refused(send(), "provider.bad_response");
  h.on(path, { status: 0, throws: true });
  await refused(send(), "provider.network");
  setTwilioHost(null);
  await refused(send(), "internal.unavailable");
});

// ---- the registered handlers

test("every capability of the twilio manifest has a handler, and none is extra", () => {
  const caps = registry.capabilities.filter((c) => c.name.startsWith("twilio.")).map((c) => c.name).sort();
  assert.equal(caps.length, 21);
  assert.deepEqual(Object.keys(handlers).sort(), caps);
});

test("receive_webhook through the registered handler lands a delivery like the function does", async () => {
  const h = harness();
  const out = (await handlers["twilio.receive_webhook"]!(h.ctx as never, hookInput(h.ctx, "sms", HOOKS.sms) as never)) as { accepted: boolean };
  assert.equal(out.accepted, true);
  assert.equal(h.calls("telephony.ingest_sms").length, 1);
});
