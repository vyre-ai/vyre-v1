// mail.health and mail.status_update (spec 2.18: Message status and deliverability; Contact preferences and suppression).
//
// health: the age of the last good sync per mailbox, worst state wins. A mailbox that pulls (Google, Microsoft, IMAP) is healthy while it synced
// within HEALTHY_MS, degraded up to DOWN_MS, down beyond that; a mailbox in error is at best degraded. Paused, disconnected and inbound-only
// mailboxes are left out: a pause is the owner's choice and an inbound-only mailbox has nothing to pull. A mailbox that never synced counts
// its age from when it was connected.
//
// status_update: the one place a provider status lands. The ladder runs queued, sent, delivered and ends in bounced, complained or failed;
// a status never moves a message back down the ladder, and a replayed event changes and announces nothing. Hard bounces and complaints write the
// suppression list through contacts.suppression.add before anything is stored, so a failure there leaves the event to be retried whole.
import { bad, first, isId, missing, num, readParties, rowsOf, str, strOrNull } from "../../projections.ts";
import type { MailCtx, Row } from "../../projections.ts";
import { ensureAll } from "./common.ts";

// ---- mail.health

export const HEALTHY_MS = 30 * 60_000;
export const DOWN_MS = 3 * 60 * 60_000;
type State = "healthy" | "degraded" | "down";
const RANK: Record<State, number> = { healthy: 0, degraded: 1, down: 2 };

const ago = (ms: number): string => {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 90) return `${min} minute${min === 1 ? "" : "s"}`;
  const hours = Math.round(min / 60);
  return hours < 48 ? `${hours} hours` : `${Math.round(hours / 24)} days`;
};

export async function health(ctx: MailCtx, input: { mailboxId?: string }): Promise<{ state: State; detail?: string; latencyMs?: number }> {
  ensureAll(ctx);
  if (input.mailboxId !== undefined && !isId("mbx", input.mailboxId)) bad(ctx, "Mailbox id is not valid.");
  const started = ctx.now();
  const rows = input.mailboxId
    ? rowsOf(ctx.db.all(`SELECT * FROM mail_mailbox WHERE id = ? AND deleted_at IS NULL`, input.mailboxId))
    : rowsOf(ctx.db.all(`SELECT * FROM mail_mailbox WHERE deleted_at IS NULL`));
  if (input.mailboxId && rows.length === 0) missing(ctx, "Mailbox does not exist.");
  let worst: { state: State; address: string; why: string } = { state: "healthy", address: "", why: "" };
  for (const r of rows) {
    const provider = str(r, "provider");
    const state = str(r, "state");
    if (provider === "inbound_only" || state === "paused" || state === "disconnected" || num(r, "paused") === 1) continue;
    const since = typeof r.lastSyncAt === "number" ? r.lastSyncAt : num(r, "updated_at");
    const age = Math.max(0, started - since);
    let verdict: State = age <= HEALTHY_MS ? "healthy" : age <= DOWN_MS ? "degraded" : "down";
    let why = typeof r.lastSyncAt === "number" ? `last synced ${ago(age)} ago` : `has not synced since it was connected ${ago(age)} ago`;
    if (state === "error" && verdict === "healthy") {
      verdict = "degraded";
      why = "its last sync failed";
    }
    if (RANK[verdict] > RANK[worst.state]) worst = { state: verdict, address: str(r, "address"), why };
  }
  const out: { state: State; detail?: string; latencyMs?: number } = { state: worst.state };
  if (worst.state !== "healthy") out.detail = `${worst.address} ${worst.why}. Open the mailbox, check the connection and press Sync now.`;
  out.latencyMs = Math.max(0, ctx.now() - started);
  return out;
}

// ---- mail.status_update

export interface StatusUpdateIn {
  providerId: string;
  status: "delivered" | "bounced" | "complained" | "opened" | "clicked" | "failed";
  kind?: "hard" | "soft";
  reason?: string;
  address?: string;
  url?: string;
  at: number;
}

const STATUSES = new Set(["delivered", "bounced", "complained", "opened", "clicked", "failed"]);
/** Where a status sits on the ladder; a higher number is never overwritten by a lower one. */
const LADDER: Record<string, number> = { draft: 0, queued: 1, sent: 2, delivered: 3, bounced: 4, complained: 4, failed: 4 };
const DELIVERED = 3;
const FINAL = 4;
const FALLBACK_REASON = "The provider could not send the message.";

export async function statusUpdate(ctx: MailCtx, input: StatusUpdateIn): Promise<{ messageId?: string; suppressed: boolean }> {
  ensureAll(ctx);
  if (typeof input.providerId !== "string" || input.providerId.trim().length === 0) bad(ctx, "Provider id is required.");
  if (!STATUSES.has(input.status)) bad(ctx, "Status is not supported.");
  if (input.kind !== undefined && input.kind !== "hard" && input.kind !== "soft") bad(ctx, "Bounce kind is not valid.");
  if (!Number.isSafeInteger(input.at) || input.at < 0) bad(ctx, "Time is not valid.");
  const providerId = input.providerId.trim();
  const msg = first(ctx.db.all(`SELECT * FROM mail_message WHERE "providerId" = ? AND direction = ? AND deleted_at IS NULL`, providerId, "out"));
  const messageId = msg ? str(msg, "id") : undefined;

  const key = [providerId, input.status, input.address?.trim().toLowerCase() ?? "", input.at, input.url ?? ""].join("|");
  const seen = messageId ? first(ctx.db.all(`SELECT suppressed FROM mail_status_log WHERE "eventKey" = ?`, key)) : null;
  if (messageId && seen) return { messageId, suppressed: num(seen, "suppressed") === 1 };   // a replay: already applied

  // Who the event is about: the address the provider named, else the only recipient the message had.
  const recipients = msg ? everyone(ctx, msg) : [];
  const address = (input.address?.trim().toLowerCase() || (recipients.length === 1 ? recipients[0] : undefined)) ?? undefined;
  const hardBounce = input.status === "bounced" && input.kind === "hard";
  const complaint = input.status === "complained";
  let suppressed = false;
  if ((hardBounce || complaint) && address) {
    // Suppression first and for any message we can name or not: the address must stop receiving mail even if the send record is missing.
    await ctx.call("contacts.suppression.add", {
      channel: "email", addresses: [address], reason: complaint ? "complaint" : "bounce_hard",
      source: complaint ? "mail.complaint" : "mail.bounce", ...(input.reason ? { note: input.reason } : {}),
    });
    suppressed = true;
  }
  if (!msg || !messageId) return { suppressed };   // not recorded yet or not ours: nothing stored, so a retry once the send is saved applies it

  const subject = `mail_message/${messageId}`;
  const current = str(msg, "status");
  const rank = LADDER[current] ?? 0;
  switch (input.status) {
    case "delivered":
      if (rank < DELIVERED) { setStatus(ctx, msg, "delivered"); ctx.emit("message.delivered", subject, { messageId, channel: "email" }); }
      break;
    case "bounced":
      if (rank < FINAL) {
        setStatus(ctx, msg, "bounced");
        const payload: Record<string, unknown> = { messageId, channel: "email", address: address ?? recipients[0] ?? str(msg, "fromAddress"), kind: input.kind ?? "soft" };
        if (input.reason) payload.reason = input.reason;
        ctx.emit("message.bounced", subject, payload);
      }
      break;
    case "complained":
      if (current !== "complained") {
        setStatus(ctx, msg, "complained");
        ctx.emit("message.complained", subject, { messageId, channel: "email", address: address ?? recipients[0] ?? str(msg, "fromAddress") });
      }
      break;
    case "failed":
      if (rank < FINAL) { setStatus(ctx, msg, "failed"); ctx.emit("message.failed", subject, { messageId, channel: "email", reason: input.reason || FALLBACK_REASON }); }
      break;
    case "opened":
      ctx.emit("message.opened", subject, { messageId });
      break;
    case "clicked": {
      const payload: Record<string, unknown> = { messageId };
      if (input.url) payload.url = input.url;
      ctx.emit("message.clicked", subject, payload);
      break;
    }
  }
  ctx.db.run(`INSERT OR IGNORE INTO mail_status_log ("eventKey", "messageId", suppressed, "appliedAt") VALUES (?, ?, ?, ?)`, key, messageId, suppressed ? 1 : 0, ctx.now());
  return { messageId, suppressed };
}

function setStatus(ctx: MailCtx, msg: Row, status: string): void {
  ctx.db.run(`UPDATE mail_message SET status = ?, version = ?, updated_at = ? WHERE id = ?`, status, num(msg, "version") + 1, ctx.now(), str(msg, "id"));
}

/** Every address a sent message went to: To, Cc and the Bcc kept with the body. */
function everyone(ctx: MailCtx, msg: Row): string[] {
  const body = first(ctx.db.all(`SELECT bcc FROM mail_body WHERE "messageId" = ?`, str(msg, "id")));
  const all = [...readParties(str(msg, "toAddresses")), ...readParties(str(msg, "ccAddresses")), ...readParties(strOrNull(body, "bcc") ?? "")];
  return [...new Set(all.map((p) => p.address.toLowerCase()))];
}
