// portal.file_link: a short-lived link to one file for one outside account (spec 3.6 Client portal: "short-lived scoped file links"; ARCH 7.6).
// Scope: the file must be named by a field of a record the account may see (its linked record, or rows that point at it), cut by the account's row rule.
// Nothing else is reachable: a file that no visible record names is "not found" to the account, however it was guessed. Confidential and Restricted files are never linked.
// The link is a random 256-bit token; only its SHA-256 is stored, in portal_magic with the purpose `file:<fileId>`. Opening it is redeemFileLink, used by the site file route.
// @reads ../../migrations/0001_portal_accounts.sql

import type { Ctx } from "../../../../packages/contracts/src/ctx.ts";
import { newToken, sha256hex } from "../accounts.ts";
import { fail, isNull, linkedAccount, num, one, rec, reqInt, reqStr, str, visibleRecords } from "./shared.ts";

const MAX_MINUTES = 24 * 60;
const FILE_ID = /^fil_[a-z0-9_]+$/;
const PURPOSE = "file:";
/** Files labelled Confidential (2) or Restricted (3) are not given to outside accounts. */
const MAX_LABEL = 1;

function mentions(value: unknown, fileId: string, depth = 0): boolean {
  if (depth > 4) return false;
  if (value === fileId) return true;
  if (Array.isArray(value)) return value.some((v) => mentions(v, fileId, depth + 1));
  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    return o.fileId === fileId || o.id === fileId;
  }
  return false;
}

async function fileLink(ctx: Ctx, input: unknown): Promise<{ url: string; expiresAt: number }> {
  const o = rec(ctx, input);
  const acct = linkedAccount(ctx, reqStr(ctx, o, "accountId"));
  const fileId = reqStr(ctx, o, "fileId");
  if (!FILE_ID.test(fileId)) fail(ctx, "validation.bad_input", "That is not a file id.", { field: "fileId" });
  const minutes = reqInt(ctx, o, "expiresInMinutes", 1, MAX_MINUTES);

  const visible = await visibleRecords(ctx, acct);
  if (!visible.some((r) => Object.values(r.fields).some((v) => mentions(v, fileId)))) {
    fail(ctx, "permission.not_found", "That file is not available to this account.");
  }
  const got = (await ctx.call("files.get", { fileId })) as { file?: { label?: unknown; deletedAt?: unknown } };
  const file = got.file;
  if (!file || (file.deletedAt !== undefined && file.deletedAt !== null)) fail(ctx, "validation.not_found", "That file does not exist.");
  if (typeof file.label === "number" && file.label > MAX_LABEL) fail(ctx, "permission.above_clearance", "That file is too sensitive to share with an outside account.");

  const now = ctx.now();
  const expiresAt = now + minutes * 60_000;
  const token = newToken();
  // Expired file links of this account are dropped here, so the table does not grow without bound.
  for (const m of ctx.db.all("SELECT * FROM portal_magic WHERE account_id = ?", acct.id) as Record<string, unknown>[]) {
    if (str(m.purpose).startsWith(PURPOSE) && num(m.expires_at) <= now) ctx.db.run("DELETE FROM portal_magic WHERE token_hash = ?", str(m.token_hash));
  }
  ctx.db.run(
    "INSERT INTO portal_magic (token_hash, account_id, purpose, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    await sha256hex(token), acct.id, `${PURPOSE}${fileId}`, expiresAt, null, now,
  );
  return { url: `/portal/files/${token}`, expiresAt };
}

/**
 * Open a file link: returns the file and the account it was made for. Unknown, expired and wrong-purpose tokens, and links of an account that has since been
 * disabled or unlinked, are all the same refusal.
 */
export async function redeemFileLink(ctx: Ctx, token: string): Promise<{ fileId: string; accountId: string }> {
  const bad = (): never => fail(ctx, "auth.invalid_code", "This link is wrong or has expired. Ask for a new one.");
  if (token.length === 0 || token.length > 200) return bad();
  const m = one(ctx, "SELECT * FROM portal_magic WHERE token_hash = ?", await sha256hex(token));
  if (!m || !str(m.purpose).startsWith(PURPOSE) || num(m.expires_at) <= ctx.now()) return bad();
  const a = one(ctx, "SELECT * FROM portal_account WHERE id = ?", str(m.account_id));
  if (!a || a.state !== "active" || isNull(a.record_id)) return bad();
  return { fileId: str(m.purpose).slice(PURPOSE.length), accountId: str(a.id) };
}

export const fileLinkHandlers = {
  "portal.file_link": (ctx: Ctx, input: unknown) => fileLink(ctx, input),
};

