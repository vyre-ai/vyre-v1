// Ruling 71: the first owner of a fresh Space claims it once. The host makes the Space and the owner's principal at first start (host/src/daemon/bootstrap.ts) and hands out a
// one-time claim link; the owner's client opens it, the person picks a username and password, the client builds the key bundle (the server never sees the personKey, ruling 63),
// and this capability turns the waiting owner principal into a signed-in person. The code is stored hashed, works once and lasts 24 hours.
import type { Device, IdentityCtx, KeyBundle, SignInOut } from "../projections.ts";
import {
  MIN_SECRET, RESET_TTL_MS, USERNAME, accountById, accountByName, burnVerify, issueSession, mustAccount, provisionAccount, putCode, raise, randomBytes, setKeys, sha, spendCode, validBundle,
} from "../projections.ts";

/** Anonymous caller. Everything that can be refused is checked before the code is spent, so a mistyped username leaves the link usable. */
export async function claimOwner(
  ctx: IdentityCtx, input: Device & { code: string; spaceId: string; username: string; displayName?: string; password: string; keys: KeyBundle },
): Promise<SignInOut> {
  const tid = ctx.trace.traceId;
  const code = input.code.trim();
  const row = ctx.db.all(`SELECT person_id, expires_at, used_at FROM identity_codes WHERE code_hash = ?`, sha(`claim:${code}`))[0] as { person_id: string; expires_at: number; used_at: number | null } | undefined;
  if (!row || row.used_at !== null) { await burnVerify(input.password); raise(tid, "auth.invalid_code"); }
  if (row.expires_at <= ctx.now()) raise(tid, "auth.expired");
  if (input.spaceId !== ctx.space) raise(tid, "validation.bad_input", "that link is for a different Space");
  const username = input.username.trim().toLowerCase();
  if (!USERNAME.test(username)) raise(tid, "validation.bad_input", "username is 2 to 32 letters, digits, dot, dash or underscore");
  if (accountByName(ctx, username)) raise(tid, "validation.duplicate", "that username is taken");
  if (input.password.length < MIN_SECRET) raise(tid, "validation.bad_input", "password is too short");
  if (!validBundle(input.keys)) raise(tid, "validation.bad_input", "keys must be base64 ciphertext");
  if (accountById(ctx, row.person_id)) raise(tid, "auth.invalid_code");
  const personId = spendCode(ctx, "claim", code).personId;
  await provisionAccount(ctx, { personId, username, name: input.displayName?.trim() || username, secret: input.password });
  ctx.emit("principal.created",personId,{principalId:personId,kind:"person",name:input.displayName?.trim()||username});
  setKeys(ctx, personId, input.keys, "first_device");
  return await issueSession(ctx, mustAccount(ctx, personId), input, "password", { joining: true });
}

/**
 * Host call at every start: a fresh claim link for the owner who has not claimed yet, none once they have. An older unused link stops working, so the link on the console is the only one.
 * Answers null when the owner already has an account.
 */
export function claimIssue(ctx: IdentityCtx, input: { personId: string }): { code: string; expiresAt: number } | null {
  if (accountById(ctx, input.personId)) return null;
  ctx.db.run(`UPDATE identity_codes SET used_at = ? WHERE kind = ? AND used_at IS NULL`, ctx.now(), "claim");
  const code = `clm_${randomBytes(24).toString("base64url")}`;
  return { code, expiresAt: putCode(ctx, "claim", input.personId, code, RESET_TTL_MS) };
}
