// Sign-in, second factor, GitHub, pairing, sessions and the TOTP factor (spec 3.13, 2.25). Passkeys are deferred (fork F-A); SSO is reserved.
import type { Account, Device, IdentityCtx, SignInOut } from "../projections.ts";
import {
  ENROL_TTL_MS, PAIR_TTL_MS, accountById, accountByName, burnVerify, checkVerifier, issueSession, lockedFor, matchTotp, me, newChallenge,
  newTotpSecret, nid, noteFail, normCode, pairCode, putCode, raise, spendCode, USERNAME,
} from "../projections.ts";

type SpaceRow = { name: string; logo_file_id: string | null; fingerprint: string; github: number; second_factor_required: number; sso_json: string };
const ok = { ok: true } as const;

export async function signInOptions(ctx: IdentityCtx, _input: Record<string, never>) {
  const row = ctx.db.all(`SELECT name, logo_file_id, fingerprint, github, second_factor_required, sso_json FROM identity_space WHERE id = ?`, ctx.space)[0] as SpaceRow | undefined;
  if (!row) raise(ctx.trace.traceId, "validation.not_found", "this Space is not set up");
  return {
    name: row.name,
    ...(row.logo_file_id ? { logoFileId: row.logo_file_id } : {}),
    fingerprint: row.fingerprint,
    password: true,
    github: row.github === 1,
    sso: JSON.parse(row.sso_json) as { key: string; title: string }[],
    secondFactorRequired: row.second_factor_required === 1,
  };
}

export async function usernameAvailable(ctx: IdentityCtx, input: { username: string }) {
  const name = input.username.trim().toLowerCase();
  return { available: USERNAME.test(name) && !accountByName(ctx, name) };
}

/** After the first factor: a second factor is owed when the person has TOTP set. */
function afterFirstFactor(ctx: IdentityCtx, a: Account, dev: Device, method: "password" | "github"): SignInOut {
  if (a.totp_secret) return { status: "second_factor_required", challengeId: newChallenge(ctx, a.person_id, method) };
  return issueSession(ctx, a, dev, method);
}

/** Check a TOTP code and burn its step so it cannot be replayed. */
function takeTotp(ctx: IdentityCtx, a: Account, code: string): boolean {
  if (!a.totp_secret) return false;
  const step = await matchTotp(a.totp_secret, code, ctx.now(), a.totp_last_step);
  if (step === null) return false;
  const got = ctx.db.run(`UPDATE identity_accounts SET totp_last_step = ? WHERE person_id = ? AND totp_last_step < ?`, step, a.person_id, step);
  return got.changes === 1;
}

export async function signIn(ctx: IdentityCtx, input: Device & { username: string; password: string; totp?: string }): Promise<SignInOut> {
  const a = accountByName(ctx, input.username);
  const name = input.username.trim().toLowerCase();
  if (!a) {
    await burnVerify(input.password);
    noteFail(ctx, undefined, name, "bad_credentials");
    raise(ctx.trace.traceId, "auth.bad_credentials");
  }
  if (lockedFor(a, ctx.now()) > 0) {
    await burnVerify(input.password);
    noteFail(ctx, a, name, "locked");
    raise(ctx.trace.traceId, "auth.bad_credentials");
  }
  if (!(await checkVerifier(input.password, a.verifier))) {
    noteFail(ctx, a, name, "bad_credentials");
    raise(ctx.trace.traceId, "auth.bad_credentials");
  }
  if (a.totp_secret && input.totp !== undefined) {
    if (!takeTotp(ctx, a, input.totp)) {
      noteFail(ctx, a, name, "bad_code");
      raise(ctx.trace.traceId, "auth.invalid_code");
    }
    return issueSession(ctx, a, input, "password");
  }
  return afterFirstFactor(ctx, a, input, "password");
}

export async function verifySecondFactor(ctx: IdentityCtx, input: Device & { challengeId: string; code: string }): Promise<SignInOut> {
  const c = ctx.db.all(`SELECT id, person_id, method, expires_at, used_at, tries FROM identity_challenges WHERE id = ?`, input.challengeId)[0] as
    { id: string; person_id: string; method: "password" | "github"; expires_at: number; used_at: number | null; tries: number } | undefined;
  if (!c || c.used_at !== null) raise(ctx.trace.traceId, "auth.invalid_code");
  if (c.expires_at <= ctx.now()) raise(ctx.trace.traceId, "auth.expired");
  const a = accountById(ctx, c.person_id);
  if (!a) raise(ctx.trace.traceId, "auth.invalid_code");
  if (lockedFor(a, ctx.now()) > 0 || c.tries >= 5) {
    noteFail(ctx, a, a.username, "locked");
    raise(ctx.trace.traceId, "auth.invalid_code");
  }
  ctx.db.run(`UPDATE identity_challenges SET tries = ? WHERE id = ?`, c.tries + 1, c.id);
  if (!takeTotp(ctx, a, input.code)) {
    noteFail(ctx, a, a.username, "bad_code");
    raise(ctx.trace.traceId, "auth.invalid_code");
  }
  ctx.db.run(`UPDATE identity_challenges SET used_at = ? WHERE id = ?`, ctx.now(), c.id);
  return issueSession(ctx, a, input, c.method);
}

export async function githubSignIn(ctx: IdentityCtx, input: Device & { code: string }): Promise<SignInOut> {
  if (!ctx.github) raise(ctx.trace.traceId, "internal.unavailable", "GitHub sign-in is not set up for this Space");
  const space = ctx.db.all(`SELECT github FROM identity_space WHERE id = ?`, ctx.space)[0] as { github: number } | undefined;
  if (!space || space.github !== 1) raise(ctx.trace.traceId, "validation.unsupported", "GitHub sign-in is off for this Space");
  const gh = await ctx.github.resolve(input.code).catch(() => undefined);
  if (!gh) {
    noteFail(ctx, undefined, "github", "bad_credentials");
    raise(ctx.trace.traceId, "auth.invalid_code");
  }
  const a = ctx.db.all(`SELECT * FROM identity_accounts WHERE github_id = ?`, gh.id)[0] as Account | undefined;
  if (!a) {
    noteFail(ctx, undefined, gh.login, "bad_credentials");
    raise(ctx.trace.traceId, "auth.bad_credentials");
  }
  if (lockedFor(a, ctx.now()) > 0) {
    noteFail(ctx, a, a.username, "locked");
    raise(ctx.trace.traceId, "auth.bad_credentials");
  }
  return afterFirstFactor(ctx, a, input, "github");
}

export async function ssoSignIn(ctx: IdentityCtx, _input: Device & { provider: string; code: string; state: string }): Promise<SignInOut> {
  raise(ctx.trace.traceId, "validation.unsupported", "SSO sign-in is reserved until the Space has an SSO configuration");
}

export async function signOut(ctx: IdentityCtx, input: { sessionId?: string }) {
  const a = me(ctx);
  const target = input.sessionId ?? ctx.session?.id;
  if (!target) return ok;
  ctx.db.run(`UPDATE identity_sessions SET revoked_at = ? WHERE id = ? AND person_id = ? AND revoked_at IS NULL`, ctx.now(), target, a.person_id);
  return ok;
}

export async function whoami(ctx: IdentityCtx, _input: Record<string, never>) {
  const a = me(ctx);
  const dir = ctx.directory?.of(a.person_id) ?? { roles: [], groups: [] };
  return {
    principal: { kind: "person" as const, id: a.person_id },
    name: a.name,
    roles: dir.roles,
    groups: dir.groups,
    ...(ctx.session ? { deviceId: ctx.session.deviceId } : {}),
    epoch: a.epoch,
    spaceId: ctx.space,
  };
}

// ---- pairing: one stack for the app, the extension and the daemon
export async function pairCreate(ctx: IdentityCtx, input: { purpose: "app" | "extension" | "daemon" }) {
  const a = me(ctx);
  const code = pairCode();
  const expiresAt = putCode(ctx, "pair", a.person_id, normCode(code), PAIR_TTL_MS, input.purpose);
  return { code, expiresAt };
}

export async function pairRedeem(ctx: IdentityCtx, input: Device & { code: string }): Promise<SignInOut> {
  let spent: { personId: string; purpose: string | null };
  try {
    spent = spendCode(ctx, "pair", normCode(input.code));
  } catch (e) {
    noteFail(ctx, undefined, "pair", "bad_code");
    throw e;
  }
  const a = accountById(ctx, spent.personId);
  if (!a) raise(ctx.trace.traceId, "auth.invalid_code");
  // a code opens a session on a trusted device, so no second factor is asked; the code itself came from a signed-in device
  return issueSession(ctx, a, input, "pair");
}

// ---- TOTP
export async function totpBegin(ctx: IdentityCtx, _input: Record<string, never>) {
  const a = me(ctx);
  if (a.totp_secret) raise(ctx.trace.traceId, "validation.precondition_failed", "a second factor is already set");
  const secret = newTotpSecret();
  const id = nid("enr");
  ctx.db.run(`INSERT INTO identity_enrolments (id, person_id, secret, expires_at, used_at) VALUES (?, ?, ?, ?, ?)`, id, a.person_id, secret, ctx.now() + ENROL_TTL_MS, null);
  const setupUri = `otpauth://totp/Vyre:${encodeURIComponent(a.username)}?secret=${secret}&issuer=Vyre&algorithm=SHA1&digits=6&period=30`;
  return { setupUri, enrolmentId: id };
}

export async function totpConfirm(ctx: IdentityCtx, input: { enrolmentId: string; code: string }) {
  const a = me(ctx);
  const e = ctx.db.all(`SELECT id, secret, expires_at, used_at FROM identity_enrolments WHERE id = ? AND person_id = ?`, input.enrolmentId, a.person_id)[0] as
    { id: string; secret: string; expires_at: number; used_at: number | null } | undefined;
  if (!e || e.used_at !== null) raise(ctx.trace.traceId, "auth.invalid_code");
  if (e.expires_at <= ctx.now()) raise(ctx.trace.traceId, "auth.expired");
  const step = await matchTotp(e.secret, input.code, ctx.now(), 0);
  if (step === null) raise(ctx.trace.traceId, "auth.invalid_code");
  ctx.db.run(`UPDATE identity_enrolments SET used_at = ? WHERE id = ?`, ctx.now(), e.id);
  ctx.db.run(`UPDATE identity_accounts SET totp_secret = ?, totp_last_step = ? WHERE person_id = ?`, e.secret, step, a.person_id);
  ctx.emit("factor.enrolled", a.person_id, { personId: a.person_id, kind: "totp" });
  return ok;
}

export async function totpRemove(ctx: IdentityCtx, input: { password: string }) {
  const a = me(ctx);
  if (!(await checkVerifier(input.password, a.verifier))) {
    noteFail(ctx, a, a.username, "bad_credentials");
    raise(ctx.trace.traceId, "auth.bad_credentials");
  }
  const space = ctx.db.all(`SELECT second_factor_required FROM identity_space WHERE id = ?`, ctx.space)[0] as { second_factor_required: number } | undefined;
  if (space?.second_factor_required === 1) raise(ctx.trace.traceId, "validation.precondition_failed", "this Space requires a second factor");
  if (!a.totp_secret) raise(ctx.trace.traceId, "validation.precondition_failed", "no second factor is set");
  ctx.db.run(`UPDATE identity_accounts SET totp_secret = NULL, totp_last_step = 0 WHERE person_id = ?`, a.person_id);
  ctx.emit("factor.removed", a.person_id, { personId: a.person_id, kind: "totp" });
  return ok;
}

export async function passkeyRegister(ctx: IdentityCtx, _input: { attestation: unknown; name: string }): Promise<never> {
  raise(ctx.trace.traceId, "internal.not_implemented", "passkeys ship in 1.1.0 (fork F-A)");
}
export async function passkeyRemove(ctx: IdentityCtx, _input: { name: string }): Promise<never> {
  raise(ctx.trace.traceId, "internal.not_implemented", "passkeys ship in 1.1.0 (fork F-A)");
}

// ---- GitHub link
export async function githubLink(ctx: IdentityCtx, input: { code: string }) {
  const a = me(ctx);
  if (!ctx.github) raise(ctx.trace.traceId, "internal.unavailable", "GitHub is not set up for this Space");
  const gh = await ctx.github.resolve(input.code).catch(() => undefined);
  if (!gh) raise(ctx.trace.traceId, "auth.invalid_code");
  const other = ctx.db.all(`SELECT person_id FROM identity_accounts WHERE github_id = ?`, gh.id)[0] as { person_id: string } | undefined;
  if (other && other.person_id !== a.person_id) raise(ctx.trace.traceId, "validation.duplicate", "that GitHub account is linked to someone else");
  ctx.db.run(`UPDATE identity_accounts SET github_id = ?, github_login = ? WHERE person_id = ?`, gh.id, gh.login, a.person_id);
  ctx.emit("github.linked", a.person_id, { personId: a.person_id, login: gh.login });
  return { login: gh.login };
}
export async function githubUnlink(ctx: IdentityCtx, _input: Record<string, never>) {
  const a = me(ctx);
  ctx.db.run(`UPDATE identity_accounts SET github_id = NULL, github_login = NULL WHERE person_id = ?`, a.person_id);
  ctx.emit("github.unlinked", a.person_id, { personId: a.person_id });
  return ok;
}
