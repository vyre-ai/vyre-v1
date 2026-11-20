// Watching inboxes (lane r42-email-in): machine-made mail is recognised and never answered automatically, failures on the way in are kept and shown with
// the one thing to do, and mail.inbox.monitor says per inbox how it is fed and whether it works. Addresses end in .test; nothing leaves the process.
import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  AUTO_PER_HOUR,
  MAX_HELD,
  HELD_KEEP_MS,
  MAX_PROBLEMS,
  autoReason,
  ingestWatched,
  monitor,
  noteAuto,
  openHeld,
  syncWatched,
} from "../handlers/extra/inbound.ts";
import { isOwnRetry } from "../handlers/extra/delivery.ts";
import { sendAs } from "../handlers/send.ts";
import { trail } from "../handlers/extra/delivery.ts";
import { ingest } from "../handlers/ingest.ts";
import { send } from "../handlers/send.ts";
import { codeOf, contractErrors, letter, NOW } from "../fixtures/harness.ts";
import { rig, sendIn } from "./send.rig.test.ts";

const MIN = 60_000;

test("machine-made mail is recognised by its headers and sender, and mail from a person is not", () => {
  assert.equal(autoReason({ "auto-submitted": "auto-replied" }, "pat@acme.test"), "an automatic reply");
  assert.equal(autoReason({ "auto-submitted": "no" }, "pat@acme.test"), null);
  // Exchange and Outlook put this on ordinary mail from people: alone it says nothing
  assert.equal(autoReason({ "x-auto-response-suppress": "All" }, "pat@acme.test"), null);
  assert.equal(autoReason({ "x-autoreply": "yes" }, "pat@acme.test"), "an automatic reply");
  // a person's reply sent through a list address carries list headers, and answers something
  assert.equal(autoReason({ "list-id": "<news.acme.test>", "in-reply-to": "<x@acme.test>" }, "pat@acme.test"), null);
  assert.equal(autoReason({ precedence: "Bulk" }, "pat@acme.test"), "bulk mail");
  assert.equal(autoReason({ "list-id": "<news.acme.test>" }, "pat@acme.test"), "a mailing list");
  assert.equal(
    autoReason({ "content-type": "multipart/report; report-type=delivery-status" }, "mailer-daemon@acme.test"),
    "a delivery report",
  );
  assert.equal(autoReason({}, "no-reply@acme.test"), "a sender that does not read replies");
  assert.equal(autoReason({}, "noreply+x@acme.test"), "a sender that does not read replies");
  assert.equal(autoReason({}, "pat@acme.test"), null);
  assert.equal(autoReason(undefined, "reply@acme.test"), null);
});

test("an auto-reply is stored and announced as auto; an Automation's reply to it is held with the reason, and a person sends it with one press", async () => {
  const r = rig({ origin: "automation" });
  const auto = await ingest(
    r.ctx,
    letter("pat@acme.test", "<a1@acme.test>", "gm_a1", {
      mailboxId: "mbx_maya",
      headers: { "Auto-Submitted": "auto-replied" },
    }),
  );
  const human = await ingest(r.ctx, letter("kim@acme.test", "<h1@acme.test>", "gm_h1", { mailboxId: "mbx_maya" }));
  assert.deepEqual(
    r.h.named("mail.received").map((e) => e.payload.auto),
    [true, undefined],
  );
  const reply = (to: string, id: string, extra: object = {}) =>
    sendIn({
      mailboxId: "mbx_maya",
      to: [{ address: to }],
      subject: "Re: Hello",
      text: "Thanks",
      replyToMessageId: id,
      ...extra,
    });
  const held = await send(r.ctx, reply("pat@acme.test", auto.messageId));
  assert.equal(held.status, "held");
  assert.match(
    held.note ?? "",
    /Held, not sent\. That message is an automatic reply; an automatic reply to it could start a loop/,
  );
  assert.equal(r.sent().length, 0);
  const row = r.h.rows(`SELECT status FROM mail_message WHERE id = ?`, held.messageId ?? "")[0]!;
  assert.equal(row.status, "draft"); // kept, never dropped
  assert.ok(
    (await trail(r.ctx, { messageId: held.messageId ?? "" })).events.some(
      (e) => e.kind === "held" && /loop/.test(e.detail ?? ""),
    ),
  );
  // a person opens the draft and sends it: one press
  const person = r.ctx as unknown as { principal: { kind: string; id: string }; origin?: string };
  person.principal = { kind: "person", id: "usr_maya01" };
  person.origin = "user";
  const sent = await send(r.ctx, reply("pat@acme.test", auto.messageId, { draftId: held.messageId }));
  assert.equal(sent.status, "sent");
  // an ordinary reply from an Automation goes
  person.principal = { kind: "service", id: "svc_flow" };
  person.origin = "automation";
  assert.equal((await send(r.ctx, reply("kim@acme.test", human.messageId))).status, "sent");
});

test("a client's out-of-office never holds up the paperwork: a signature request from an Automation still goes", async () => {
  const r = rig({ origin: "automation" });
  await ingest(
    r.ctx,
    letter("sam@client.test", "<ooo@client.test>", "gm_ooo", {
      mailboxId: "mbx_maya",
      headers: { "Auto-Submitted": "auto-replied", Precedence: "bulk" },
    }),
  );
  const fresh = sendIn({
    mailboxId: "mbx_maya",
    to: [{ address: "sam@client.test" }],
    subject: "Please sign",
    text: "Link",
  }); // answers nothing
  assert.equal((await send(r.ctx, fresh)).status, "sent");
  assert.equal(r.sent().length, 1);
  // a no-reply sender is the same: a fresh message is not stopped
  await ingest(r.ctx, letter("noreply@acme.test", "<n1@acme.test>", "gm_n1", { mailboxId: "mbx_maya" }));
  assert.equal(
    (await send(r.ctx, sendIn({ mailboxId: "mbx_maya", to: [{ address: "noreply@acme.test" }] }))).status,
    "sent",
  );
});

test("mail for an address no inbox answers to is kept as a problem with the fix, once, and moves forward when it repeats", async () => {
  const r = rig();
  const input = letter("pat@acme.test", "<u1@acme.test>", "mg_u1", {
    source: "mailgun",
    envelopeTo: "ghost@vyre.test",
  });
  await assert.rejects(
    ingestWatched(r.ctx, input, () => ingest(r.ctx, input)),
    (e) => codeOf(e) === "validation.not_found",
  );
  r.h.advance(5 * MIN);
  await assert.rejects(
    ingestWatched(r.ctx, input, () => ingest(r.ctx, input)),
    (e) => codeOf(e) === "validation.not_found",
  );
  const out = await monitor(r.ctx, {});
  assert.deepEqual(contractErrors("mail.inbox.monitor", "out", out), []);
  assert.equal(out.unrouted.length, 1);
  assert.equal(out.unrouted[0]!.address, "ghost@vyre.test");
  assert.equal(out.unrouted[0]!.at, NOW + 5 * MIN);
  assert.match(out.unrouted[0]!.fix, /Add an inbox for that address/);
});

test("an inbox that receives by provider webhook shows when it last received and how many today", async () => {
  const r = rig();
  await ingest(
    r.ctx,
    letter("pat@acme.test", "<w1@acme.test>", "mg_w1", {
      source: "mailgun",
      envelopeTo: "hello@vyre.test",
      receivedAt: NOW,
    }),
  );
  r.h.ctx.db.run(`UPDATE mail_message SET "sentAt" = ? WHERE "providerId" = ?`, NOW - 2 * 86_400_000, "mg_w1");
  await ingest(
    r.ctx,
    letter("kim@acme.test", "<w2@acme.test>", "mg_w2", {
      source: "mailgun",
      envelopeTo: "hello@vyre.test",
      receivedAt: NOW - 10 * MIN,
    }),
  );
  const row = (await monitor(r.ctx, { mailboxId: "mbx_hello" })).inboxes[0]!;
  assert.deepEqual(
    [row.how, row.state, row.receivedToday, row.lastReceivedAt],
    ["provider_webhook", "ok", 1, NOW - 10 * MIN],
  );
  assert.equal(row.problem, undefined);
});

test("a failed sync shows its reason and the fix until something good arrives; a quiet pulling inbox is late, then failing", async () => {
  const r = rig();
  r.h.ctx.db.run(`UPDATE mail_mailbox SET "lastSyncAt" = ?, state = ? WHERE id = ?`, NOW, "syncing", "mbx_pat");
  const quiet = (await monitor(r.ctx, { mailboxId: "mbx_pat" })).inboxes[0]!;
  assert.deepEqual([quiet.how, quiet.state], ["imap", "ok"]);
  r.h.advance(45 * MIN);
  assert.equal((await monitor(r.ctx, { mailboxId: "mbx_pat" })).inboxes[0]!.state, "late");
  r.h.advance(4 * 60 * MIN);
  const down = (await monitor(r.ctx, { mailboxId: "mbx_pat" })).inboxes[0]!;
  assert.equal(down.state, "failing");
  assert.match(down.problem?.reason ?? "", /has not synced for hours/);

  // a sync that fails says why, through the event, and the reason is kept
  await syncWatched(r.ctx, async (watched) => {
    watched.emit("mailbox.sync_failed", "mailbox/mbx_pat", {
      mailboxId: "mbx_pat",
      reason: "The mailbox did not accept the sign-in. Reconnect it.",
    });
  });
  const failing = (await monitor(r.ctx, { mailboxId: "mbx_pat" })).inboxes[0]!;
  assert.equal(failing.state, "failing");
  assert.deepEqual(
    [failing.problem?.reason, failing.problem?.fix],
    ["The mailbox did not accept the sign-in. Reconnect it.", "Open the mailbox and reconnect it."],
  );
  assert.equal(r.h.named("mailbox.sync_failed").length, 1); // the event still goes out
  // a good sync after it clears the problem
  r.h.advance(MIN);
  r.h.ctx.db.run(
    `UPDATE mail_mailbox SET "lastSyncAt" = ?, state = ? WHERE id = ?`,
    r.h.ctx.now(),
    "syncing",
    "mbx_pat",
  );
  const healed = (await monitor(r.ctx, { mailboxId: "mbx_pat" })).inboxes[0]!;
  assert.deepEqual([healed.state, healed.problem], ["ok", undefined]);
});

test("a paused inbox says paused; an inbox the caller may not see is left out, and asking for it by id answers as if it were not there", async () => {
  const r = rig({ denied: new Set(["mbx_sam"]) });
  r.h.ctx.db.run(`UPDATE mail_mailbox SET paused = ? WHERE id = ?`, 1, "mbx_pat");
  const all = (await monitor(r.ctx, {})).inboxes;
  assert.equal(all.find((i) => i.mailboxId === "mbx_pat")?.state, "paused");
  assert.equal(
    all.some((i) => i.mailboxId === "mbx_sam"),
    false,
  );
  await assert.rejects(monitor(r.ctx, { mailboxId: "mbx_sam" }), (e) => codeOf(e) === "validation.not_found");
  await assert.rejects(monitor(r.ctx, { mailboxId: "nope" }), (e) => codeOf(e) === "validation.bad_input");
});

test("the unrouted-address list is for people who manage sending domains, and it keeps only the newest hundred", async () => {
  const r = rig();
  for (let n = 0; n < MAX_PROBLEMS + 25; n++) {
    r.h.advance(1000);
    const input = letter("pat@acme.test", `<u${n}@acme.test>`, `mg_u${n}`, {
      source: "mailgun",
      envelopeTo: `ghost${n}@vyre.test`,
    });
    await assert.rejects(ingestWatched(r.ctx, input, () => ingest(r.ctx, input)));
  }
  assert.equal(r.h.rows(`SELECT id FROM mail_inbound_problem WHERE kind = ?`, "no_inbox").length, MAX_PROBLEMS);
  const out = await monitor(r.ctx, {});
  assert.equal(out.unrouted.length, 20);
  assert.equal(out.unrouted[0]!.address, `ghost${MAX_PROBLEMS + 24}@vyre.test`); // newest first; the oldest are gone
  assert.equal(r.h.rows(`SELECT id FROM mail_inbound_problem WHERE address = ?`, "ghost0@vyre.test").length, 0);
  r.h.denied.add("spc_mailtest"); // the caller does not manage sending domains
  assert.deepEqual((await monitor(r.ctx, {})).unrouted, []);
  assert.ok((await monitor(r.ctx, {})).inboxes.length > 0);
});

test("an automatic reply to someone who sent machine-made mail this week is held; a person's is not", async () => {
  const r = rig({ origin: "automation" });
  await ingest(r.ctx, letter("noreply@acme.test", "<n2@acme.test>", "gm_n2", { mailboxId: "mbx_maya" }));
  const human = await ingest(r.ctx, letter("kim@acme.test", "<h2@acme.test>", "gm_h2", { mailboxId: "mbx_maya" }));
  // kim's message is from a person, but the reply goes to an address that is a known machine sender
  const toAuto = sendIn({
    mailboxId: "mbx_maya",
    to: [{ address: "noreply@acme.test" }],
    replyToMessageId: human.messageId,
  });
  assert.equal((await send(r.ctx, toAuto)).status, "held");
  const person = rig();
  await ingest(person.ctx, letter("noreply@acme.test", "<n3@acme.test>", "gm_n3", { mailboxId: "mbx_maya" }));
  const h2 = await ingest(person.ctx, letter("kim@acme.test", "<h3@acme.test>", "gm_h3", { mailboxId: "mbx_maya" }));
  assert.equal(
    (
      await send(
        person.ctx,
        sendIn({ mailboxId: "mbx_maya", to: [{ address: "noreply@acme.test" }], replyToMessageId: h2.messageId }),
      )
    ).status,
    "sent",
  );
});

test("an Automation may send one address only so many automatic replies an hour; fresh sends are not counted, nor a person's", async () => {
  const r = rig({ origin: "automation" });
  const m = await ingest(r.ctx, letter("kim@acme.test", "<h4@acme.test>", "gm_h4", { mailboxId: "mbx_maya" }));
  const reply = () =>
    sendIn({ mailboxId: "mbx_maya", to: [{ address: "kim@acme.test" }], replyToMessageId: m.messageId });
  for (let n = 0; n < AUTO_PER_HOUR; n++) assert.equal((await send(r.ctx, reply())).status, "sent");
  const held = await send(r.ctx, reply());
  assert.equal(held.status, "held");
  assert.match(held.note ?? "", /already sent kim@acme.test 5 automatic replies in the last hour/);
  // six document emails to one client from one run are fresh sends: never counted
  for (let n = 0; n < 8; n++)
    assert.equal(
      (await send(r.ctx, sendIn({ mailboxId: "mbx_maya", to: [{ address: "kim@acme.test" }] }))).status,
      "sent",
    );
  r.h.advance(61 * MIN);
  assert.equal((await send(r.ctx, reply())).status, "sent");
  const person = rig();
  const pm = await ingest(person.ctx, letter("kim@acme.test", "<h5@acme.test>", "gm_h5", { mailboxId: "mbx_maya" }));
  for (let n = 0; n < AUTO_PER_HOUR + 2; n++)
    await send(
      person.ctx,
      sendIn({ mailboxId: "mbx_maya", to: [{ address: "kim@acme.test" }], replyToMessageId: pm.messageId }),
    );
  assert.equal(person.sent().length, AUTO_PER_HOUR + 2);
});

test("our own retry in flight is never held by the guard; a forged retry key, or a retry key passed by anyone but the host, is", async () => {
  const r = rig({ origin: "automation", principal: { kind: "service", id: "svc_host" } });
  const auto = await ingest(
    r.ctx,
    letter("pat@acme.test", "<n5@acme.test>", "gm_n5", {
      mailboxId: "mbx_maya",
      headers: { "Auto-Submitted": "auto-replied" },
    }),
  );
  const { ensureDelivery } = await import("../handlers/extra/delivery.ts");
  ensureDelivery(r.ctx);
  const key = "retry:eml_orig0001:pat@acme.test:1";
  const mk = () =>
    sendIn({
      mailboxId: "mbx_maya",
      to: [{ address: "pat@acme.test" }],
      replyToMessageId: auto.messageId,
      idempotencyKey: key,
    });
  assert.equal(isOwnRetry(r.ctx, key), false);
  assert.equal((await send(r.ctx, mk())).status, "held"); // a forged key
  r.h.ctx.db.run(
    `INSERT INTO mail_delivery_retry ("messageId", address, attempts, "nextAt", state) VALUES (?, ?, ?, ?, ?)`,
    "eml_orig0001",
    "pat@acme.test",
    1,
    r.ctx.now(),
    "sending",
  );
  assert.equal(isOwnRetry(r.ctx, key), true);
  // an agent or an Automation that knows the key and the ids is still guarded
  const agent = r.ctx as unknown as { principal: { kind: string; id: string } };
  agent.principal = { kind: "agent", id: "agt_scout01" };
  assert.equal((await send(r.ctx, { ...mk(), idempotencyKey: `${key}x` })).status, "held");
  agent.principal = { kind: "service", id: "svc_flow" };
  r.h.ctx.db.run(`DELETE FROM mail_idem WHERE "idemKey" = ?`, key);
  assert.equal((await send(r.ctx, mk())).status, "held");
  agent.principal = { kind: "service", id: "svc_host" };
  r.h.ctx.db.run(`DELETE FROM mail_idem WHERE "idemKey" = ?`, key);
  assert.equal((await send(r.ctx, mk())).status, "sent");
});

test("a person's scheduled reply keeps the person as the actor when it comes due", async () => {
  const person = rig();
  const auto = await ingest(
    person.ctx,
    letter("noreply@acme.test", "<n4@acme.test>", "gm_n4", { mailboxId: "mbx_maya" }),
  );
  const out = await send(
    person.ctx,
    sendIn({
      mailboxId: "mbx_maya",
      to: [{ address: "noreply@acme.test" }],
      replyToMessageId: auto.messageId,
      sendAt: person.ctx.now() + 3_600_000,
    }),
  );
  assert.equal(out.status, "queued");
  person.h.advance(2 * 3_600_000);
  person.ctx.origin = "automation"; // the scheduler's call at due time
  const due = await send(person.ctx, person.scheduled[0]!.input as never);
  assert.equal(due.status, "sent");
});

test("mail.send_as goes through the same guard", async () => {
  const r = rig({ origin: "automation" });
  const auto = await ingest(
    r.ctx,
    letter("pat@acme.test", "<s1@acme.test>", "gm_s1", {
      mailboxId: "mbx_maya",
      headers: { "Auto-Submitted": "auto-replied" },
    }),
  );
  await assert.rejects(
    sendAs(r.ctx, {
      mailboxId: "mbx_maya",
      to: [{ address: "pat@acme.test" }],
      subject: "Re: x",
      text: "y",
      replyToMessageId: auto.messageId,
      idempotencyKey: "sa-1",
    }),
    (e) => /could start a loop/.test(String((e as Error).message)),
  );
});

test("noteAuto remembers the sender once and moves the time forward", async () => {
  const r = rig();
  noteAuto(r.ctx, "eml_a", "a mailing list", "News@Acme.test");
  r.h.advance(MIN);
  noteAuto(r.ctx, "eml_b", "a mailing list", "news@acme.test");
  assert.equal(r.h.rows(`SELECT address FROM mail_auto_sender`).length, 1);
});

test("an agent may keep only so many held replies open in one mailbox; past it the reply is refused, naming the oldest, and nothing is dropped", async () => {
  const r = rig({ origin: "automation" });
  const auto = await ingest(
    r.ctx,
    letter("pat@acme.test", "<c1@acme.test>", "gm_c1", {
      mailboxId: "mbx_maya",
      headers: { "Auto-Submitted": "auto-replied" },
    }),
  );
  const reply = (n: number) =>
    sendIn({
      mailboxId: "mbx_maya",
      to: [{ address: "pat@acme.test" }],
      subject: `Re: ${n}`,
      replyToMessageId: auto.messageId,
      idempotencyKey: `held-${n}`,
    });
  for (let n = 0; n < MAX_HELD; n++) assert.equal((await send(r.ctx, reply(n))).status, "held");
  await assert.rejects(send(r.ctx, reply(MAX_HELD)), (e) =>
    /50 automatic replies from this sender are already held.*Re: 0 \(eml_/.test(String((e as Error).message)),
  );
  assert.equal(r.h.rows(`SELECT id FROM mail_message WHERE status = ?`, "draft").length, MAX_HELD); // none lost, none added
  // sending or deleting one frees a place
  const first = r.h.rows(`SELECT id FROM mail_message WHERE status = ?`, "draft")[0]!.id as string;
  r.h.ctx.db.run(`UPDATE mail_message SET status = ? WHERE id = ?`, "sent", first);
  assert.equal((await send(r.ctx, reply(MAX_HELD))).status, "held");
  // another sender has its own count
  (r.ctx as unknown as { principal: { kind: string; id: string } }).principal = { kind: "service", id: "svc_other" };
  assert.equal((await send(r.ctx, { ...reply(900), idempotencyKey: "other-1" })).status, "held");
});

test("a send_as that is refused does not count toward the hourly cap", async () => {
  const r = rig({ origin: "automation", settings: { "send.cap": 1 } });
  const m = await ingest(r.ctx, letter("kim@acme.test", "<c2@acme.test>", "gm_c2", { mailboxId: "mbx_maya" }));
  const as = (key: string) => ({
    mailboxId: "mbx_maya",
    to: [{ address: "kim@acme.test" }],
    subject: "Re",
    text: "x",
    replyToMessageId: m.messageId,
    idempotencyKey: key,
  });
  await sendAs(r.ctx, as("a-1")); // takes the day's one slot
  await assert.rejects(sendAs(r.ctx, as("a-2"))); // over the daily limit: refused
  assert.equal(r.h.rows(`SELECT id FROM mail_auto_send`).length, 1, "only the one that went out is counted");
});

test("the held list reads only the sender's own rows and forgets the ones whose draft is gone, so it stays the size of what is open", async () => {
  const r = rig({ origin: "automation" });
  const auto = await ingest(
    r.ctx,
    letter("pat@acme.test", "<p1@acme.test>", "gm_p1", {
      mailboxId: "mbx_maya",
      headers: { "Auto-Submitted": "auto-replied" },
    }),
  );
  const reply = (n: number) =>
    sendIn({
      mailboxId: "mbx_maya",
      to: [{ address: "pat@acme.test" }],
      subject: `Re: ${n}`,
      replyToMessageId: auto.messageId,
      idempotencyKey: `prune-${n}`,
    });
  for (let n = 0; n < 5; n++) await send(r.ctx, reply(n));
  const ids = r.h.rows(`SELECT "messageId" FROM mail_held`).map((x) => x.messageId as string);
  assert.equal(ids.length, 5);
  // two are sent or deleted by people; one belongs to another sender
  r.h.ctx.db.run(`UPDATE mail_message SET status = ? WHERE id = ?`, "sent", ids[0]);
  r.h.ctx.db.run(`UPDATE mail_message SET deleted_at = ? WHERE id = ?`, r.ctx.now(), ids[1]);
  r.h.ctx.db.run(`UPDATE mail_held SET actor = ? WHERE "messageId" = ?`, "svc_other", ids[2]);
  const mine = openHeld(r.ctx, "mbx_maya", r.ctx.principal.id);
  assert.deepEqual(mine.map((m) => m.id).sort(), [ids[3], ids[4]].sort());
  const left = r.h
    .rows(`SELECT "messageId" FROM mail_held`)
    .map((x) => x.messageId as string)
    .sort();
  assert.deepEqual(
    left,
    [ids[2], ids[3], ids[4]].sort(),
    "the two finished rows are forgotten; the other sender's row is untouched",
  );
  assert.ok(
    readFileSync(new URL("../migrations/0015_sender_and_holds.sql", import.meta.url), "utf8").includes(
      'mail_held ("mailboxId", actor)',
    ),
    "the lookup by mailbox and sender has its index",
  );
});

test("held rows older than 30 days are forgotten for every sender, whoever holds the next one", async () => {
  const r = rig({ origin: "automation" });
  const auto = await ingest(
    r.ctx,
    letter("pat@acme.test", "<g1@acme.test>", "gm_g1", {
      mailboxId: "mbx_maya",
      headers: { "Auto-Submitted": "auto-replied" },
    }),
  );
  const reply = (n: number) =>
    sendIn({
      mailboxId: "mbx_maya",
      to: [{ address: "pat@acme.test" }],
      subject: `Re: ${n}`,
      replyToMessageId: auto.messageId,
      idempotencyKey: `age-${n}`,
    });
  const ctx = r.ctx as unknown as { principal: { kind: string; id: string } };
  for (const [n, who] of [
    [0, "svc_a"],
    [1, "svc_b"],
  ] as const) {
    ctx.principal = { kind: "service", id: who };
    await send(r.ctx, reply(n));
  }
  assert.equal(r.h.rows(`SELECT "messageId" FROM mail_held`).length, 2);
  r.h.advance(HELD_KEEP_MS + 1);
  ctx.principal = { kind: "service", id: "svc_c" };
  await send(r.ctx, reply(2)); // a third sender holds one: the two old rows of the other senders go with it
  assert.deepEqual(
    r.h.rows(`SELECT actor FROM mail_held`).map((x) => x.actor),
    ["svc_c"],
  );
  assert.equal(
    r.h.rows(`SELECT id FROM mail_message WHERE status = ?`, "draft").length,
    3,
    "only the bookkeeping rows go; the drafts stay for a person",
  );
});
