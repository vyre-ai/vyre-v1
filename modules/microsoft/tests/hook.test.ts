// /hooks/microsoft intake: a Graph notice is recorded only when its subscription is ours and its clientState matches; the validation handshake hands back its token; one forged notice
// fails the whole request; a redelivery is taken once; the capability that records a notice refuses a direct call from a person or an agent.
import test from "node:test";
import assert from "node:assert/strict";
import { acceptHook } from "../handlers/index.ts";
import { handlers, hostCalls } from "../impl.ts";
import { ensure } from "../projections.ts";
import { codeOf, CONN, harness, NOW, seedConsent } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const MAYA = "maya@vyre.test";
const url = "https://space.vyre.test/hooks/microsoft";
const STATE = "state-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function ready(excluded = false): Harness {
  const h = harness({ admin: true });
  ensure(h.ctx);
  seedConsent(h, { members: [{ email: MAYA, userId: "usr_maya01", excluded }] });
  h.ctx.db.run(`INSERT INTO microsoft_subscription (id, kind, resource, mailbox, "connectionId", "notificationUrl", "clientState", "expiresAt", "maxMinutes", "changeType") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    "sub1", "mail", `users/${MAYA}/mailFolders('inbox')/messages`, MAYA, CONN, url, STATE, NOW + 3_600_000, 4230, "created");
  return h;
}
const notice = (o: Record<string, unknown> = {}) => ({
  subscriptionId: "sub1", clientState: STATE, changeType: "created", resource: `users/${MAYA}/messages/AAA`, resourceData: { id: "AAA", "@odata.etag": "W/1" }, tenantId: "tenant-guid", ...o,
});
const post = (n: unknown[]) => ({ headers: {}, body: JSON.stringify({ value: n }), url });

test("a notice for our subscription with its clientState is recorded once", async () => {
  const h = ready();
  assert.deepEqual(await acceptHook(h.ctx, post([notice()])), { accepted: true });
  assert.equal(h.named("microsoft.notification_received").length, 1);
  assert.deepEqual(await acceptHook(h.ctx, post([notice()])), { accepted: false });   // Graph redelivers: taken once
  assert.equal(h.named("microsoft.notification_received").length, 1);
});

test("a notice with a wrong or missing clientState, or for a subscription we never made, records nothing", async () => {
  const h = ready();
  for (const n of [notice({ clientState: "wrong" }), notice({ clientState: undefined }), notice({ subscriptionId: "subX" }), notice({ subscriptionId: undefined }), notice({ clientState: STATE + "x" })]) {
    await assert.rejects(() => acceptHook(h.ctx, post([n])), (e) => codeOf(e) === "auth.bad_credentials", JSON.stringify(n));
  }
  assert.equal(h.named("microsoft.notification_received").length, 0);
  assert.equal(h.rows(`SELECT * FROM microsoft_notification_seen`).length, 0);
});

test("one forged notice in a batch fails the whole request before any real one is recorded", async () => {
  const h = ready();
  await assert.rejects(() => acceptHook(h.ctx, post([notice(), notice({ clientState: "forged", resourceData: { id: "BBB" } })])), (e) => codeOf(e) === "auth.bad_credentials");
  assert.equal(h.named("microsoft.notification_received").length, 0);
});

test("the validation handshake hands back its token as text, and refuses a token that is not printable text", async () => {
  const h = ready();
  assert.deepEqual(await acceptHook(h.ctx, { headers: {}, body: "", url: `${url}?validationToken=Validation%3A+abc123` }), { accepted: true, validationToken: "Validation: abc123" });
  await assert.rejects(() => acceptHook(h.ctx, { headers: {}, body: "", url: `${url}?validationToken=%3Cscript%3E%00` }), (e) => codeOf(e) === "validation.bad_input");
});

test("a body that is not a Graph notification is a bad request, and an excluded member's mail is not pulled", async () => {
  const h = ready();
  for (const body of ["not json", "{}", JSON.stringify({ value: [] })]) await assert.rejects(() => acceptHook(h.ctx, { headers: {}, body, url }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(() => acceptHook(h.ctx, post([notice({ changeType: "weird" })])), (e) => codeOf(e) === "validation.bad_input");
  const x = ready(true);
  assert.deepEqual(await acceptHook(x.ctx, post([notice()])), { accepted: true });
  assert.equal(x.ingests.length, 0);
  assert.equal(x.scheduled.length, 0);
});

test("only the server can record a notice: a person, an API key or an agent calling it directly is refused, a queued poll and another module are not", async () => {
  const input = { notificationId: "n1", subscriptionId: "poll", resource: `users/${MAYA}/messages`, changeType: "updated", clientStateOk: true };
  for (const origin of ["api", "user", "portal", "engine", "mcp"]) {
    const h = ready();
    await assert.rejects(() => handlers["ms.receive_notification"]!({ ...h.ctx, origin, depth: 0 }, input), (e) => codeOf(e) === "permission.no_grant", origin);
  }
  const h = ready();
  await handlers["ms.receive_notification"]!({ ...h.ctx, origin: "schedule", depth: 0 }, input);
  await handlers["ms.receive_notification"]!({ ...h.ctx, origin: "api", depth: 1 }, { ...input, notificationId: "n2" });
  assert.equal(h.named("microsoft.notification_received").length, 2);
  await assert.rejects(() => hostCalls["microsoft.accept_webhook"]({ ...h.ctx, origin: "api", depth: 0 }, { headers: {}, body: "", url }), (e) => codeOf(e) === "permission.no_grant");
});
