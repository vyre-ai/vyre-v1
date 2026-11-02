// Unsubscribe (spec 2.18, 2.19): the link in regular email and what it does. mail.send writes one link per recipient when a call sets `unsubscribe` (the Automations send step always does), and
// mail.unsubscribe is what /u/<token> and /p/u/<token> run (host/src/routes/unsubscribe.ts). Only the hash of a token is stored, so the table cannot be turned back into working links.
// The link names no address, and a link used twice answers the same way. The opt-out goes first: a link marked used before it took effect would say yes on the retry and leave the person subscribed.
// @reads ../migrations/0003_unsubscribe.sql
import { fail } from "../../../host/src/routes/errors.ts";
import { first, str } from "../projections.ts";
import type { MailCtx } from "../projections.ts";

/** What the host knows: the address people reach this Space at. */
export interface MailLinksHost {
  /** Public origin, for example https://harbor.vyre.run. Absent: this Space has no address outside, and no link would open. */
  publicBase?: string | undefined;
  /** The address is a phone name: the relay carries only /p/*, so the link lives there. */
  publicPath?: boolean | undefined;
}

let host: MailLinksHost | null = null;

/** The daemon calls this through hostSeams, with null at shutdown. */
export function setMailLinksHost(h: MailLinksHost | null): void {
  host = h;
}

const enc = new TextEncoder();

function randomToken(bytes = 24): string {
  let s = "";
  for (const b of globalThis.crypto.getRandomValues(new Uint8Array(bytes))) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function sha256hex(text: string): Promise<string> {
  const d = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", enc.encode(text)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A new link for one address. Null with no public address: the mail still goes, because an appointment confirmation matters more than its footer, and suppression still applies. */
export async function unsubscribeLink(ctx: MailCtx, address: string): Promise<string | null> {
  const base = (host?.publicBase ?? "").replace(/\/+$/, "");
  if (!base) {
    ctx.log.warn("mail.send: no public address, so this email carries no unsubscribe link", { traceId: ctx.trace.traceId });
    return null;
  }
  const token = randomToken();
  ctx.db.run(`INSERT INTO mail_unsub (token_hash, address, created_at, used_at) VALUES (?, ?, ?, ?)`, await sha256hex(token), address, ctx.now(), null);
  return `${base}${host?.publicPath ? "/p" : ""}/u/${token}`;
}

export const footerText = (url: string): string => `\n\nTo stop these emails: ${url}`;
export const footerHtml = (url: string): string => `<p style="font-size:12px;color:#666"><a href="${url}">Unsubscribe</a></p>`;

/** mail.unsubscribe. */
export async function unsubscribe(ctx: MailCtx, input: { token?: unknown }): Promise<{ ok: boolean }> {
  const token = typeof input.token === "string" ? input.token : "";
  const row = token ? first(ctx.db.all(`SELECT * FROM mail_unsub WHERE token_hash = ?`, await sha256hex(token))) : undefined;
  if (!row) throw fail("auth.invalid_code", ctx.trace.traceId, { message: "That link is not valid." });
  if ((row as { used_at?: unknown }).used_at != null) return { ok: true };
  const now = ctx.now();
  await ctx.call("contacts.apply_optout", { channel: "email", address: str(row, "address"), keyword: "UNSUBSCRIBE", source: "link", at: now });
  ctx.db.run(`UPDATE mail_unsub SET used_at = ? WHERE token_hash = ?`, now, str(row, "token_hash"));
  return { ok: true };
}
