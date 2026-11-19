// mail.delivery.trail and mail.delivery.retry (lane r42-email-in): the trail of a sent message, duplicate and out-of-order events, soft-bounce retries
// that never double-send, and a hard bounce that blocks the address. All addresses end in .test; nothing leaves the process.
import test from "node:test";
import assert from "node:assert/strict";
import { statusUpdate } from "../handlers/extra/status.ts";
import { BACKOFF_MS, MAX_RETRIES, retry, trail } from "../handlers/extra/delivery.ts";
import { script, seedSent, eventErrors } from "../handlers/extra/kit.ts";
import { codeOf, contractErrors, harness, NOW, seedMailbox } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

interface Scheduled {
  at: number;
  cap: string;
  input: Record<string, unknown>;
}

function setup(opts: { scheduler?: boolean } = {}): { h: Harness; scheduled: Scheduled[]; sent: Record<string, unknown>[] } {
  const h = harness();
  seedMailbox(h, "mbx_maya", "maya@vyre.test", { kind: "personal", provider: "google", ownerId: "usr_maya01", privacy: "space" });
  const scheduled: Scheduled[] = [];
  const sent: Record<string, unknown>[] = [];
  if (opts.scheduler !== false) {
    (h.ctx as unknown as { schedule: (at: number, cap: string, input: unknown) => Promise<string> }).schedule = async (
      at,
      cap,
      input,
    ) => {
      scheduled.push({ at, cap, input: input as Record<string, unknown> });
      return `sch_${scheduled.length}`;
    };
  }
  let n = 0;
  script(h, {
    "contacts.suppression.add": (i) => ({ added: 1, rows: [{ ...i }] }),
    "contacts.suppression.check": () => ({ suppressed: [] }),
    "mail.send": (i) => {
      sent.push(i);
      n += 1;
      return { messageId: `eml_retry${n}`, status: "sent", suppressed: [] };
    },
  });
  return { h, scheduled, sent };
}

let at = NOW;
type Update = Parameters<typeof statusUpdate>[1];
const event = (providerId: string, status: Update["status"], extra: Partial<Update> = {}): Update => ({
  providerId,
  status,
  at: ++at,
  ...extra,
});
const status = (h: Harness, id: string): string => String(h.rows(`SELECT status FROM mail_message WHERE id = ?`, id)[0]!.status);

test("every event lands on the trail in the order the provider gives, and a replayed webhook lands once", async () => {
  const { h } = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  // delivered (t+20) is reported before opened (t+30) but arrives after it: the trail still reads in time order
  const opened = event("re_1", "opened", { at: NOW + 30 });
  const delivered = event("re_1", "delivered", { at: NOW + 20 });
  await statusUpdate(h.ctx, opened);
  await statusUpdate(h.ctx, delivered);
  await statusUpdate(h.ctx, delivered);
  await statusUpdate(h.ctx, opened);
  const out = await trail(h.ctx, { messageId: "eml_m1" });
  assert.deepEqual(contractErrors("mail.delivery.trail", "out", out), []);
  assert.deepEqual(
    out.events.map((e) => e.kind),
    ["sent", "delivered", "opened"],
  );
  assert.equal(out.state, "delivered");
  assert.deepEqual(out.blocked, []);
});

test("a late delivered after a bounce never moves the message back, and stays on the trail", async () => {
  const { h } = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "hard", reason: "No such user", at: NOW + 50 }));
  await statusUpdate(h.ctx, event("re_1", "delivered", { at: NOW + 10 }));
  assert.equal(status(h, "eml_m1"), "bounced");
  const out = await trail(h.ctx, { messageId: "eml_m1" });
  assert.deepEqual(
    out.events.map((e) => e.kind),
    ["sent", "delivered", "bounced"],
  );
});

test("a hard bounce stops the address and the trail names it in plain words", async () => {
  const { h } = setup();
  script(h, { "contacts.suppression.check": (i) => ({ suppressed: (i.addresses as string[]).map((address) => ({ address, reason: "bounce_hard" })) }) });
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1", to: ["pat@acme.test", "kim@acme.test"] });
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "hard", address: "pat@acme.test", reason: "No such user" }));
  const out = await trail(h.ctx, { messageId: "eml_m1" });
  assert.equal(out.state, "bounced");
  assert.deepEqual(out.blocked, [{ address: "pat@acme.test", reason: "Their mail server says this address does not exist." }]);
  const bounce = out.events.find((e) => e.kind === "bounced");
  assert.deepEqual([bounce?.address, bounce?.detail, bounce?.label], ["pat@acme.test", "No such user", "Bounced"]);
});

test("a soft bounce waits and retries once to that address only, never twice for the same attempt", async () => {
  const { h, scheduled, sent } = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1", to: ["pat@acme.test", "kim@acme.test"] });
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "soft", address: "pat@acme.test", reason: "Mailbox full" }));
  assert.equal(status(h, "eml_m1"), "sent"); // not a bounce yet
  assert.equal(h.named("message.bounced").length, 0);
  assert.equal(scheduled.length, 1);
  assert.deepEqual(scheduled[0]!.input, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 });
  assert.equal(scheduled[0]!.at, NOW + BACKOFF_MS[0]);
  // a second soft-bounce event while one retry waits does not add another
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "soft", address: "pat@acme.test", reason: "Mailbox full" }));
  assert.equal(scheduled.length, 1);

  const again = { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 };
  const first = await retry(h.ctx, again);
  assert.deepEqual(contractErrors("mail.delivery.retry", "out", first), []);
  assert.deepEqual(first, { outcome: "sent", messageId: "eml_retry1" });
  assert.deepEqual(await retry(h.ctx, again), { outcome: "skipped" }); // the scheduler delivered the call twice
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]!.to, [{ address: "pat@acme.test" }]); // kim is not mailed again
  assert.equal(sent[0]!.idempotencyKey, "retry:eml_m1:pat@acme.test:1");
  const out = await trail(h.ctx, { messageId: "eml_m1" });
  assert.deepEqual(out.events.map((e) => e.kind).sort(), ["retried", "retry_scheduled", "sent", "soft_bounced", "soft_bounced"]);
  assert.deepEqual(out.retry, undefined); // the retry went out; the next soft bounce, if any, plans the next one
});

test("a retry that delivers makes the message delivered when it went to one person", async () => {
  const { h } = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "soft", reason: "Mailbox full" }));
  const r = await retry(h.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 });
  seedSent(h, { id: String(r.messageId), mailboxId: "mbx_maya", providerId: "re_2" });
  await statusUpdate(h.ctx, event("re_2", "delivered"));
  assert.equal(status(h, "eml_m1"), "delivered");
  assert.equal(h.named("message.delivered").filter((e) => e.payload.messageId === "eml_m1").length, 1);
  assert.equal((await trail(h.ctx, { messageId: "eml_m1" })).state, "delivered");
});

test("three soft bounces in a row use the tries up: the message is bounced once, with the reason", async () => {
  const { h, scheduled } = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  let provider = "re_1";
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await statusUpdate(h.ctx, event(provider, "bounced", { kind: "soft", reason: "Mailbox full" }));
    assert.equal(scheduled.length, attempt);
    assert.equal(scheduled[attempt - 1]!.at, h.ctx.now() + BACKOFF_MS[attempt - 1]!);
    const r = await retry(h.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt });
    assert.equal(r.outcome, "sent");
    provider = `re_c${attempt}`;
    seedSent(h, { id: String(r.messageId), mailboxId: "mbx_maya", providerId: provider });
  }
  await statusUpdate(h.ctx, event(provider, "bounced", { kind: "soft", reason: "Mailbox full" }));
  assert.equal(scheduled.length, MAX_RETRIES); // no fourth retry
  assert.equal(status(h, "eml_m1"), "bounced");
  assert.equal(h.named("message.bounced").filter((e) => e.payload.messageId === "eml_m1").length, 1);
  const out = await trail(h.ctx, { messageId: "eml_m1" });
  assert.equal(out.state, "bounced");
  assert.match(out.events.find((e) => e.kind === "gave_up")?.detail ?? "", /Tried 3 times\. Mailbox full/);
  assert.deepEqual(eventErrors(h), []);
});

test("a retry is skipped when the message was delivered meanwhile, and stops at an address suppressed while it waited", async () => {
  const a = setup();
  seedSent(a.h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  await statusUpdate(a.h.ctx, event("re_1", "bounced", { kind: "soft" }));
  await statusUpdate(a.h.ctx, event("re_1", "delivered")); // the provider's own retry got through
  assert.deepEqual(await retry(a.h.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 }), { outcome: "skipped" });
  assert.equal(a.sent.length, 0);

  const b = setup();
  seedSent(b.h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  await statusUpdate(b.h.ctx, event("re_1", "bounced", { kind: "soft" }));
  script(b.h, { "contacts.suppression.check": () => ({ suppressed: [{ address: "pat@acme.test", reason: "unsubscribed" }] }) });
  assert.deepEqual(await retry(b.h.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 }), { outcome: "gave_up" });
  assert.equal(b.sent.length, 0);
});

test("when the retry send fails the next try is scheduled, and the last failure bounces the message", async () => {
  const { h, scheduled } = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  script(h, {
    "mail.send": () => {
      throw new Error("provider is down");
    },
  });
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "soft", reason: "Mailbox full" }));
  assert.deepEqual(await retry(h.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 }), { outcome: "rescheduled" });
  assert.deepEqual(scheduled[1]!.input, { messageId: "eml_m1", address: "pat@acme.test", attempt: 2 });
  assert.deepEqual(await retry(h.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 2 }), { outcome: "rescheduled" });
  assert.deepEqual(await retry(h.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 3 }), { outcome: "gave_up" });
  assert.equal(status(h, "eml_m1"), "bounced");
  assert.equal(h.named("message.bounced").length, 1);
});

test("with no scheduler a soft bounce is a bounce at once, as before; nothing promises a retry that cannot run", async () => {
  const { h, scheduled } = setup({ scheduler: false });
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "soft", reason: "Mailbox full" }));
  assert.equal(status(h, "eml_m1"), "bounced");
  assert.equal(scheduled.length, 0);
});

test("trail refuses a bad id and a message the caller may not see answers as missing; retry refuses bad input", async () => {
  const { h } = setup();
  await assert.rejects(trail(h.ctx, { messageId: "nope" }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(trail(h.ctx, { messageId: "eml_none" }), (e) => codeOf(e) === "validation.not_found");
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  h.denied.add("mbx_maya");
  await assert.rejects(trail(h.ctx, { messageId: "eml_m1" }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(retry(h.ctx, { messageId: "eml_m1", address: "", attempt: 1 }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(retry(h.ctx, { messageId: "eml_m1", address: "a@b.test", attempt: 9 }), (e) => codeOf(e) === "validation.bad_input");
});
