// Watching inboxes (lane r42-email-in): machine-made mail is recognised so nothing answers it automatically, failures on the way in are kept, and
// mail.inbox.monitor says per inbox when it last received, how it is fed, and what failed with the one thing to do about it.
//
// Auto mail: an auto-reply, a delivery report, a mailing list or a no-reply sender. It is stored and shown like any mail; it carries `auto` on the
// mail.received event and a row in mail_inbound_ext, and mail.send refuses an automatic reply to it (see autoReplyGuard).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bad, can, first, isId, missing, newId, num, rowsOf, statements, str, strOrNull } from "../../projections.ts";
import type { MailCtx, Row } from "../../projections.ts";
import { ensureAll } from "./common.ts";
import { DOWN_MS, HEALTHY_MS } from "./status.ts";

const SQL = readFileSync(fileURLToPath(new URL("../../migrations/0012_inbound_watch.sql", import.meta.url)), "utf8");
const ready = new WeakSet<object>();

export function ensureInbound(ctx: Pick<MailCtx, "db">): void {
  ensureAll(ctx);
  if (ready.has(ctx.db)) return;
  try {
    ctx.db.all(`SELECT "messageId" FROM mail_inbound_ext WHERE "messageId" = ?`, "probe");
    ctx.db.all(`SELECT id FROM mail_inbound_problem WHERE id = ?`, "probe");
  } catch {
    for (const statement of statements(SQL)) ctx.db.run(statement);
  }
  ready.add(ctx.db);
}

// ---- machine-made mail

const NOREPLY = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce[sd]?|notifications?)([+._-].*)?$/i;

/** Why a message looks machine-made, in plain words, or null for mail from a person. Header names are lower case. */
export function autoReason(headers: Record<string, string> | undefined, fromAddress: string): string | null {
  const h = headers ?? {};
  const submitted = h["auto-submitted"]?.trim().toLowerCase();
  if (submitted && submitted !== "no") return "an automatic reply";
  if (h["x-auto-response-suppress"] !== undefined || h["x-autoreply"] !== undefined || h["x-autorespond"] !== undefined)
    return "an automatic reply";
  const precedence = h["precedence"]?.trim().toLowerCase();
  if (precedence && ["bulk", "junk", "list", "auto_reply"].includes(precedence)) return "bulk mail";
  if (h["list-id"] !== undefined || h["list-unsubscribe"] !== undefined) return "a mailing list";
  if (/multipart\/report/i.test(h["content-type"] ?? "")) return "a delivery report";
  const local = fromAddress.split("@")[0] ?? "";
  if (NOREPLY.test(local)) return "a sender that does not read replies";
  return null;
}

/** Remember that a received message is machine-made. Safe to call twice. */
export function noteAuto(ctx: MailCtx, messageId: string, reason: string): void {
  ensureInbound(ctx);
  ctx.db.run(`INSERT OR IGNORE INTO mail_inbound_ext ("messageId", auto, why) VALUES (?, ?, ?)`, messageId, 1, reason);
}

export function autoOf(ctx: MailCtx, messageId: string): string | null {
  ensureInbound(ctx);
  const row = first(ctx.db.all(`SELECT auto, why FROM mail_inbound_ext WHERE "messageId" = ?`, messageId));
  return row && num(row, "auto") === 1 ? (strOrNull(row, "why") ?? "machine-made") : null;
}

/**
 * Refuse an automatic reply to machine-made mail. A person replying by hand is never stopped; an Automation or an agent replying to a message that is
 * an auto-reply, a delivery report, a list or a no-reply sender is. The refusal says why.
 */
export function autoReplyGuard(ctx: MailCtx, replyToMessageId: string | undefined, actor: "person" | "agent" | "automation"): string | null {
  if (actor === "person" || !replyToMessageId) return null;
  const why = autoOf(ctx, replyToMessageId);
  return why ? `Not sent. That message is ${why}; an automatic reply to it could start a loop.` : null;
}

// ---- what went wrong on the way in

export function recordProblem(ctx: MailCtx, p: { mailboxId?: string; address?: string; kind: string; reason: string }): void {
  ensureInbound(ctx);
  const last = rowsOf(ctx.db.all(`SELECT * FROM mail_inbound_problem WHERE kind = ?`, p.kind)).find(
    (r) => (strOrNull(r, "mailboxId") ?? undefined) === p.mailboxId && str(r, "reason") === p.reason,
  );
  // the same trouble over and over is one line that moves forward in time, not a growing list
  if (last) {
    ctx.db.run(`UPDATE mail_inbound_problem SET at = ?, address = ? WHERE id = ?`, ctx.now(), p.address ?? null, str(last, "id"));
    return;
  }
  ctx.db.run(
    `INSERT INTO mail_inbound_problem (id, "mailboxId", address, kind, reason, at) VALUES (?, ?, ?, ?, ?, ?)`,
    newId("ibp", ctx.now()),
    p.mailboxId ?? null,
    p.address ?? null,
    p.kind,
    p.reason,
    ctx.now(),
  );
}

/** Run mail.ingest and keep what went wrong: mail for an address no inbox answers to is a problem to show, not only an error to the provider. */
export async function ingestWatched<T>(ctx: MailCtx, input: { envelopeTo?: string; mailboxId?: string }, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const code = (e as { code?: string; error?: { code?: string } } | null)?.error?.code ?? (e as { code?: string } | null)?.code;
    if (code === "validation.not_found" && input.envelopeTo && !input.mailboxId)
      recordProblem(ctx, {
        address: input.envelopeTo,
        kind: "no_inbox",
        reason: `Mail arrived for ${input.envelopeTo} and no inbox answers to that address.`,
      });
    throw e;
  }
}

/** Run a sync and keep why it failed: the failure reason travels only as an event, so it is caught as it is emitted. */
export async function syncWatched<T>(ctx: MailCtx, run: (watched: MailCtx) => Promise<T>): Promise<T> {
  const watched: MailCtx = Object.create(ctx, {
    emit: {
      value(name: string, subject: string, payload: unknown, opts?: Parameters<MailCtx["emit"]>[3]) {
        if (name === "mailbox.sync_failed") {
          const p = payload as { mailboxId?: string; reason?: string };
          if (typeof p.mailboxId === "string" && typeof p.reason === "string")
            recordProblem(ctx, { mailboxId: p.mailboxId, kind: "sync", reason: p.reason });
        }
        return ctx.emit(name, subject, payload, opts);
      },
    },
  });
  return run(watched);
}

// ---- mail.inbox.monitor

export interface MonitorRow {
  mailboxId: string;
  address: string;
  kind: "personal" | "shared" | "agent" | "service";
  how: "imap" | "google" | "microsoft" | "provider_webhook";
  state: "ok" | "late" | "failing" | "paused";
  lastReceivedAt?: number;
  lastSyncAt?: number;
  receivedToday: number;
  problem?: { reason: string; fix: string; at: number };
}

const DAY = 86_400_000;

function fixFor(kind: string, reason: string): string {
  if (kind === "no_inbox") return "Add an inbox for that address, or point the route at an inbox you already have.";
  if (/sign-?in|reconnect/i.test(reason)) return "Open the mailbox and reconnect it.";
  return "Open the mailbox and press Sync now. If it fails again, check the connection.";
}

export async function monitor(ctx: MailCtx, input: { mailboxId?: string }): Promise<{ inboxes: MonitorRow[]; unrouted: { address: string; reason: string; fix: string; at: number }[] }> {
  ensureInbound(ctx);
  if (input.mailboxId !== undefined && !isId("mbx", input.mailboxId)) bad(ctx, "Mailbox id is not valid.");
  const rows = input.mailboxId
    ? rowsOf(ctx.db.all(`SELECT * FROM mail_mailbox WHERE id = ? AND deleted_at IS NULL`, input.mailboxId))
    : rowsOf(ctx.db.all(`SELECT * FROM mail_mailbox WHERE deleted_at IS NULL`));
  if (input.mailboxId && rows.length === 0) return missing(ctx, "Mailbox does not exist.");
  const now = ctx.now();
  const out: MonitorRow[] = [];
  for (const r of rows) {
    const id = str(r, "id");
    // an inbox the caller may not see is left out, and asking for it by id answers as if it were not there
    if (!can(ctx, "view", { type: "mailbox", id })) {
      if (input.mailboxId) return missing(ctx, "Mailbox does not exist.");
      continue;
    }
    const provider = str(r, "provider");
    const how: MonitorRow["how"] = provider === "imap" ? "imap" : provider === "google" ? "google" : provider === "microsoft" ? "microsoft" : "provider_webhook";
    const received = rowsOf(ctx.db.all(`SELECT "sentAt" FROM mail_message WHERE direction = ? AND deleted_at IS NULL AND "mailboxId" = ?`, "in", id)).map((m) => num(m, "sentAt"));
    const last = received.length ? Math.max(...received) : undefined;
    const lastSync = typeof r.lastSyncAt === "number" ? r.lastSyncAt : undefined;
    const problemRow = rowsOf(ctx.db.all(`SELECT * FROM mail_inbound_problem WHERE "mailboxId" = ?`, id)).sort((a, b) => num(b, "at") - num(a, "at"))[0];
    // a problem counts until something good happened after it
    const goodAt = Math.max(lastSync ?? 0, last ?? 0);
    const live = problemRow && num(problemRow, "at") > goodAt && now - num(problemRow, "at") < DAY * 3 ? problemRow : undefined;
    let state: MonitorRow["state"] = "ok";
    if (num(r, "paused") === 1 || str(r, "state") === "paused") state = "paused";
    else if (live || str(r, "state") === "error") state = "failing";
    else if (how !== "provider_webhook" && now - (lastSync ?? num(r, "updated_at")) > HEALTHY_MS) state = now - (lastSync ?? num(r, "updated_at")) > DOWN_MS ? "failing" : "late";
    const row: MonitorRow = {
      mailboxId: id,
      address: str(r, "address"),
      kind: str(r, "kind") as MonitorRow["kind"],
      how,
      state,
      receivedToday: received.filter((t) => now - t < DAY).length,
    };
    if (last !== undefined) row.lastReceivedAt = last;
    if (lastSync !== undefined) row.lastSyncAt = lastSync;
    if (live) row.problem = { reason: str(live, "reason"), fix: fixFor(str(live, "kind"), str(live, "reason")), at: num(live, "at") };
    else if (state === "failing")
      row.problem = { reason: "The mailbox has not synced for hours.", fix: fixFor("sync", ""), at: lastSync ?? num(r, "updated_at") };
    out.push(row);
  }
  const unrouted = input.mailboxId
    ? []
    : rowsOf(ctx.db.all(`SELECT * FROM mail_inbound_problem WHERE kind = ?`, "no_inbox"))
        .filter((p) => now - num(p, "at") < DAY * 3)
        .sort((a, b) => num(b, "at") - num(a, "at"))
        .slice(0, 20)
        .map((p) => ({ address: str(p, "address"), reason: str(p, "reason"), fix: fixFor("no_inbox", ""), at: num(p, "at") }));
  return { inboxes: out, unrouted };
}
