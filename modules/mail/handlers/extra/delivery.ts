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
import { ensureAll } from "./common.ts";

const SQL = readFileSync(fileURLToPath(new URL("../../migrations/0007_delivery_trail.sql", import.meta.url)), "utf8");
const ready = new WeakSet<object>();

/** Make sure the trail and retry tables exist (one cheap probe per call after the first). */
export function ensureDelivery(ctx: Pick<MailCtx, "db">): void {
  ensureAll(ctx);
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "childId" FROM mail_delivery_child WHERE "childId" = ?`, "probe");
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
  state: "waiting" | "sent" | "delivered" | "retrying" | "bounced" | "complained" | "failed";
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

  const rows = rowsOf(
    ctx.db.all(
      `SELECT * FROM mail_delivery_event WHERE "messageId" = ? ORDER BY at ASC, "recordedAt" ASC, id ASC`,
      input.messageId,
    ),
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
  const live = retries.find((r) => str(r, "state") === "pending");
  const status = str(msg, "status");
  const state: TrailOut["state"] = live
    ? "retrying"
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
    const checked = (await ctx.call("contacts.suppression.check", { channel: "email", addresses: named })) as {
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
  schedule?(at: number, cap: string, input: unknown): Promise<string>;
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
  if (row && str(row, "state") === "pending") return true; // one retry waits already; a second soft bounce event does not add another
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
    await scheduler.schedule(when, "mail.delivery.retry", { messageId: rootId, address, attempt: next });
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

export type RetryOutcome = "sent" | "skipped" | "gave_up" | "rescheduled";

export interface RetryIn {
  messageId: string;
  address: string;
  attempt: number;
}

/** The scheduled retry. Safe to call twice for the same attempt: only the first one sends. */
export async function retry(ctx: MailCtx, input: RetryIn): Promise<{ outcome: RetryOutcome; messageId?: string }> {
  ensureDelivery(ctx);
  if (!isId("eml", input.messageId)) bad(ctx, "Message id is not valid.");
  if (typeof input.address !== "string" || input.address.trim() === "") bad(ctx, "Address is required.");
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1 || input.attempt > MAX_RETRIES)
    bad(ctx, "Attempt is not valid.");
  const address = input.address.trim().toLowerCase();
  const row = first(
    ctx.db.all(`SELECT * FROM mail_delivery_retry WHERE "messageId" = ? AND address = ?`, input.messageId, address),
  );
  // already made, superseded, finished or never planned: nothing to send
  if (!row || str(row, "state") !== "pending" || num(row, "attempts") + 1 !== input.attempt) return { outcome: "skipped" };
  const msg = first(
    ctx.db.all(`SELECT * FROM mail_message WHERE id = ? AND direction = ? AND deleted_at IS NULL`, input.messageId, "out"),
  );
  if (!msg) return { outcome: "skipped" };
  const status = str(msg, "status");
  if (status === "delivered" || status === "complained") {
    finish(ctx, input.messageId, address, "done");
    return { outcome: "skipped" };
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

  // claim the attempt before sending: a crash after this point cannot send the same attempt twice
  ctx.db.run(
    `UPDATE mail_delivery_retry SET attempts = ?, state = ?, "nextAt" = ? WHERE "messageId" = ? AND address = ? AND attempts = ?`,
    input.attempt,
    "sending",
    null,
    input.messageId,
    address,
    input.attempt - 1,
  );
  const body = first(ctx.db.all(`SELECT text, html FROM mail_body WHERE "messageId" = ?`, input.messageId));
  const text = strOrNull(body, "text");
  const html = strOrNull(body, "html");
  const key = `retry:${input.messageId}:${address}:${input.attempt}`;
  let childId: string | undefined;
  try {
    const sent = (await ctx.call("mail.send", {
      mailboxId: str(msg, "mailboxId"),
      to: [{ address }],
      subject: str(msg, "subject"),
      ...(text ? { text } : {}),
      ...(html ? { html } : {}),
      idempotencyKey: key,
    })) as { messageId?: string; status?: string };
    childId = sent.messageId;
    if (sent.status === "suppressed") {
      finish(ctx, input.messageId, address, "gave_up");
      return { outcome: "gave_up" };
    }
  } catch (e) {
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
  if (childId) {
    ctx.db.run(
      `INSERT OR IGNORE INTO mail_delivery_child ("childId", "rootId", address) VALUES (?, ?, ?)`,
      childId,
      input.messageId,
      address,
    );
    ctx.db.run(
      `UPDATE mail_delivery_retry SET "childId" = ? WHERE "messageId" = ? AND address = ?`,
      childId,
      input.messageId,
      address,
    );
  }
  recordTrail(
    ctx,
    input.messageId,
    { kind: "retried", at: ctx.now(), address, detail: `Try ${input.attempt} of ${MAX_RETRIES}` },
    `retried|${input.messageId}|${address}|${input.attempt}`,
  );
  // 'sending' stays until the child reports: a soft bounce of the child comes back through planRetry
  ctx.db.run(
    `UPDATE mail_delivery_retry SET state = ? WHERE "messageId" = ? AND address = ? AND state = ?`,
    "waiting",
    input.messageId,
    address,
    "sending",
  );
  return { outcome: "sent", ...(childId ? { messageId: childId } : {}) };
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
