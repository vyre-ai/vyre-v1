// P-L5_LIVE2: what /hooks/zoom must pass before anything is recorded (spec 2.18): a good signature is accepted, a bad one and a stale or missing one are refused, and Zoom's URL check is answered.
import test from "node:test";
import assert from "node:assert/strict";
import { encryptedTokenOf, signatureOf, verifyWebhook, WEBHOOK_TOLERANCE_MS } from "../impl.ts";

const SECRET = "whsec_zoom_test";
const NOW = 1_790_000_000_000;
const body = JSON.stringify({ event: "meeting.ended", event_ts: 1_789_999_999_000, payload: { object: { id: 8123456789, uuid: "abc==" } } });
const signed = async (stamp: number, b = body) => ({ "x-zm-request-timestamp": String(stamp), "x-zm-signature": await signatureOf(SECRET, String(stamp), b) });

test("a good signature inside the window is accepted and becomes the capability's input", async () => {
  const v = await verifyWebhook(SECRET, await signed(NOW / 1000), body, NOW);
  assert.equal(v.ok, true);
  assert.deepEqual(v.ok && v.input, { eventId: "meeting.ended:abc==:1789999999000", type: "meeting.ended", at: 1_789_999_999_000, meetingId: "8123456789", uuid: "abc==" });
});

test("a bad signature, a body changed after signing, or a wrong secret is refused", async () => {
  const good = await signed(NOW / 1000);
  assert.deepEqual(await verifyWebhook(SECRET, { ...good, "x-zm-signature": "v0=" + "0".repeat(64) }, body, NOW), { ok: false, reason: "bad_signature" });
  assert.deepEqual(await verifyWebhook(SECRET, good, body + " ", NOW), { ok: false, reason: "bad_signature" });
  assert.deepEqual(await verifyWebhook("another secret", good, body, NOW), { ok: false, reason: "bad_signature" });
});

test("a stale or future timestamp is refused before the signature is looked at, and a missing header is refused", async () => {
  const old = (NOW - WEBHOOK_TOLERANCE_MS - 1000) / 1000;
  assert.deepEqual(await verifyWebhook(SECRET, await signed(old), body, NOW), { ok: false, reason: "stale" }, "a correctly signed request six minutes old");
  assert.deepEqual(await verifyWebhook(SECRET, await signed((NOW + WEBHOOK_TOLERANCE_MS + 1000) / 1000), body, NOW), { ok: false, reason: "stale" });
  assert.equal((await verifyWebhook(SECRET, await signed((NOW - WEBHOOK_TOLERANCE_MS + 1000) / 1000), body, NOW)).ok, true, "just inside the window");
  assert.deepEqual(await verifyWebhook(SECRET, { "x-zm-request-timestamp": String(NOW / 1000) }, body, NOW), { ok: false, reason: "no_signature" });
  assert.deepEqual(await verifyWebhook(SECRET, { "x-zm-request-timestamp": "soon", "x-zm-signature": "v0=00" }, body, NOW), { ok: false, reason: "stale" });
});

test("the endpoint.url_validation challenge is signed like any request and carries the plain token to be answered", async () => {
  const challenge = JSON.stringify({ event: "endpoint.url_validation", payload: { plainToken: "qgg8vlvZRS6UYooatFL8Aw" } });
  const v = await verifyWebhook(SECRET, await signed(NOW / 1000, challenge), challenge, NOW);
  assert.equal(v.ok && v.input.type, "endpoint.url_validation");
  assert.equal(v.ok && v.input.plainToken, "qgg8vlvZRS6UYooatFL8Aw");
  assert.match(await encryptedTokenOf(SECRET, "qgg8vlvZRS6UYooatFL8Aw"), /^[0-9a-f]{64}$/, "the answer is the HMAC of the token under the secret, hex");
  assert.deepEqual(await verifyWebhook(SECRET, await signed(NOW / 1000, "not json"), "not json", NOW), { ok: false, reason: "bad_body" });
});
