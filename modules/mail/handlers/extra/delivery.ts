// mail.delivery.trail and mail.delivery.retry (lane r42-email-in): what happened to a sent message, and the soft-bounce retries behind it.
//
// Trail: every provider event lands as one row, ordered by the time the provider gives (an event that arrives late sorts into place; the message status
// still only moves up its ladder, see status.ts). A replayed webhook has the same eventKey and lands once.
//
// Retry: a soft bounce is not the end. Up to MAX_RETRIES times, with growing waits, the one address that soft-bounced gets the message again as a NEW
// message to that address only (so nobody who already received the first mail gets a copy). The child maps back to the message the person sent, so its
// events join the same trail. When the tries run out the sent message becomes bounced and says why. A retry never double-sends: the call is keyed by
// (message, address, attempt), a second call for an attempt already made does nothing, and a retry stops at once if the address was suppressed since.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  bad,
  can,
  first,
  isId,
  missing,
  newId,
  num,
  readParties,
  readStrings,
  rowsOf,
  statements,
  str,
  strOrNull,
} from "../../projections.ts";
import type { MailCtx, Row } from "../../projections.ts";
import { readAttachments } from "./messages.ts";
import { fail } from "../../../../host/src/routes/errors.ts";
import { isHostService } from "../../../../lib/trust.ts";
import { ensureAll } from "./common.ts";

const SQL = ["0010_delivery_trail.sql", "0015_sender_and_holds.sql"]
  .map((f) => readFileSync(fileURLToPath(new URL(`../../migrations/${f}`, import.meta.url)), "utf8"))
  .join("\n");
const ready = new WeakSet<object>();

/** Make sure the trail and retry tables exist (one cheap probe per call after the first). */
export function ensureDelivery(ctx: Pick<MailCtx, "db">): void {
  ensureAll(ctx);
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "childId" FROM mail_delivery_child WHERE "childId" = ?`, "probe");
    ctx.db.all(`SELECT "messageId" FROM mail_sent_by WHERE "messageId" = ?`, "probe");
  } catch {
    for (const statement of statements(SQL)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

// ---- the trail

export type TrailKind =
  | "queued"
  | "held"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "soft_bounced"
  | "bounced"
  | "complained"
  | "failed"
  | "retry_scheduled"
  | "retried"
  | "gave_up";

export interface TrailEntry {
  kind: TrailKind;
  at: number;
  address?: string;
  detail?: string;
}

/** Add one row to a message's trail. Answers false when the same event was recorded before. */
export function recordTrail(
  ctx: MailCtx,
  messageId: string,
  entry: TrailEntry,
  eventKey: string,
): boolean {
  ensureDelivery(ctx);
  const seen = first(ctx.db.all(`SELECT id FROM mail_delivery_event WHERE "eventKey" = ?`, eventKey));
  if (seen) return false;
  ctx.db.run(
    `INSERT INTO mail_delivery_event (id, "messageId", "eventKey", kind, address, detail, at, "recordedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    newId("dev", ctx.now()),
    messageId,
    eventKey,
    entry.kind,
    entry.address ?? null,
    entry.detail ?? null,
    entry.at,
    ctx.now(),
  );
  return true;
}

const WORDS: Record<TrailKind, string> = {
  queued: "Waiting to send",
  held: "Held for approval",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Link clicked",
  soft_bounced: "Could not deliver yet",
  bounced: "Bounced",
  complained: "Marked as spam",
  failed: "Failed",
  retry_scheduled: "Will try again",
  retried: "Tried again",
  gave_up: "Stopped trying",
};

export interface TrailOut {
  messageId: string;
  state: "waiting" | "sent" | "delivered" | "retrying" | "held" | "bounced" | "complained" | "failed";
  /** Who asked for this message to be sent, whoever has run a retry of it since. */
  sentBy?: { kind: string; id: string };
  events: { kind: TrailKind; at: number; label: string; address?: string; detail?: string }[];
  /** An address that cannot be sent to until someone fixes or clears it, with the plain reason. */
  blocked: { address: string; reason: string }[];
  retry?: { address: string; attempt: number; of: number; nextAt?: number };
}

export async function trail(ctx: MailCtx, input: { messageId: string }): Promise<TrailOut> {
  ensureDelivery(ctx);
  if (!isId("eml", input.messageId)) bad(ctx, "Message id is not valid.");
  const msg = first(ctx.db.all(`SELECT * FROM mail_message WHERE id = ? AND deleted_at IS NULL`, input.messageId));
  const boxes = msg ? readStrings(str(msg, "inboxIds")) : [];
  const doors = boxes.length ? boxes : msg ? [str(msg, "mailboxId")] : [];
  // a message the person may not see answers exactly as one that is not there
  if (!msg || !doors.some((id) => can(ctx, "view", { type: "mailbox", id })))
    return missing(ctx, "Message does not exist.");

  // oldest first by the provider's own time, then by when we heard (sorted here: the same on every database)
  const rows = rowsOf(ctx.db.all(`SELECT * FROM mail_delivery_event WHERE "messageId" = ?`, input.messageId)).sort(
    (a, b) => num(a, "at") - num(b, "at") || num(a, "recordedAt") - num(b, "recordedAt") || str(a, "id").localeCompare(str(b, "id")),
  );
  const events = rows.map((r) => {
    const kind = str(r, "kind") as TrailKind;
    const e: TrailOut["events"][number] = { kind, at: num(r, "at"), label: WORDS[kind] ?? kind };
    const address = strOrNull(r, "address");
    const detail = strOrNull(r, "detail");
    if (address) e.address = address;
    if (detail) e.detail = detail;
    return e;
  });

  // the send itself is on the message row, not in the provider events: it opens the trail unless a recorded one does
  const sentAt = num(msg, "sentAt");
  if (str(msg, "direction") === "out" && sentAt > 0 && !events.some((e) => e.kind === "sent"))
    events.unshift({ kind: "sent", at: sentAt, label: WORDS.sent });

  const retries = rowsOf(ctx.db.all(`SELECT * FROM mail_delivery_retry WHERE "messageId" = ?`, input.messageId));
  const live = retries.find((r) => ["pending", "sending"].includes(str(r, "state")));
  const stuck = retries.find((r) => str(r, "state") === "held");
  const status = str(msg, "status");
  const state: TrailOut["state"] = live
    ? "retrying"
    : stuck
      ? "held"
    : status === "queued" || status === "draft"
      ? "waiting"
      : status === "delivered"
        ? "delivered"
        : status === "bounced"
          ? "bounced"
          : status === "complained"
            ? "complained"
            : status === "failed"
              ? "failed"
              : "sent";

  const blocked: TrailOut["blocked"] = [];
  const recipients = [...readParties(str(msg, "toAddresses")), ...readParties(str(msg, "ccAddresses"))].map((p) =>
    p.address.toLowerCase(),
  );
  const failed = new Set(events.filter((e) => e.kind === "bounced" || e.kind === "complained").map((e) => e.address));
  const named = [...new Set(recipients)].filter((a) => failed.has(a) || failed.size === 0);
  if (state === "bounced" || state === "complained") {
    // a viewer without the contacts permission still reads the trail, just without the blocked line
    const checked = (await ctx.call("contacts.suppression.check", { channel: "email", addresses: named }).catch(() => ({}))) as {
      suppressed?: { address: string; reason?: string }[];
    };
    for (const s of Array.isArray(checked?.suppressed) ? checked.suppressed : []) {
      blocked.push({
        address: s.address,
        reason:
          s.reason === "complaint"
            ? "They marked an email from you as spam."
            : "Their mail server says this address does not exist.",
      });
    }
  }

  const out: TrailOut = { messageId: input.messageId, state, events, blocked };
  const by = first(ctx.db.all(`SELECT * FROM mail_sent_by WHERE "messageId" = ?`, input.messageId));
  if (by) out.sentBy = { kind: str(by, "kind"), id: strOrNull(by, "actingFor") ?? str(by, "principal") };
  if (live)
    out.retry = {
      address: str(live, "address"),
      attempt: num(live, "attempts"),
      of: MAX_RETRIES,
      ...(typeof live.nextAt === "number" ? { nextAt: live.nextAt } : {}),
    };
  return out;
}

// ---- retries

export const MAX_RETRIES = 3;
/** Waits before the first, second and third retry. */
export const BACKOFF_MS = [5 * 60_000, 30 * 60_000, 4 * 60 * 60_000] as const;

interface Scheduler {
  schedule?(at: number, cap: string, input: unknown, opts?: { system?: boolean }): Promise<string>;
}

/** What a retry sends with. By default the module's own send, called directly (the host holds no grant on a mailbox and the Gate has already had its say on the first send). Tests bind a recorder. */
export type RetrySend = (ctx: MailCtx, input: Record<string, unknown>) => Promise<{ messageId?: string; status?: string }>;
/** A test replaces `send` here; production leaves it null. */
export const retrySender: { send: RetrySend | null } = { send: null };
async function sendAgain(ctx: MailCtx, input: Record<string, unknown>): Promise<{ messageId?: string; status?: string }> {
  if (retrySender.send) return retrySender.send(ctx, input);
  const { send } = await import("../send.ts");
  return (await send(ctx as never, input as never)) as { messageId?: string; status?: string };
}

/** The root message a retry child belongs to; a message that is not a child is its own root. */
export function rootOf(ctx: MailCtx, messageId: string): string {
  ensureDelivery(ctx);
  const hit = first(ctx.db.all(`SELECT "rootId" FROM mail_delivery_child WHERE "childId" = ?`, messageId));
  return hit ? str(hit, "rootId") : messageId;
}

/**
 * A soft bounce for one address. Answers true when a retry is now waiting (the message must NOT be marked bounced), false when the tries are used up
 * or retrying is not possible (the caller marks the message bounced as it always did).
 */
export async function planRetry(
  ctx: MailCtx,
  rootId: string,
  address: string,
  reason: string | undefined,
  at: number,
): Promise<boolean> {
  ensureDelivery(ctx);
  const row = first(
    ctx.db.all(`SELECT * FROM mail_delivery_retry WHERE "messageId" = ? AND address = ?`, rootId, address),
  );
  const attempts = row ? num(row, "attempts") : 0;
  if (row && (str(row, "state") === "pending" || str(row, "state") === "sending" || str(row, "state") === "held")) return true; // one retry waits already; a second soft bounce event does not add another
  if (attempts >= MAX_RETRIES) {
    markGaveUp(ctx, rootId, address, reason, at);
    return false;
  }
  const scheduler = ctx as unknown as Scheduler;
  if (typeof scheduler.schedule !== "function") return false; // nothing to wake a retry: say bounced now rather than promise one
  const next = attempts + 1;
  const when = ctx.now() + (BACKOFF_MS[attempts] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!);
  if (row) {
    ctx.db.run(
      `UPDATE mail_delivery_retry SET state = ?, "nextAt" = ?, "lastReason" = ? WHERE "messageId" = ? AND address = ?`,
      "pending",
      when,
      reason ?? null,
      rootId,
      address,
    );
  } else {
    ctx.db.run(
      `INSERT INTO mail_delivery_retry ("messageId", address, attempts, "nextAt", state, "lastReason") VALUES (?, ?, ?, ?, ?, ?)`,
      rootId,
      address,
      0,
      when,
      "pending",
      reason ?? null,
    );
  }
  try {
    await scheduler.schedule(when, "mail.delivery.retry", { messageId: rootId, address, attempt: next }, { system: true });
  } catch {
    ctx.db.run(
      `UPDATE mail_delivery_retry SET state = ? WHERE "messageId" = ? AND address = ?`,
      "gave_up",
      rootId,
      address,
    );
    return false;
  }
  recordTrail(
    ctx,
    rootId,
    { kind: "retry_scheduled", at: ctx.now(), address, detail: `Try ${next} of ${MAX_RETRIES}` },
    `retry_scheduled|${rootId}|${address}|${next}`,
  );
  return true;
}

function markGaveUp(ctx: MailCtx, rootId: string, address: string, reason: string | undefined, at: number): void {
  ctx.db.run(
    `UPDATE mail_delivery_retry SET state = ?, "nextAt" = ? WHERE "messageId" = ? AND address = ?`,
    "gave_up",
    null,
    rootId,
    address,
  );
  recordTrail(
    ctx,
    rootId,
    {
      kind: "gave_up",
      at,
      address,
      detail: reason ? `Tried ${MAX_RETRIES} times. ${reason}` : `Tried ${MAX_RETRIES} times.`,
    },
    `gave_up|${rootId}|${address}`,
  );
}

export type RetryOutcome = "sent" | "skipped" | "gave_up" | "rescheduled" | "held";

export interface RetryIn {
  messageId: string;
  address: string;
  attempt: number;
}

/** How long a claimed attempt may stay unfinished before the recovery call takes it up again. */
export const CLAIM_STALE_MS = 10 * 60_000;

const codeOf = (e: unknown): string =>
  (e as { error?: { code?: string }; code?: string } | null)?.error?.code ?? (e as { code?: string } | null)?.code ?? "";

/**
 * The scheduled retry. Safe to call twice for the same attempt: only the first one sends.
 * The attempt is claimed in the same step that checks it, before any await, so two calls cannot both win. A claimed attempt that never finished
 * (the process died) is taken up by the recovery call scheduled with the claim; sending again is safe because the send is keyed by the attempt.
 */
export async function retry(ctx: MailCtx, input: RetryIn): Promise<{ outcome: RetryOutcome; messageId?: string }> {
  ensureDelivery(ctx);
  // the host's own follow-up, and nobody else: a person's or agent's identity is never replayed here
  if (!isHostService(ctx.principal)) throw fail("permission.no_grant", ctx.trace.traceId, { message: "Retries are run by Vyre itself." });
  if (!isId("eml", input.messageId)) bad(ctx, "Message id is not valid.");
  if (typeof input.address !== "string" || input.address.trim() === "") bad(ctx, "Address is required.");
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > MAX_RETRIES)
    bad(ctx, "Attempt is not valid.");
  const address = input.address.trim().toLowerCase();
  const row = first(
    ctx.db.all(`SELECT * FROM mail_delivery_retry WHERE "messageId" = ? AND address = ?`, input.messageId, address),
  );
  if (!row) return { outcome: "skipped" };
  const state = str(row, "state");
  const attempts = num(row, "attempts");
  const now = ctx.now();
  let recovering = false;
  if (state === "pending" && attempts + 1 === input.attempt) {
    // not due yet: nothing happens and the attempt stays waiting for its time
    if (typeof row.nextAt === "number" && row.nextAt > now) return { outcome: "skipped" };
    ctx.db.run(
      `UPDATE mail_delivery_retry SET attempts = ?, state = ?, "nextAt" = ? WHERE "messageId" = ? AND address = ? AND state = ?`,
      input.attempt,
      "sending",
      now,
      input.messageId,
      address,
      "pending",
    );
    const check = first(
      ctx.db.all(`SELECT state, attempts FROM mail_delivery_retry WHERE "messageId" = ? AND address = ?`, input.messageId, address),
    );
    if (!check || str(check, "state") !== "sending" || num(check, "attempts") !== input.attempt) return { outcome: "skipped" };
  } else if (state === "sending" && attempts === input.attempt) {
    // a claimed attempt that never finished: resume it once the claim is stale
    const claimedAt = typeof row.nextAt === "number" ? row.nextAt : 0;
    if (now - claimedAt < CLAIM_STALE_MS) return { outcome: "skipped" };
    recovering = true;
    ctx.db.run(`UPDATE mail_delivery_retry SET "nextAt" = ? WHERE "messageId" = ? AND address = ?`, now, input.messageId, address);
  } else return { outcome: "skipped" };

  // the recovery call: if this attempt dies before it ends, this wakes it
  const scheduler = ctx as unknown as Scheduler;
  if (!recovering && typeof scheduler.schedule === "function")
    await scheduler.schedule(now + CLAIM_STALE_MS + 1_000, "mail.delivery.retry", {
      messageId: input.messageId,
      address,
      attempt: input.attempt,
    }, { system: true }).catch(() => undefined);

  const msg = first(
    ctx.db.all(`SELECT * FROM mail_message WHERE id = ? AND direction = ? AND deleted_at IS NULL`, input.messageId, "out"),
  );
  if (!msg) {
    finish(ctx, input.messageId, address, "gave_up");
    return { outcome: "skipped" };
  }
  const status = str(msg, "status");
  // this address already got it (a delivered event for it, or it was the only one written to), or the person it went to complained
  const everyone = new Set([...readParties(str(msg, "toAddresses")), ...readParties(str(msg, "ccAddresses"))].map((p) => p.address.toLowerCase()));
  const got = rowsOf(ctx.db.all(`SELECT * FROM mail_delivery_event WHERE "messageId" = ?`, input.messageId)).some(
    (e) => str(e, "kind") === "delivered" && ((strOrNull(e, "address") ?? "").toLowerCase() === address || (!strOrNull(e, "address") && everyone.size <= 1)),
  );
  if (got || (status === "delivered" && everyone.size <= 1) || status === "complained") {
    finish(ctx, input.messageId, address, "done");
    return { outcome: "skipped" };
  }

  // the mailbox must still be there and connected: a retry does not send from one that was removed or disconnected
  const box = first(ctx.db.all(`SELECT state, paused, deleted_at FROM mail_mailbox WHERE id = ?`, str(msg, "mailboxId")));
  if (!box || box.deleted_at != null || str(box, "state") === "disconnected") {
    await giveUp(ctx, msg, address, "The mailbox it was sent from is no longer connected.");
    return { outcome: "gave_up" };
  }
  // an address suppressed while the retry waited is never sent to
  const checked = (await ctx.call("contacts.suppression.check", { channel: "email", addresses: [address] })) as {
    suppressed?: unknown[];
  };
  if (Array.isArray(checked?.suppressed) && checked.suppressed.length > 0) {
    finish(ctx, input.messageId, address, "gave_up");
    recordTrail(
      ctx,
      input.messageId,
      { kind: "gave_up", at: ctx.now(), address, detail: "This address cannot be emailed any more." },
      `gave_up|${input.messageId}|${address}`,
    );
    return { outcome: "gave_up" };
  }

  // the same message again: its own subject, body, attachments and place in the thread; only the one address that bounced
  const rebuilt = rebuild(ctx, msg);
  if (typeof rebuilt === "string") {
    await giveUp(ctx, msg, address, rebuilt);
    return { outcome: "gave_up" };
  }
  const key = `retry:${input.messageId}:${address}:${input.attempt}`;
  let childId: string | undefined;
  let held = false;
  try {
    const sent = await sendAgain(ctx, {
      mailboxId: str(msg, "mailboxId"),
      to: [{ address }],
      ...rebuilt,
      idempotencyKey: key,
    });
    childId = sent.messageId;
    if (sent.status === "suppressed") {
      finish(ctx, input.messageId, address, "gave_up");
      return { outcome: "gave_up" };
    }
    held = sent.status === "held" || sent.status === "queued";
  } catch (e) {
    // whoever runs this (the host's schedule runs it as whoever scheduled it) may lack the right to send from this mailbox: that is not a failed try, so the attempt is given back untouched
    if (codeOf(e).startsWith("permission.")) {
      const had = first(ctx.db.all(`SELECT n FROM mail_retry_giveback WHERE "messageId" = ? AND address = ?`, input.messageId, address));
      const n = (had ? num(had, "n") : 0) + 1;
      const why = e instanceof Error && e.message ? e.message : "no right to send";
      if (had) ctx.db.run(`UPDATE mail_retry_giveback SET n = ?, "lastReason" = ? WHERE "messageId" = ? AND address = ?`, n, why, input.messageId, address);
      else ctx.db.run(`INSERT INTO mail_retry_giveback ("messageId", address, n, "lastReason") VALUES (?, ?, ?, ?)`, input.messageId, address, n, why);
      if (n >= MAX_GIVEBACKS) {
        // it will not loop forever: held, with the reason, for a person to send
        finish(ctx, input.messageId, address, "held");
        recordTrail(ctx, input.messageId, { kind: "held", at: ctx.now(), address, detail: `Could not be sent again automatically (${why}). Send it again by hand.` }, `held_retry|${input.messageId}|${address}`);
        return { outcome: "held" };
      }
      ctx.db.run(
        `UPDATE mail_delivery_retry SET attempts = ?, state = ?, "nextAt" = ? WHERE "messageId" = ? AND address = ? AND state = ?`,
        input.attempt - 1,
        "pending",
        ctx.now(),
        input.messageId,
        address,
        "sending",
      );
      throw e;
    }
    // the provider may already have the mail even though something after it failed: then the attempt went out, and nothing is sent again
    const accepted = acceptedChild(ctx, input.messageId, address, now);
    if (accepted) {
      childId = accepted;
      ctx.log.warn("mail.delivery.retry: accepted, a later step failed", { messageId: input.messageId, attempt: input.attempt });
    } else {
      ctx.log.warn("mail.delivery.retry failed", { messageId: input.messageId, attempt: input.attempt });
      // the attempt counted; the next one waits longer, or the tries are used up and the message is bounced
      ctx.db.run(
        `UPDATE mail_delivery_retry SET state = ?, "lastReason" = ? WHERE "messageId" = ? AND address = ?`,
        "failed_try",
        e instanceof Error ? e.message : "send failed",
        input.messageId,
        address,
      );
      const again = await planRetry(ctx, input.messageId, address, "The server could not send the retry.", ctx.now());
      if (!again) {
        await giveUp(ctx, msg, address, "The server could not send the retry.");
        return { outcome: "gave_up" };
      }
      return { outcome: "rescheduled" };
    }
  }
  if (childId) {
    const origin = first(ctx.db.all(`SELECT * FROM mail_sent_by WHERE "messageId" = ?`, input.messageId));
    if (origin) recordSentBy(ctx, childId, { kind: str(origin, "kind"), principal: str(origin, "principal"), actingFor: strOrNull(origin, "actingFor") });
    ctx.db.run(`INSERT OR IGNORE INTO mail_delivery_child ("childId", "rootId", address) VALUES (?, ?, ?)`, childId, input.messageId, address);
    ctx.db.run(`UPDATE mail_delivery_retry SET "childId" = ? WHERE "messageId" = ? AND address = ?`, childId, input.messageId, address);
  }
  recordTrail(
    ctx,
    input.messageId,
    {
      kind: held ? "held" : "retried",
      at: ctx.now(),
      address,
      detail: held ? `Try ${input.attempt} of ${MAX_RETRIES} is waiting to leave` : `Try ${input.attempt} of ${MAX_RETRIES}`,
    },
    `${held ? "held" : "retried"}|${input.messageId}|${address}|${input.attempt}`,
  );
  // 'sending' ends here: the child's own events now decide what happens next
  ctx.db.run(
    `UPDATE mail_delivery_retry SET state = ?, "nextAt" = ? WHERE "messageId" = ? AND address = ? AND state = ?`,
    "waiting",
    null,
    input.messageId,
    address,
    "sending",
  );
  return { outcome: "sent", ...(childId ? { messageId: childId } : {}) };
}

/**
 * What mail.send needs to send a stored message again: subject, text, html, attachments, and the message it answered. A string means it cannot be rebuilt
 * (no body, or an attachment that is not a Vyre file) and says why.
 */
function rebuild(ctx: MailCtx, msg: Row): Record<string, unknown> | string {
  const id = str(msg, "id");
  const body = first(ctx.db.all(`SELECT text, html, headers FROM mail_body WHERE "messageId" = ?`, id));
  const text = strOrNull(body, "text");
  const html = strOrNull(body, "html");
  if (!text && !html) return "The message could not be sent again because its body is not kept.";
  const files: string[] = [];
  for (const a of readAttachments(str(msg, "attachments"))) {
    if (!a.fileId) return "The message could not be sent again because an attachment is not kept.";
    files.push(a.fileId);
  }
  const out: Record<string, unknown> = { subject: str(msg, "subject"), ...(text ? { text } : {}), ...(html ? { html } : {}) };
  if (files.length) out.attachments = files;
  try {
    const headers = JSON.parse(strOrNull(body, "headers") ?? "{}") as Record<string, unknown>;
    const parentRfc = String(headers["In-Reply-To"] ?? headers["in-reply-to"] ?? "").trim().toLowerCase();
    if (parentRfc) {
      const parent = first(ctx.db.all(`SELECT "messageId" FROM mail_rfc WHERE "rfcMessageId" = ?`, parentRfc));
      if (parent) out.replyToMessageId = str(parent, "messageId");
    }
  } catch {
    /* no readable headers: sent without a thread, which is better than not sent */
  }
  return out;
}

/** A retry child ended for good (hard bounce, complaint, failure): the message the person sent ends the same way, and its retry closes. */
export function childEnded(
  ctx: MailCtx,
  rootId: string,
  address: string,
  status: "bounced" | "complained" | "failed",
  reason: string | undefined,
): void {
  finish(ctx, rootId, address, "gave_up");
  const root = first(ctx.db.all(`SELECT * FROM mail_message WHERE id = ?`, rootId));
  if (!root) return;
  const current = str(root, "status");
  // once the message the person sent is delivered (or already ended), a later failure of a retry stays on the trail; it never changes the original
  if (["delivered", "bounced", "complained", "failed"].includes(current)) return;
  ctx.db.run(
    `UPDATE mail_message SET status = ?, version = ?, updated_at = ? WHERE id = ?`,
    status,
    num(root, "version") + 1,
    ctx.now(),
    rootId,
  );
  const subject = `mail_message/${rootId}`;
  if (status === "bounced") ctx.emit("message.bounced", subject, { messageId: rootId, channel: "email", address, kind: "hard", ...(reason ? { reason } : {}) });
  else if (status === "complained") ctx.emit("message.complained", subject, { messageId: rootId, channel: "email", address });
  else ctx.emit("message.failed", subject, { messageId: rootId, channel: "email", reason: reason || "The provider could not send the message." });
}

function finish(ctx: MailCtx, messageId: string, address: string, state: string): void {
  ctx.db.run(
    `UPDATE mail_delivery_retry SET state = ?, "nextAt" = ? WHERE "messageId" = ? AND address = ?`,
    state,
    null,
    messageId,
    address,
  );
}

/** The tries are used up: the message the person sent is bounced, and the trail says so. */
export async function giveUp(ctx: MailCtx, msg: Row, address: string, reason: string): Promise<void> {
  const id = str(msg, "id");
  finish(ctx, id, address, "gave_up");
  markGaveUp(ctx, id, address, reason, ctx.now());
  if (!["delivered", "bounced", "complained", "failed"].includes(str(msg, "status"))) {
    ctx.db.run(
      `UPDATE mail_message SET status = ?, version = ?, updated_at = ? WHERE id = ?`,
      "bounced",
      num(msg, "version") + 1,
      ctx.now(),
      id,
    );
    ctx.emit("message.bounced", `mail_message/${id}`, { messageId: id, channel: "email", address, kind: "soft", reason });
  }
}

/** A retry child delivered: the message the person sent is delivered too when it went to that one person. */
export function childDelivered(ctx: MailCtx, rootId: string, address: string): void {
  const retryRow = first(
    ctx.db.all(`SELECT state FROM mail_delivery_retry WHERE "messageId" = ? AND address = ?`, rootId, address),
  );
  if (retryRow) finish(ctx, rootId, address, "done");
  const root = first(ctx.db.all(`SELECT * FROM mail_message WHERE id = ?`, rootId));
  if (!root || ["delivered", "bounced", "complained", "failed"].includes(str(root, "status"))) return;
  const everyone = new Set(
    [...readParties(str(root, "toAddresses")), ...readParties(str(root, "ccAddresses"))].map((p) =>
      p.address.toLowerCase(),
    ),
  );
  if (everyone.size === 1 && everyone.has(address)) {
    ctx.db.run(
      `UPDATE mail_message SET status = ?, version = ?, updated_at = ? WHERE id = ?`,
      "delivered",
      num(root, "version") + 1,
      ctx.now(),
      rootId,
    );
    ctx.emit("message.delivered", `mail_message/${rootId}`, { messageId: rootId, channel: "email" });
  }
}

/** True when a send is one of our own retries in flight: its key names a message and address whose retry is claimed at that attempt. Nobody else can hold such a key. */
export function isOwnRetry(ctx: MailCtx, key: string | undefined): boolean {
  if (!key || !key.startsWith("retry:")) return false;
  const m = /^retry:(eml_[a-z0-9]+):(.+):([1-9])$/.exec(key);
  if (!m) return false;
  ensureDelivery(ctx);
  const row = first(ctx.db.all(`SELECT state, attempts FROM mail_delivery_retry WHERE "messageId" = ? AND address = ?`, m[1], m[2]));
  return !!row && str(row, "state") === "sending" && num(row, "attempts") === Number(m[3]);
}

/**
 * Remember who asked for a message to be sent (the person an agent acts for, else the caller). The first record stands: a queued message coming back at its time, run by someone else,
 * never replaces it. Only an explicit `by` (a retry passing the original's) writes over it.
 */
export function recordSentBy(ctx: MailCtx, messageId: string, by?: { kind: string; principal: string; actingFor?: string | null }): void {
  ensureDelivery(ctx);
  const have = first(ctx.db.all(`SELECT "messageId" FROM mail_sent_by WHERE "messageId" = ?`, messageId));
  if (have && !by) return;
  const who = by ?? { kind: ctx.principal.kind, principal: ctx.principal.id, actingFor: ctx.actingFor ?? null };
  if (have) ctx.db.run(`UPDATE mail_sent_by SET kind = ?, principal = ?, "actingFor" = ? WHERE "messageId" = ?`, who.kind, who.principal, who.actingFor ?? null, messageId);
  else ctx.db.run(`INSERT INTO mail_sent_by ("messageId", kind, principal, "actingFor", at) VALUES (?, ?, ?, ?, ?)`, messageId, who.kind, who.principal, who.actingFor ?? null, ctx.now());
}

const RETRY_KEY = /^retry:(eml_[a-z0-9]+):(.+):([1-9])$/;

/** Is this send one of our own retries, in flight, and run by the host service? Nobody else gets the retry's exemptions, whatever key they pass. */
export function ownRetry(ctx: MailCtx, key: string | undefined): boolean {
  return isHostService(ctx.principal) && isOwnRetry(ctx, key);
}

/** One provider key for every attempt of the same retry: the message and the address, never the attempt, so a provider that dedupes never sends twice. */
export function providerKeyOf(key: string): string | undefined {
  const m = RETRY_KEY.exec(key);
  return m ? `retry:${m[1]}:${m[2]}` : undefined;
}

/** A retry's message is written: tie it to the message it retries and to the person who asked for that one, before the provider is called. */
export function adoptChild(ctx: MailCtx, childId: string, key: string): void {
  const m = RETRY_KEY.exec(key);
  if (!m) return;
  ensureDelivery(ctx);
  ctx.db.run(`INSERT OR IGNORE INTO mail_delivery_child ("childId", "rootId", address) VALUES (?, ?, ?)`, childId, m[1], m[2]);
  const origin = first(ctx.db.all(`SELECT * FROM mail_sent_by WHERE "messageId" = ?`, m[1]));
  if (origin) recordSentBy(ctx, childId, { kind: str(origin, "kind"), principal: str(origin, "principal"), actingFor: strOrNull(origin, "actingFor") });
}

/** The child of a retry that the provider has already accepted since `since`, if any: the attempt went out even if something after it failed. */
function acceptedChild(ctx: MailCtx, rootId: string, address: string, since: number): string | undefined {
  for (const c of rowsOf(ctx.db.all(`SELECT * FROM mail_delivery_child WHERE "rootId" = ?`, rootId))) {
    if (str(c, "address") !== address) continue;
    const m = first(ctx.db.all(`SELECT "providerId", updated_at FROM mail_message WHERE id = ?`, str(c, "childId")));
    if (m && strOrNull(m, "providerId") && num(m, "updated_at") >= since) return str(c, "childId");
  }
  return undefined;
}

/** A retry handed back this many times for lack of a right is held for a person, with the reason, and stops. */
export const MAX_GIVEBACKS = 3;
