// portal.peek: what an invitation or sign-in link points at, read without using the link up (spec 3.6 Client portal). The host's landing page for /portal/<site>/link/<token> calls it to
// decide between a page and a 404, and to say who the link is for and what is shared with them. It changes nothing: signing in (portal.sign_in) is what spends the token.
// Unknown, used, expired, wrong-site and disabled-account links are all the same answer, null, so a landing page cannot be used to learn which tokens or accounts exist.
// @reads ../../migrations/0001_portal_accounts.sql

import { sha256hex } from "../accounts.ts";

export interface PeekDb { all(sql: string, ...args: unknown[]): unknown[] }

export interface PeekedLink {
  accountId: string;
  siteId: string;
  email: string;
  method: "magic_link" | "password";
  state: "invited" | "active";
  purpose: "invite" | "sign_in" | "reset";
  expiresAt: number;
  shared: {
    /** the account is linked to a record */
    linked: boolean;
    /** the record types its row rules let it see */
    recordTypes: string[];
    /** file links made for it that have not expired */
    fileLinks: number;
  };
}

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const PURPOSES = new Set(["invite", "sign_in", "reset"]);

export async function peekLink(ctx: { db: PeekDb }, now: number, siteId: string, token: string): Promise<PeekedLink | null> {
  if (token.length === 0 || token.length > 200 || siteId.length === 0 || siteId.length > 100) return null;
  const m = (ctx.db.all("SELECT * FROM portal_magic WHERE token_hash = ?", await sha256hex(token)) as Row[])[0];
  if (!m || !PURPOSES.has(str(m["purpose"])) || m["used_at"] !== null && m["used_at"] !== undefined || num(m["expires_at"]) <= now) return null;
  const a = (ctx.db.all("SELECT * FROM portal_account WHERE id = ?", str(m["account_id"])) as Row[])[0];
  if (!a || str(a["site_id"]) !== siteId || (a["state"] !== "invited" && a["state"] !== "active")) return null;
  const rules = ctx.db.all("SELECT record_type FROM portal_link WHERE account_id = ? ORDER BY record_type", str(a["id"])) as Row[];
  const files = (ctx.db.all("SELECT purpose, expires_at FROM portal_magic WHERE account_id = ?", str(a["id"])) as Row[]).filter((r) => str(r["purpose"]).startsWith("file:") && num(r["expires_at"]) > now);
  return {
    accountId: str(a["id"]), siteId, email: str(a["email"]), method: a["method"] === "password" ? "password" : "magic_link", state: a["state"] === "active" ? "active" : "invited",
    purpose: str(m["purpose"]) as PeekedLink["purpose"], expiresAt: num(m["expires_at"]),
    shared: { linked: a["record_id"] !== null && a["record_id"] !== undefined, recordTypes: rules.map((r) => str(r["record_type"])), fileLinks: files.length },
  };
}
