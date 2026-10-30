// /hooks/google intake: the push secret decides everything. A notice without it, with a wrong one, or before any watch exists records nothing; Gmail and Meet arrive as Pub/Sub
// envelopes, Calendar and Drive as channel headers; a redelivery is taken once; the capability that records a push refuses a direct call from a person or an agent.
import test from "node:test";
import assert from "node:assert/strict";
import { acceptHook } from "../handlers/index.ts";
import { hostCalls, handlers } from "../impl.ts";
import { ensure, pushToken } from "../projections.ts";
import { codeOf, harness, seedDelegation } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const MAYA = "maya@vyre.test";
const base = "https://space.vyre.test/hooks/google";
const envelope = (messageId: string, data: unknown) => JSON.stringify({ message: { messageId, data: Buffer.from(JSON.stringify(data)).toString("base64") }, subscription: "projects/p/subscriptions/s" });

function ready(): Harness {
  const h = harness({ admin: true });
  ensure(h.ctx);
  seedDelegation(h);
  return h;
}

test("a Gmail Pub/Sub push with the secret in its address is recorded once", async () => {
  const h = ready();
  const token = pushToken(h.ctx);
  const hook = { headers: {}, body: envelope("m-1", { emailAddress: MAYA, historyId: 1500 }), url: `${base}/gmail?token=${token}`, kind: "gmail" };
  assert.deepEqual(await acceptHook(h.ctx, hook), { accepted: true });
  assert.deepEqual(h.named("google.push_received").map((e) => e.payload), [{ connector: "google", kind: "gmail", messageId: "m-1", mailbox: MAYA, historyId: "1500" }]);
  assert.deepEqual(await acceptHook(h.ctx, hook), { accepted: false });   // Pub/Sub redelivers: taken once
  assert.equal(h.named("google.push_received").length, 1);
});

test("a push without the secret, with a wrong one, or before any watch made one records nothing", async () => {
  const h = ready();
  const body = envelope("m-2", { emailAddress: MAYA, historyId: 1 });
  // no secret has been made yet (nothing was ever watched): even an empty or guessed token is refused
  await assert.rejects(() => acceptHook(h.ctx, { headers: {}, body, url: `${base}/gmail?token=guess`, kind: "gmail" }), (e) => codeOf(e) === "auth.bad_credentials");
  const token = pushToken(h.ctx);
  for (const url of [`${base}/gmail`, `${base}/gmail?token=`, `${base}/gmail?token=${token}x`, `${base}/gmail?token=${token.slice(1)}`]) {
    await assert.rejects(() => acceptHook(h.ctx, { headers: {}, body, url, kind: "gmail" }), (e) => codeOf(e) === "auth.bad_credentials", url);
  }
  await assert.rejects(() => acceptHook(h.ctx, { headers: { "x-goog-channel-token": "nope", "x-goog-channel-id": "c", "x-goog-message-number": "1" }, body: "", url: `${base}/calendar`, kind: "calendar" }), (e) => codeOf(e) === "auth.bad_credentials");
  assert.equal(h.named("google.push_received").length, 0);
  assert.equal(h.rows(`SELECT * FROM google_push_seen`).length, 0);
});

test("Calendar and Drive channel notices are checked by the channel token header and taken once per message number", async () => {
  const h = ready();
  const headers = { "x-goog-channel-token": pushToken(h.ctx), "x-goog-channel-id": "ch1", "x-goog-message-number": "7", "x-goog-resource-state": "exists", "x-goog-resource-id": "res1" };
  assert.deepEqual(await acceptHook(h.ctx, { headers, body: "", url: `${base}/calendar`, kind: "calendar" }), { accepted: true });
  assert.deepEqual(h.named("google.push_received").map((e) => e.payload), [{ connector: "google", kind: "calendar", messageId: "ch1:7", channelId: "ch1", resourceState: "exists", resourceId: "res1" }]);
  assert.deepEqual(await acceptHook(h.ctx, { headers, body: "", url: `${base}/calendar`, kind: "calendar" }), { accepted: false });
  assert.deepEqual(await acceptHook(h.ctx, { headers: { ...headers, "x-goog-message-number": "8" }, body: "", url: `${base}/drive`, kind: "drive" }), { accepted: true });
  await assert.rejects(() => acceptHook(h.ctx, { headers: { "x-goog-channel-token": headers["x-goog-channel-token"] }, body: "", url: `${base}/drive`, kind: "drive" }), (e) => codeOf(e) === "validation.bad_input");
});

test("a verified push that is not an event is a bad request, and an unknown kind is refused", async () => {
  const h = ready();
  const token = pushToken(h.ctx);
  await assert.rejects(() => acceptHook(h.ctx, { headers: {}, body: "not json", url: `${base}/gmail?token=${token}`, kind: "gmail" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => acceptHook(h.ctx, { headers: {}, body: envelope("m-3", {}), url: `${base}/gmail?token=${token}`, kind: "gmail" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => acceptHook(h.ctx, { headers: {}, body: "{}", url: `${base}/other?token=${token}`, kind: "other" }), (e) => codeOf(e) === "validation.bad_input");
});

test("a verified Gmail push for an excluded member pulls nothing", async () => {
  const h = harness({ admin: true });
  seedDelegation(h, { members: [{ email: MAYA, userId: "usr_maya01", excluded: true }] });
  const token = pushToken(h.ctx);
  assert.deepEqual(await acceptHook(h.ctx, { headers: {}, body: envelope("m-4", { emailAddress: MAYA, historyId: 9 }), url: `${base}/gmail?token=${token}`, kind: "gmail" }), { accepted: true });
  assert.equal(h.ingests.length, 0);
  assert.equal(h.scheduled.length, 0);
});

test("only the server can record a push: a person, an API key or an agent calling it directly is refused, a queued poll and another module are not", async () => {
  const input = { kind: "gmail", messageId: "x", mailbox: MAYA };
  for (const origin of ["api", "user", "portal", "engine", "mcp"]) {
    const h = ready();
    await assert.rejects(() => handlers["google.receive_push"]!({ ...h.ctx, origin, depth: 0 }, input), (e) => codeOf(e) === "permission.no_grant", origin);
  }
  const h = ready();
  await handlers["google.receive_push"]!({ ...h.ctx, origin: "schedule", depth: 0 }, input);
  await handlers["google.receive_push"]!({ ...h.ctx, origin: "api", depth: 1 }, { ...input, messageId: "y" });
  assert.equal(h.named("google.push_received").length, 2);
  await assert.rejects(() => hostCalls["google.accept_webhook"]({ ...h.ctx, origin: "api", depth: 0 }, { headers: {}, body: "", url: base }), (e) => codeOf(e) === "permission.no_grant");
});
