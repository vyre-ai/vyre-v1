// mail.delivery.trail and mail.delivery.retry (lane r42-email-in): the trail of a sent message, duplicate and out-of-order events, soft-bounce retries
// that never double-send, and a hard bounce that blocks the address. All addresses end in .test; nothing leaves the process.
import test from "node:test";
import assert from "node:assert/strict";
import { statusUpdate } from "../handlers/extra/status.ts";
import { BACKOFF_MS, CLAIM_STALE_MS, MAX_RETRIES, bindRetrySend, retry as retryNow, trail } from "../handlers/extra/delivery.ts";
import { hostError, script, seedSent, eventErrors } from "../handlers/extra/kit.ts";
import { codeOf, contractErrors, harness, NOW, seedMailbox } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

interface Scheduled {
  at: number;
  cap: string;
  input: Record<string, unknown>;
  system?: boolean;
}

function setup(opts: { scheduler?: boolean } = {}): { h: Harness; scheduled: Scheduled[]; sent: Record<string, unknown>[] } {
  const h = harness({ principal: { kind: "service", id: "svc_host" } });
  seedMailbox(h, "mbx_maya", "maya@vyre.test", { kind: "personal", provider: "google", ownerId: "usr_maya01", privacy: "space" });
  const scheduled: Scheduled[] = [];
  const sent: Record<string, unknown>[] = [];
  if (opts.scheduler !== false) {
    (h.ctx as unknown as { schedule: (at: number, cap: string, input: unknown, opts?: { system?: boolean }) => Promise<string> }).schedule = async (
      at,
      cap,
      input,
      opts,
    ) => {
      scheduled.push({ at, cap, input: input as Record<string, unknown>, ...(opts?.system ? { system: true } : {}) });
      return `sch_${scheduled.length}`;
    };
  }
  let n = 0;
  bindRetrySend((c, i) => c.call("mail.send", i) as never); // the retry's send is the scripted one below
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

/** The scheduler's call, a day later than the plan: every attempt is due by then. */
const retry = async (h: Harness, input: Parameters<typeof retryNow>[1]) => {
  h.advance(86_400_000);
  return retryNow(h.ctx, input);
};
const planned = (s: Scheduled[]): number => new Set(s.map((x) => x.input.attempt)).size;
const planOf = (s: Scheduled[], n: number): Scheduled => s.find((x) => x.input.attempt === n)!;
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
  assert.equal(scheduled[0]!.system, true); // run by the host as the system, never as whoever's call scheduled it
  assert.equal(scheduled[0]!.at, NOW + BACKOFF_MS[0]);
  // a call before the wait is over changes nothing; Vyre's scheduler is the only caller
  assert.deepEqual(await retryNow(h.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 }), { outcome: "skipped" });
  assert.equal(sent.length, 0);
  // a second soft-bounce event while one retry waits does not add another
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "soft", address: "pat@acme.test", reason: "Mailbox full" }));
  assert.equal(scheduled.length, 1);

  const again = { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 };
  const first = await retry(h, again);
  assert.deepEqual(contractErrors("mail.delivery.retry", "out", first), []);
  assert.deepEqual(first, { outcome: "sent", messageId: "eml_retry1" });
  assert.deepEqual(await retry(h, again), { outcome: "skipped" }); // the scheduler delivered the call twice
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
  const r = await retry(h, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 });
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
    assert.equal(planned(scheduled), attempt);
    assert.equal(planOf(scheduled, attempt).at, h.ctx.now() + BACKOFF_MS[attempt - 1]!);
    const r = await retry(h, { messageId: "eml_m1", address: "pat@acme.test", attempt });
    assert.equal(r.outcome, "sent");
    provider = `re_c${attempt}`;
    seedSent(h, { id: String(r.messageId), mailboxId: "mbx_maya", providerId: provider });
  }
  await statusUpdate(h.ctx, event(provider, "bounced", { kind: "soft", reason: "Mailbox full" }));
  assert.equal(planned(scheduled), MAX_RETRIES); // no fourth retry
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
  assert.deepEqual(await retry(a.h, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 }), { outcome: "skipped" });
  assert.equal(a.sent.length, 0);

  const b = setup();
  seedSent(b.h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  await statusUpdate(b.h.ctx, event("re_1", "bounced", { kind: "soft" }));
  script(b.h, { "contacts.suppression.check": () => ({ suppressed: [{ address: "pat@acme.test", reason: "unsubscribed" }] }) });
  assert.deepEqual(await retry(b.h, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 }), { outcome: "gave_up" });
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
  assert.deepEqual(await retry(h, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 }), { outcome: "rescheduled" });
  assert.deepEqual(planOf(scheduled, 2).input, { messageId: "eml_m1", address: "pat@acme.test", attempt: 2 });
  assert.deepEqual(await retry(h, { messageId: "eml_m1", address: "pat@acme.test", attempt: 2 }), { outcome: "rescheduled" });
  assert.deepEqual(await retry(h, { messageId: "eml_m1", address: "pat@acme.test", attempt: 3 }), { outcome: "gave_up" });
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
  await assert.rejects(retry(h, { messageId: "eml_m1", address: "", attempt: 1 }), (e) => codeOf(e) === "validation.bad_input");
  await assert.rejects(retry(h, { messageId: "eml_m1", address: "a@b.test", attempt: 9 }), (e) => codeOf(e) === "validation.bad_input");
});

test("a retry run by someone who may not send from that mailbox gives the attempt back, so it is not burned", async () => {
  const { h, sent } = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "soft" }));
  let deny = true;
  script(h, {
    "mail.send": (i) => {
      if (deny) throw hostError(h, "permission.no_grant");
      sent.push(i);
      return { messageId: "eml_retry9", status: "sent", suppressed: [] };
    },
  });
  await assert.rejects(retry(h, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 }), (e) => codeOf(e) === "permission.no_grant");
  assert.equal(status(h, "eml_m1"), "sent");
  assert.equal(h.rows(`SELECT attempts, state FROM mail_delivery_retry`)[0]!.state, "pending");
  assert.equal(h.rows(`SELECT attempts FROM mail_delivery_retry`)[0]!.attempts, 0);
  deny = false; // the scheduler's own run, a moment later, as someone who may
  assert.equal((await retry(h, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 })).outcome, "sent");
  assert.equal(sent.length, 1);
});

test("a hard bounce or a complaint on a retry reaches the message the person sent, once, and closes the retry", async () => {
  for (const [ev, expect, emitted] of [["bounced", "bounced", "message.bounced"], ["complained", "complained", "message.complained"]] as const) {
    const { h } = setup();
    seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
    await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "soft" }));
    const r = await retry(h, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 });
    seedSent(h, { id: String(r.messageId), mailboxId: "mbx_maya", providerId: "re_2" });
    await statusUpdate(h.ctx, event("re_2", ev, ev === "bounced" ? { kind: "hard", reason: "No such user" } : {}));
    assert.equal(status(h, "eml_m1"), expect);
    assert.equal(h.named(emitted).filter((e) => e.payload.messageId === "eml_m1").length, 1);
    const out = await trail(h.ctx, { messageId: "eml_m1" });
    assert.equal(out.state, expect);
    assert.equal(out.retry, undefined);
    assert.equal(h.rows(`SELECT state FROM mail_delivery_retry`)[0]!.state, "gave_up");
  }
});

test("a retry resends the same message: its attachments and its place in the thread; one it cannot rebuild ends as bounced", async () => {
  const { h, sent } = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  h.ctx.db.run(`UPDATE mail_message SET attachments = ? WHERE id = ?`, JSON.stringify([{ attachmentId: "att_1", name: "plan.pdf", mime: "application/pdf", size: 10, fileId: "fil_plan0001" }]), "eml_m1");
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "soft", reason: "Mailbox full" }));
  await retry(h, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 });
  assert.deepEqual(sent[0]!.attachments, ["fil_plan0001"]);
  assert.equal(sent[0]!.subject, "Hello");

  const blob = setup();
  seedSent(blob.h, { id: "eml_m2", mailboxId: "mbx_maya", providerId: "re_9" });
  blob.h.ctx.db.run(`UPDATE mail_message SET attachments = ? WHERE id = ?`, JSON.stringify([{ attachmentId: "att_1", name: "plan.pdf", mime: "application/pdf", size: 10, blobId: "blb_x" }]), "eml_m2");
  await statusUpdate(blob.h.ctx, event("re_9", "bounced", { kind: "soft" }));
  assert.deepEqual(await retry(blob.h, { messageId: "eml_m2", address: "pat@acme.test", attempt: 1 }), { outcome: "gave_up" });
  assert.equal(blob.sent.length, 0);
  assert.equal(status(blob.h, "eml_m2"), "bounced");
});

test("a retry that died after its claim is taken up again once, keyed so the provider is never asked twice", async () => {
  const { h, sent } = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "soft" }));
  // the process died after the claim: the row says sending, with the claim time
  h.ctx.db.run(`UPDATE mail_delivery_retry SET state = ?, attempts = ?, "nextAt" = ? WHERE "messageId" = ?`, "sending", 1, h.ctx.now(), "eml_m1");
  assert.equal((await trail(h.ctx, { messageId: "eml_m1" })).state, "retrying"); // never a silent stuck row
  assert.deepEqual(await retryNow(h.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 }), { outcome: "skipped" }); // too soon
  h.advance(CLAIM_STALE_MS + 1);
  assert.equal((await retryNow(h.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 })).outcome, "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.idempotencyKey, "retry:eml_m1:pat@acme.test:1");
  assert.deepEqual(await retryNow(h.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 }), { outcome: "skipped" });
});

test("two calls for the same attempt at once: only one sends", async () => {
  const { h, sent } = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "soft" }));
  h.advance(86_400_000);
  const both = await Promise.all([1, 2].map(() => retryNow(h.ctx, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 })));
  assert.deepEqual(both.map((b) => b.outcome).sort(), ["sent", "skipped"]);
  assert.equal(sent.length, 1);
});

test("a failure of a retry never flips an original that is already delivered; it stays on the trail", async () => {
  const { h } = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1", to: ["pat@acme.test", "kim@acme.test"] });
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "soft", address: "pat@acme.test", reason: "Mailbox full" }));
  await statusUpdate(h.ctx, event("re_1", "delivered", { address: "kim@acme.test" })); // the other recipient got it
  const r = await retry(h, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 });
  seedSent(h, { id: String(r.messageId), mailboxId: "mbx_maya", providerId: "re_2" });
  await statusUpdate(h.ctx, event("re_2", "bounced", { kind: "hard", reason: "No such user" }));
  assert.equal(status(h, "eml_m1"), "delivered");
  assert.equal(h.named("message.bounced").filter((e) => e.payload.messageId === "eml_m1").length, 0);
  assert.ok((await trail(h.ctx, { messageId: "eml_m1" })).events.some((e) => e.kind === "bounced"));
  assert.equal(h.rows(`SELECT state FROM mail_delivery_retry`)[0]!.state, "gave_up");
});

test("a viewer without the contacts permission still reads the trail", async () => {
  const { h } = setup();
  script(h, { "contacts.suppression.check": () => { throw new Error("permission.no_grant"); } });
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "hard", reason: "No such user" }));
  const out = await trail(h.ctx, { messageId: "eml_m1" });
  assert.equal(out.state, "bounced");
  assert.deepEqual(out.blocked, []);
});

test("only the host service runs a retry: a person, an agent, an actor or another service is refused and nothing is sent", async () => {
  const { h, sent } = setup();
  seedSent(h, { id: "eml_m1", mailboxId: "mbx_maya", providerId: "re_1" });
  await statusUpdate(h.ctx, event("re_1", "bounced", { kind: "soft" }));
  h.advance(86_400_000);
  for (const p of [{ kind: "person", id: "usr_x" }, { kind: "agent", id: "agt_x" }, { kind: "actor", id: "act_x" }, { kind: "service", id: "svc_flow" }] as const) {
    const other = { ...h.ctx, principal: p };
    await assert.rejects(retryNow(other, { messageId: "eml_m1", address: "pat@acme.test", attempt: 1 }), (e) => codeOf(e) === "permission.no_grant");
  }
  assert.equal(sent.length, 0);
  assert.equal(h.rows(`SELECT state FROM mail_delivery_retry`)[0]!.state, "pending");
});
