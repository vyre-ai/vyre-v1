// Wrapped key storage, password change, recovery and admin reset (spec 3.13, 2.25). The server holds ciphertext only: it checks that a bundle is base64 and stores it,
// it never receives a personKey and never returns a key to anyone but the signed-in person.
import type { Device, IdentityCtx, KeyBundle, SignInOut } from "../projections.ts";
import {
  MIN_SECRET, RESET_TTL_MS, USERNAME, nid, provisionAccount, randomBytes, validBundle, accountById, accountByName, bundleOf, burnVerify, checkVerifier, issueSession, lockedFor, makeVerifier, me, mustAccount, noteFail, raise,
  revokeSessions, setKeys, spendCode, putCode, clearFails, LOCK_AFTER,
} from "../projections.ts";

const ok = { ok: true } as const;
type Reason = "first_device" | "password_change" | "reset" | "recovery" | "space_key_epoch" | "new_device";

export async function keysGet(ctx: IdentityCtx, _input: Record<string, never>) {
  const a = me(ctx);
  const keys = bundleOf(a);
  if (!keys) raise(ctx.trace.traceId, "validation.not_found", "no keys are stored yet");
  return { keys };
}

export async function keysPut(ctx: IdentityCtx, input: { keys: KeyBundle; reason: Reason }) {
  const a = me(ctx);
  const have = bundleOf(a);
  if (input.reason === "first_device" && have) raise(ctx.trace.traceId, "validation.precondition_failed", "keys are already stored; use new_device or a password change");
  if (input.reason !== "first_device" && !have) raise(ctx.trace.traceId, "validation.precondition_failed", "no keys are stored yet; use first_device");
  // a Space key epoch only moves forward
  if (have && input.reason === "space_key_epoch") {
    const top = (k: KeyBundle) => k.spaceKeys.reduce((m, s) => Math.max(m, s.epoch), 0);
    if (top(input.keys) < top(have)) raise(ctx.trace.traceId, "validation.version_conflict", "the Space key epoch cannot go back");
  }
  setKeys(ctx, a.person_id, input.keys, input.reason);
  return ok;
}

function checkNewSecret(ctx: IdentityCtx, secret: string): void {
  if (secret.length < MIN_SECRET) raise(ctx.trace.traceId, "validation.bad_input", "the new password is too short");
}

export async function changePassword(ctx: IdentityCtx, input: { currentPassword: string; newPassword: string; keys: KeyBundle }) {
  const a = me(ctx);
  if (lockedFor(a, ctx.now()) > 0) raise(ctx.trace.traceId, "auth.bad_credentials");
  if (!(await checkVerifier(input.currentPassword, a.verifier))) {
    noteFail(ctx, a, a.username, "bad_credentials");
    raise(ctx.trace.traceId, "auth.bad_credentials");
  }
  checkNewSecret(ctx, input.newPassword);
  const verifier = await makeVerifier(input.newPassword);
  ctx.db.run(`UPDATE identity_accounts SET verifier = ? WHERE person_id = ?`, verifier, a.person_id);
  setKeys(ctx, a.person_id, input.keys, "password_change");
  revokeSessions(ctx, a.person_id, ctx.session?.id);
  ctx.emit("password.changed", a.person_id, { personId: a.person_id });
  return ok;
}

export async function recoverySave(ctx: IdentityCtx, input: { personKeyByRecovery: string }) {
  const a = me(ctx);
  const have = bundleOf(a);
  if (!have) raise(ctx.trace.traceId, "validation.precondition_failed", "store keys before saving a recovery code");
  setKeys(ctx, a.person_id, { ...have, personKeyByRecovery: input.personKeyByRecovery }, "password_change");
  ctx.emit("recovery.saved", a.person_id, { personId: a.person_id });
  return ok;
}

/**
 * Recovery proof: base64url(sha256(personKeyByRecovery)), which the client can recompute from the recovery code because the recovery wrap is deterministic.
 * CONTRACT-CHANGE request to the lead: a signed-out client cannot fetch the stored ciphertext to unwrap it; a pre-auth `identity.recovery_fetch` (username + proof returns the ciphertext) is needed.
 */
export async function recoveryRestore(ctx: IdentityCtx, input: Device & { username: string; recoveryProof: string; newPassword: string; keys: KeyBundle }): Promise<SignInOut> {
  const name = input.username.trim().toLowerCase();
  const a = accountByName(ctx, name);
  if (!a || !a.recovery_hash || lockedFor(a, ctx.now()) > 0) {
    await burnVerify(input.newPassword);
    noteFail(ctx, a, name, a && lockedFor(a, ctx.now()) > 0 ? "locked" : "bad_code");
    raise(ctx.trace.traceId, "auth.invalid_code");
  }
  if (input.recoveryProof !== a.recovery_hash) {
    noteFail(ctx, a, name, "bad_code");
    // the recovery code is burned after LOCK_AFTER wrong tries, whoever made them: it guards the person's keys, and a new one is saved from a signed-in device
    if (a.fails + 1 >= LOCK_AFTER) ctx.db.run(`UPDATE identity_accounts SET recovery_hash = NULL WHERE person_id = ?`, a.person_id);
    raise(ctx.trace.traceId, "auth.invalid_code");
  }
  checkNewSecret(ctx, input.newPassword);
  const verifier = await makeVerifier(input.newPassword);
  ctx.db.run(`UPDATE identity_accounts SET verifier = ? WHERE person_id = ?`, verifier, a.person_id);
  setKeys(ctx, a.person_id, input.keys, "recovery");
  revokeSessions(ctx, a.person_id);
  clearFails(ctx, a);
  ctx.emit("password.reset", a.person_id, { personId: a.person_id, by: a.person_id, recovered: true });
  return await issueSession(ctx, mustAccount(ctx, a.person_id), input, "recovery");
}

export async function resetPreview(ctx: IdentityCtx, input: { personId: string }) {
  const a = mustAccount(ctx, input.personId);
  const n = ctx.losses?.of(a.person_id) ?? { vault_mine: 0, private_chats: 0, personal_memory: 0 };
  const losses = (["vault_mine", "private_chats", "personal_memory"] as const).map((kind) => ({ kind, count: n[kind] })).filter((l) => l.count > 0);
  return { hasRecoveryCode: !!a.recovery_hash, losses };
}

export async function resetStart(ctx: IdentityCtx, input: { personId: string }) {
  const a = mustAccount(ctx, input.personId);
  const resetCode = `rst_${randomBytes(24).toString("base64url")}`;
  const expiresAt = putCode(ctx, "reset", a.person_id, resetCode, RESET_TTL_MS);
  revokeSessions(ctx, a.person_id);
  return { resetCode, expiresAt };
}

export async function resetComplete(ctx: IdentityCtx, input: Device & { resetCode: string; newPassword: string; keys: KeyBundle }): Promise<SignInOut> {
  const spent = spendCode(ctx, "reset", input.resetCode.trim());
  const a = accountById(ctx, spent.personId);
  if (!a) raise(ctx.trace.traceId, "auth.invalid_code");
  checkNewSecret(ctx, input.newPassword);
  const verifier = await makeVerifier(input.newPassword);
  // fresh keys replace the old bundle: Mine items stay sealed under the old key unless a recovery code was saved
  ctx.db.run(`UPDATE identity_accounts SET verifier = ?, keys_json = NULL, recovery_hash = NULL WHERE person_id = ?`, verifier, a.person_id);
  setKeys(ctx, a.person_id, input.keys, "reset");
  revokeSessions(ctx, a.person_id);
  clearFails(ctx, a);
  ctx.emit("password.reset", a.person_id, { personId: a.person_id, by: "admin", recovered: false });
  return await issueSession(ctx, mustAccount(ctx, a.person_id), input, "recovery");
}

/**
 * Ruling 23, pre-auth: join by invite with no account yet. Everything that can be refused is checked before the person exists
 * (code, username, password, key bundle), so a refused call leaves nothing behind and the invite stays open.
 */
export async function acceptCreateAccount(
  ctx: IdentityCtx, input: Device & { code: string; username: string; displayName?: string; password: string; keys: KeyBundle },
): Promise<SignInOut> {
  const tid = ctx.trace.traceId;
  if (!ctx.invites) raise(tid, "internal.not_implemented", "invites are not wired into this host");
  const invite = await ctx.invites.peek(input.code.trim());
  if (invite === "invalid") { await burnVerify(input.password); raise(tid, "auth.invalid_code"); }
  if (invite === "expired") raise(tid, "auth.expired");
  const username = input.username.trim().toLowerCase();
  if (!USERNAME.test(username)) raise(tid, "validation.bad_input", "username is 2 to 32 letters, digits, dot, dash or underscore");
  if (accountByName(ctx, username)) raise(tid, "validation.duplicate", "that username is taken");
  checkNewSecret(ctx, input.password);
  if (!validBundle(input.keys)) raise(tid, "validation.bad_input", "keys must be base64 ciphertext");
  const personId = nid("usr");
  await provisionAccount(ctx, { personId, username, name: input.displayName?.trim() || username, secret: input.password });
  setKeys(ctx, personId, input.keys, "first_device");
  await ctx.invites.accept(invite.inviteId, personId);
  ctx.emit("principal.created", personId, { principalId: personId, kind: "person" });
  ctx.emit("member.joined", personId, { personId, inviteId: invite.inviteId, role: invite.role, invitedBy: invite.invitedBy });
  return await issueSession(ctx, mustAccount(ctx, personId), input, "password");
}
