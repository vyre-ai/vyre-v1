// mail.health and mail.status_update (P-L5_01c). Health ages the last good sync per mailbox. Status updates walk a message up the
// ladder (queued, sent, delivered, bounced, complained) once, write the suppression list for hard bounces and complaints, and never repeat.
import test from "node:test";
import assert from "node:assert/strict";
import { DOWN_MS, HEALTHY_MS, health, statusUpdate } from "../handlers/extra/status.ts";
import { eventErrors, hostError, script, seedSent } from "../handlers/extra/kit.ts";
import { ingest } from "../handlers/ingest.ts";
import { codeOf, contractErrors, harness, letter, NOW, seedMailbox } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const MIN = 60_000;

function setup(): Harness {
  const h = harness();
  seedMailbox(h, "mbx_maya", "maya@vyre.test", { kind: "personal", provider: "google", ownerId: "usr_maya01", privacy: "space" });
  return h;
}

function syncedAgo(h: Harness, id: string, ms: number | null, state = "syncing"): void {
  h.ctx.db.run(`UPDATE mail_mailbox SET "lastSyncAt" = ?, state = ? WHERE id = ?`, ms === null ? null : NOW - ms, state, id);
}

// ---- mail.health

test("health: no pulling mailboxes is healthy and carries no detail", async () => {
  const h = harness();
  const out = await health(h.ctx, {});
  assert.deepEqual(contractErrors("mail.health", "out", out), []);
  assert.deepEqual(out, { state: "healthy", latencyMs: 0 });
});

test("health: healthy within the window, degraded after it, down after the long limit", async () => {
  const h = setup();
  syncedAgo(h, "mbx_maya", 5 * MIN);
  assert.equal((await health(h.ctx, {})).state, "healthy");
  assert.equal((await health(h.ctx, {})).detail, undefined);
  syncedAgo(h, "mbx_maya", HEALTHY_MS + MIN);
  const slow = await health(h.ctx, {});
  assert.deepEqual(contractErrors("mail.health", "out", slow), []);
  assert.equal(slow.state, "degraded");
  assert.match(slow.detail ?? "", /^maya@vyre\.test last synced 31 minutes ago\. Open the mailbox/);
  syncedAgo(h, "mbx_maya", DOWN_MS + MIN);
  const stale = await health(h.ctx, {});
  assert.equal(stale.state, "down");
  assert.match(stale.detail ?? "", /last synced 3 hours ago/);
  syncedAgo(h, "mbx_maya", 3 * 24 * 60 * MIN);
  assert.match((await health(h.ctx, {})).detail ?? "", /last synced 3 days ago/);
});

test("health: the worst mailbox wins and is the one named", async () => {
  const h = setup();
  seedMailbox(h, "mbx_pat", "pat@vyre.test", { kind: "personal", provider: "microsoft", ownerId: "usr_pat01" });
  seedMailbox(h, "mbx_sam", "sam@vyre.test", { kind: "personal", provider: "imap", ownerId: "usr_sam01" });
  syncedAgo(h, "mbx_maya", 5 * MIN);
  syncedAgo(h, "mbx_pat", 2 * 60 * MIN);
  syncedAgo(h, "mbx_sam", 9 * 60 * MIN);
  const out = await health(h.ctx, {});
  assert.equal(out.state, "down");
  assert.match(out.detail ?? "", /^sam@vyre\.test /);
  const one = await health(h.ctx, { mailboxId: "mbx_pat" });
  assert.deepEqual([one.state, /^pat@vyre\.test /.test(one.detail ?? "")], ["degraded", true]);
  assert.equal((await health(h.ctx, { mailboxId: "mbx_maya" })).state, "healthy");
});

test("health: a failed last sync is at least degraded; paused, inbound-only and removed mailboxes are left out", async () => {
  const h = setup();
  syncedAgo(h, "mbx_maya", MIN, "error");
  const failed = await health(h.ctx, {});
  assert.deepEqual([failed.state, failed.detail?.includes("its last sync failed")], ["degraded", true]);
  syncedAgo(h, "mbx_maya", 10 * 60 * MIN, "paused");
  seedMailbox(h, "mbx_in", "hello@vyre.test", { kind: "shared", provider: "inbound_only" });
  syncedAgo(h, "mbx_in", 10 * 60 * MIN, "syncing");
  seedMailbox(h, "mbx_gone", "gone@vyre.test", { kind: "personal", provider: "google", ownerId: "usr_x01" });
  h.ctx.db.run(`UPDATE mail_mailbox SET deleted_at = ?, state = ? WHERE id = ?`, NOW, "disconnected", "mbx_gone");
  assert.equal((await health(h.ctx, {})).state, "healthy");
});

test("health: a mailbox that never synced counts from when it was connected", async () => {
  const h = setup();
  syncedAgo(h, "mbx_maya", null, "pending");
  assert.equal((await health(h.ctx, {})).state, "healthy");   // connected a moment ago
  h.advance(2 * 60 * MIN);
  const out = await health(h.ctx, {});
  assert.equal(out.state, "degraded");
  assert.match(out.detail ?? "", /has not synced since it was connected 2 hours ago/);
});

test("health refuses a bad or unknown mailbox id", async () => {
  const h = setup();
  await assert.rejects(health(h.ctx, { mailboxId: "box" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(health(h.ctx, { mailboxId: "mbx_nope" }), (e) => codeOf(e) === "validation.not_found");
});

// ---- mail.status_update

function withSuppression(h: Harness): void {
  script(h, { "contacts.suppression.add": (i) => ({ added: 1, rows: [{ ...i }] }) });
}
const status = (h: Harness, id: string): string => String(h.rows(`SELECT status FROM mail_message WHERE id = ?`, id)[0]!.status);
let at = NOW;
const event = (providerId: string, s: Parameters<typeof statusUpdate>[1]["status"], extra: Partial<Parameters<typeof statusUpdate>[1]> = {}): Parameters<typeof statusUpdate>[1] =>
  ({ providerId, status: s, at: ++at, ...extra });

test("delivered moves a sent message up the ladder once and announces it", async () => {
  const h = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  const input = event("re_1", "delivered");
  const out = await statusUpdate(h.ctx, input);
  assert.deepEqual(contractErrors("mail.status_update", "out", out), []);
  assert.deepEqual(out, { messageId: "eml_m1", suppressed: false });
  assert.equal(status(h, "eml_m1"), "delivered");
  assert.deepEqual(h.named("message.delivered").map((e) => [e.subject, e.payload]), [["mail_message/eml_m1", { messageId: "eml_m1", channel: "email" }]]);
  assert.deepEqual(await statusUpdate(h.ctx, input), out);   // the provider retries the webhook
  assert.equal(h.named("message.delivered").length, 1);
  assert.equal(h.rows(`SELECT version FROM mail_message WHERE id = ?`, "eml_m1")[0]!.version, 2);
  assert.deepEqual(eventErrors(h), []);
});

test("a hard bounce suppresses the address, marks the message and says why", async () => {
  const h = setup();
  withSuppression(h);
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1", to: ["pat@acme.test", "kim@acme.test"] });
  const input = event("re_1", "bounced", { kind: "hard", address: "Pat@Acme.test", reason: "Mailbox does not exist" });
  const out = await statusUpdate(h.ctx, input);
  assert.deepEqual(out, { messageId: "eml_m1", suppressed: true });
  assert.equal(status(h, "eml_m1"), "bounced");
  assert.deepEqual(h.calls("contacts.suppression.add").map((c) => c.input), [
    { channel: "email", addresses: ["pat@acme.test"], reason: "bounce_hard", source: "mail.bounce", note: "Mailbox does not exist" },
  ]);
  assert.deepEqual(h.named("message.bounced").map((e) => e.payload), [{ messageId: "eml_m1", channel: "email", address: "pat@acme.test", kind: "hard", reason: "Mailbox does not exist" }]);
  assert.deepEqual(await statusUpdate(h.ctx, input), out);   // replay: same answer, nothing again
  assert.equal(h.calls("contacts.suppression.add").length, 1);
  assert.equal(h.named("message.bounced").length, 1);
  assert.deepEqual(eventErrors(h), []);
});

test("a soft bounce marks the message but leaves the address deliverable", async () => {
  const h = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  seedSent(h, { id: "eml_m2", mailboxId: "mbx_maya", providerId: "re_2" });
  const soft = await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "soft", reason: "Mailbox full" }));
  const unknownKind = await statusUpdate(h.ctx, event("re_2", "bounced"));   // no kind: do not suppress on a guess
  assert.deepEqual([soft.suppressed, unknownKind.suppressed], [false, false]);
  assert.deepEqual([status(h, "eml_m1"), status(h, "eml_m2")], ["bounced", "bounced"]);
  assert.equal(h.calls("contacts.suppression.add").length, 0);
  assert.deepEqual(h.named("message.bounced").map((e) => [e.payload.kind, e.payload.address]), [["soft", "pat@acme.test"], ["soft", "pat@acme.test"]]);
  assert.deepEqual(eventErrors(h), []);
});

test("without an address the only recipient is meant; with several recipients nobody is suppressed on a guess", async () => {
  const h = setup();
  withSuppression(h);
  seedSent(h, { id: "eml_one", mailboxId: "mbx_maya", providerId: "re_1", to: [], bcc: ["Hidden@Acme.test"] });
  seedSent(h, { id: "eml_many", mailboxId: "mbx_maya", providerId: "re_2", to: ["a@acme.test"], cc: ["b@acme.test"] });
  assert.equal((await statusUpdate(h.ctx, event("re_1", "complained"))).suppressed, true);
  assert.deepEqual(h.calls("contacts.suppression.add").map((c) => c.input.addresses), [["hidden@acme.test"]]);
  assert.equal((await statusUpdate(h.ctx, event("re_2", "complained"))).suppressed, false);
  assert.equal(h.calls("contacts.suppression.add").length, 1);
  assert.equal(h.named("message.complained").length, 2);
  assert.equal(h.named("message.complained")[1]!.payload.address, "a@acme.test");
  assert.deepEqual(eventErrors(h), []);
});

test("a complaint suppresses, and upgrades a bounced message; nothing moves a message back down", async () => {
  const h = setup();
  withSuppression(h);
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "soft" }));
  await statusUpdate(h.ctx, event("re_1", "delivered"));              // late: ignored
  assert.equal(status(h, "eml_m1"), "bounced");
  assert.equal(h.named("message.delivered").length, 0);
  const out = await statusUpdate(h.ctx, event("re_1", "complained", { address: "pat@acme.test" }));
  assert.equal(out.suppressed, true);
  assert.equal(status(h, "eml_m1"), "complained");
  assert.deepEqual(h.calls("contacts.suppression.add").map((c) => [c.input.reason, c.input.source]), [["complaint", "mail.complaint"]]);
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "hard", address: "pat@acme.test" }));   // after a complaint: stays
  assert.equal(status(h, "eml_m1"), "complained");
  assert.equal(h.named("message.bounced").length, 1);
  assert.deepEqual(eventErrors(h), []);
});

test("failed records the reason, or a plain one when the provider gave none", async () => {
  const h = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1", status: "queued" });
  seedSent(h, { id: "eml_m2", mailboxId: "mbx_maya", providerId: "re_2", status: "queued" });
  await statusUpdate(h.ctx, event("re_1", "failed", { reason: "Quota exceeded" }));
  await statusUpdate(h.ctx, event("re_2", "failed"));
  assert.deepEqual([status(h, "eml_m1"), status(h, "eml_m2")], ["failed", "failed"]);
  assert.deepEqual(h.named("message.failed").map((e) => e.payload.reason), ["Quota exceeded", "The provider could not send the message."]);
  assert.deepEqual(eventErrors(h), []);
});

test("opened and clicked announce each distinct event once and leave the status alone", async () => {
  const h = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1", status: "delivered" });
  const open = event("re_1", "opened");
  await statusUpdate(h.ctx, open);
  await statusUpdate(h.ctx, open);
  await statusUpdate(h.ctx, event("re_1", "opened"));                          // opened again later
  const click = event("re_1", "clicked", { url: "https://acme.test/offer" });
  await statusUpdate(h.ctx, click);
  await statusUpdate(h.ctx, click);
  await statusUpdate(h.ctx, event("re_1", "clicked"));                         // a click with no url
  assert.equal(status(h, "eml_m1"), "delivered");
  assert.equal(h.named("message.opened").length, 2);
  assert.deepEqual(h.named("message.clicked").map((e) => e.payload), [{ messageId: "eml_m1", url: "https://acme.test/offer" }, { messageId: "eml_m1" }]);
  assert.deepEqual(eventErrors(h), []);
});

test("an event for a send we have no record of still suppresses a hard bounce, and changes nothing else", async () => {
  const h = setup();
  withSuppression(h);
  const out = await statusUpdate(h.ctx, event("re_unknown", "bounced", { kind: "hard", address: "gone@acme.test" }));
  assert.deepEqual(contractErrors("mail.status_update", "out", out), []);
  assert.deepEqual(out, { suppressed: true });
  assert.equal(h.emitted.length, 0);
  assert.deepEqual(await statusUpdate(h.ctx, event("re_unknown", "delivered")), { suppressed: false });
  assert.deepEqual(await statusUpdate(h.ctx, event("re_unknown", "complained")), { suppressed: false });   // no address, no message: nobody to name
  assert.equal(h.calls("contacts.suppression.add").length, 1);
  assert.equal(h.rows(`SELECT "eventKey" FROM mail_status_log`).length, 0);
});

test("an event that arrives before the send is saved applies when the provider retries after it", async () => {
  const h = setup();
  const input = event("re_late", "delivered");
  assert.deepEqual(await statusUpdate(h.ctx, input), { suppressed: false });
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_late", status: "queued" });
  assert.deepEqual(await statusUpdate(h.ctx, input), { messageId: "eml_m1", suppressed: false });
  assert.equal(status(h, "eml_m1"), "delivered");
});

test("a suppression failure leaves the message untouched so the retry applies the whole event", async () => {
  const h = setup();
  let down = true;
  script(h, { "contacts.suppression.add": () => { if (down) throw hostError(h, "internal.unavailable"); return { added: 1, rows: [] }; } });
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  const input = event("re_1", "bounced", { kind: "hard", address: "pat@acme.test" });
  await assert.rejects(statusUpdate(h.ctx, input), (e) => codeOf(e) === "internal.unavailable");
  assert.equal(status(h, "eml_m1"), "sent");
  assert.equal(h.emitted.length, 0);
  down = false;
  assert.deepEqual(await statusUpdate(h.ctx, input), { messageId: "eml_m1", suppressed: true });
  assert.equal(status(h, "eml_m1"), "bounced");
  assert.equal(h.named("message.bounced").length, 1);
});

test("only mail we sent is matched: an inbound message with the same provider id is not touched", async () => {
  const h = setup();
  const received = await ingest(h.ctx, letter("pat@acme.test", "<in1@x>", "same-id", { mailboxId: "mbx_maya" }));
  const out = await statusUpdate(h.ctx, event("same-id", "delivered"));
  assert.deepEqual(out, { suppressed: false });
  assert.equal(status(h, received.messageId), "received");
});

test("status_update refuses a missing provider id, an unknown status, a bad kind and a bad time", async () => {
  const h = setup();
  await assert.rejects(statusUpdate(h.ctx, event(" ", "delivered")), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(statusUpdate(h.ctx, event("re_1", "queued" as never)), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(statusUpdate(h.ctx, event("re_1", "bounced", { kind: "medium" as never })), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(statusUpdate(h.ctx, { providerId: "re_1", status: "delivered", at: -1 }), (e) => codeOf(e) === "validation.bad_input");
});
