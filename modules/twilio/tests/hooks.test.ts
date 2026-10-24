import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fakeTwilio, TWILIO_ACCOUNT_SID } from "../../../testkit/providers/twilio.ts";
import { handlers } from "../impl.ts";
import { handleHook, saveAccount, twilioSignature } from "../handlers/hooks.ts";
import type { HookKind, TwilioAccount } from "../handlers/hooks.ts";
import { testBag } from "../fixtures/harness.ts";

const dir = path.dirname(fileURLToPath(import.meta.url));
const replay = JSON.parse(fs.readFileSync(path.join(dir, "../fixtures/replay-voice.json"), "utf8")) as {
  authToken: string;
  url: string;
  signature: string;
  params: Record<string, string>;
};

const account = (over: Partial<TwilioAccount> = {}): TwilioAccount => ({
  accountSid: TWILIO_ACCOUNT_SID,
  authToken: replay.authToken,
  apiKeySid: "SKaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  apiKeySecret: "api-secret",
  twimlAppSid: "APaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  voiceUrl: "https://example.test/hooks/twilio/voice",
  ...over,
});

test("pinned voice webhook signature matches HMAC-SHA1 of the URL and sorted fields", async () => {
  const got = await twilioSignature(replay.url, replay.params, replay.authToken);
  assert.equal(got, replay.signature);
});

test("connector replay accepts a signed voice hook once and refuses a bad signature", async () => {
  const bag = testBag();
  saveAccount(bag.ctx, account());
  const first = await handleHook(bag.ctx, { kind: "voice", url: replay.url, params: replay.params, signature: replay.signature });
  const again = await handleHook(bag.ctx, { kind: "voice", url: replay.url, params: replay.params, signature: replay.signature });
  assert.equal(first.status, 200);
  assert.equal(first.accepted, true);
  assert.equal(again.accepted, false);
  assert.equal(bag.events.length, 1);
  assert.equal(bag.events[0]?.name, "twilio.voice_received");
  assert.deepEqual(bag.events[0]?.payload, { dedupeKey: "CA1234567890ABCDE:ringing", sid: "CA1234567890ABCDE" });

  const bad = testBag();
  saveAccount(bad.ctx, account());
  const refused = await handleHook(bad.ctx, { kind: "voice", url: replay.url, params: replay.params, signature: "not-the-signature" });
  assert.equal(refused.status, 403);
  assert.equal(refused.accepted, false);
  assert.equal(bad.events.length, 0);
  const tampered = { ...replay.params, CallStatus: "completed" };
  const tamper = await handleHook(bad.ctx, { kind: "voice", url: replay.url, params: tampered, signature: replay.signature });
  assert.equal(tamper.status, 403);
  assert.equal(bad.events.length, 0);
});

test("sms, status and recording hooks each emit once for a valid signature", async () => {
  const cases: { kind: HookKind; params: Record<string, string>; event: string; dedupeKey: string }[] = [
    { kind: "sms", params: { MessageSid: "SM111", SmsStatus: "received", From: "+14158675309", To: "+14155550100", Body: "hi" }, event: "twilio.sms_received", dedupeKey: "SM111:received" },
    { kind: "status", params: { CallSid: "CA222", CallStatus: "completed" }, event: "twilio.status_received", dedupeKey: "CA222:completed" },
    { kind: "recording", params: { RecordingSid: "RE333", RecordingStatus: "completed", CallSid: "CA222" }, event: "twilio.recording_received", dedupeKey: "RE333:completed" },
  ];
  for (const c of cases) {
    const bag = testBag();
    saveAccount(bag.ctx, account());
    const url = `https://example.test/hooks/twilio/${c.kind}`;
    const signature = await twilioSignature(url, c.params, replay.authToken);
    const res = await handleHook(bag.ctx, { kind: c.kind, url, params: c.params, signature });
    assert.equal(res.status, 200, c.kind);
    assert.equal(res.accepted, true, c.kind);
    if (c.kind === "sms") assert.match(res.body, /<Response>/);
    assert.equal(bag.events[0]?.name, c.event);
    assert.deepEqual(bag.events[0]?.payload, { dedupeKey: c.dedupeKey, sid: c.dedupeKey.split(":")[0] });
  }
});

test("connector replay sends sms and reads health against the fake Twilio account", async () => {
  const tw = fakeTwilio();
  const bag = testBag();
  saveAccount(bag.ctx, account({ authToken: "test-token" }));
  bag.ctx.http = (url, init) => tw.fetch(url, init);
  const health = await handlers["twilio.health"](bag.ctx, {});
  assert.equal(health.state, "healthy");
  assert.equal(health.detail, "active");
  const sent = await handlers["twilio.sms.send"](bag.ctx, {
    from: "+14155550100", to: "+14155550999", body: "hello", idempotencyKey: "sms-1",
  });
  assert.equal(sent.status, "queued");
  assert.match(sent.sid, /^SM/);
  const replayed = await handlers["twilio.sms.send"](bag.ctx, {
    from: "+14155550100", to: "+14155550999", body: "hello", idempotencyKey: "sms-1",
  });
  assert.deepEqual(replayed, sent);
  assert.equal(tw.calls.filter((c) => c.url.includes("/Messages.json")).length, 1);
});

test("access token is a Voice JS JWT for this Space TwiML app", async () => {
  const bag = testBag(1_767_625_200_000);
  const appSid = "APaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  saveAccount(bag.ctx, account({ twimlAppSid: appSid }));
  const out = await handlers["twilio.access_token"](bag.ctx, { identity: "usr_owner", ttlSec: 120 });
  assert.equal(out.expiresAt, 1_767_625_200_000 + 120_000);
  const [h, p, sig] = out.token.split(".");
  assert.ok(h && p && sig);
  const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { alg: string; cty: string };
  const payload = JSON.parse(Buffer.from(p, "base64url").toString()) as { iss: string; sub: string; grants: { identity: string; voice: { outgoing: { application_sid: string } } } };
  assert.equal(header.alg, "HS256");
  assert.equal(header.cty, "twilio-fpa;v=1");
  assert.equal(payload.grants.identity, "usr_owner");
  assert.equal(payload.grants.voice.outgoing.application_sid, appSid);
  assert.equal(payload.sub, TWILIO_ACCOUNT_SID);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("api-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const mac = Buffer.from(sig, "base64url");
  const ok = await crypto.subtle.verify("HMAC", key, mac, new TextEncoder().encode(`${h}.${p}`));
  assert.equal(ok, true);
});
