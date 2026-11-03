// The carry sign-in (rc.17, lead ruling 3 Nov): "I already have a Vyre account" on another Space's web page signs in here from a foreign https origin. That page could hand a session to its own
// server, so a sign-in from a foreign origin never makes a session. It makes a carry token instead:
//   - scoped to three things: identity.keys_get (once), identity.whoami and identity.sign_out; everything else refuses it (host/src/routes/carry-door.ts);
//   - bound to the Origin that asked, and good for 5 minutes;
//   - recorded as "Signed in from <origin> to bring the account to another Space", which the person sees in Settings > Sign-in (identity.security.get `carried`), and an audit row.
// The checks before it are sign-in's own: lockout, the verifier, the second factor, membership and the Space's sign-in policy. The host reaches this only as its own top-level host call.
import { assertSignInPolicy } from "../policy.ts";
import type { Account, IdentityCtx } from "../projections.ts";
import { accountById, accountByName, bundleOf, burnVerify, checkVerifier, clearFails, lockedFor, matchTotp, noteFail, randomBytes, sha } from "../projections.ts";

export const CARRY_TTL_MS = 5 * 60_000;
export const CARRY_PREFIX = "vct_";
export type CarryOp = "keys_get" | "whoami" | "sign_out";
export type CarryRefusal = { refused: "bad_credentials" | "second_factor_required" | "invalid_code" | "unavailable" };

function table(ctx: IdentityCtx): void {
  ctx.db.run(`CREATE TABLE IF NOT EXISTS identity_carry (token_hash TEXT PRIMARY KEY, person_id TEXT NOT NULL, origin TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, keys_used_at INTEGER, ended_at INTEGER)`);
}

/** Recent carry sign-ins of a person, newest first, for their Security list. */
export function carriedFor(ctx: IdentityCtx, personId: string, limit = 10): Array<{ origin: string; at: number }> {
  try {
    table(ctx);
    return (ctx.db.all(`SELECT origin, created_at FROM identity_carry WHERE person_id = ? ORDER BY created_at DESC LIMIT ?`, personId, limit) as Array<{ origin: string; created_at: number }>).map((r) => ({ origin: r.origin, at: r.created_at }));
  } catch { return []; }
}

async function takeTotp(ctx: IdentityCtx, a: Account, code: string): Promise<boolean> {
  if (!a.totp_secret) return false;
  const step = await matchTotp(a.totp_secret, code, ctx.now(), a.totp_last_step);
  if (step === null) return false;
  return ctx.db.run(`UPDATE identity_accounts SET totp_last_step = ? WHERE person_id = ? AND totp_last_step < ?`, step, a.person_id, step).changes === 1;
}

/** A sign-in from a foreign origin: the same checks as identity.sign_in, and a carry token in place of a session. */
export async function carrySignIn(ctx: IdentityCtx, input: { username: string; password: string; totp?: string; origin: string }): Promise<{ token: string; expiresAt: number } | CarryRefusal> {
  const name = String(input.username ?? "").trim().toLowerCase();
  const a = accountByName(ctx, name);
  if (!a) { await burnVerify(String(input.password ?? "")); noteFail(ctx, undefined, name, "bad_credentials"); return { refused: "bad_credentials" }; }
  if (lockedFor(a, ctx.now()) > 0) { await burnVerify(String(input.password ?? "")); noteFail(ctx, a, name, "locked"); return { refused: "bad_credentials" }; }
  if (!(await checkVerifier(String(input.password ?? ""), a.verifier))) { noteFail(ctx, a, name, "bad_credentials"); return { refused: "bad_credentials" }; }
  try { assertSignInPolicy(ctx, a, "password"); } catch { return { refused: "bad_credentials" }; }
  if (a.totp_secret) {
    if (input.totp === undefined) return { refused: "second_factor_required" };
    if (!(await takeTotp(ctx, a, input.totp))) { noteFail(ctx, a, name, "bad_code"); return { refused: "invalid_code" }; }
  }
  const member = ctx.membership?.check(a.person_id);
  if (member === "unavailable") return { refused: "unavailable" };
  if (member === "refused") return { refused: "bad_credentials" };
  clearFails(ctx, a);
  table(ctx);
  const token = `${CARRY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const expiresAt = ctx.now() + CARRY_TTL_MS;
  ctx.db.run(`INSERT INTO identity_carry (token_hash, person_id, origin, created_at, expires_at, keys_used_at, ended_at) VALUES (?, ?, ?, ?, ?, NULL, NULL)`, sha(token), a.person_id, input.origin, ctx.now(), expiresAt);
  await ctx.call?.("audit.append", { action: "identity.carry_sign_in", class: "sign_in", onBehalfOf: { kind: "person", id: a.person_id }, detail: { origin: input.origin, line: `Signed in from ${input.origin} to bring the account to another Space` } })?.catch(() => undefined);
  return { token, expiresAt };
}

/**
 * One use of a carry token: keys_get (once), whoami or sign_out, from the Origin it was made for. Anything else, an unknown, ended or expired token, or another Origin, is null: the host
 * answers 401 and nothing is said about which.
 */
export function carryUse(ctx: IdentityCtx, input: { token: string; origin: string; op: CarryOp }): unknown {
  if (typeof input.token !== "string" || !input.token.startsWith(CARRY_PREFIX) || !["keys_get", "whoami", "sign_out"].includes(input.op)) return null;
  table(ctx);
  const h = sha(input.token);
  const row = (ctx.db.all(`SELECT person_id, origin, expires_at, keys_used_at, ended_at FROM identity_carry WHERE token_hash = ?`, h) as Array<{ person_id: string; origin: string; expires_at: number; keys_used_at: number | null; ended_at: number | null }>)[0];
  if (!row || row.ended_at !== null || row.expires_at <= ctx.now() || row.origin !== input.origin) return null;
  const a = accountById(ctx, row.person_id);
  if (!a || ctx.membership?.check(a.person_id) === "refused") return null;
  if (input.op === "sign_out") { ctx.db.run(`UPDATE identity_carry SET ended_at = ? WHERE token_hash = ?`, ctx.now(), h); return { ok: true }; }
  if (input.op === "whoami") return { principal: { kind: "person", id: a.person_id }, name: a.name, spaceId: ctx.space };
  if (row.keys_used_at !== null) return null;
  const keys = bundleOf(a);
  if (!keys) return null;
  if (ctx.db.run(`UPDATE identity_carry SET keys_used_at = ? WHERE token_hash = ? AND keys_used_at IS NULL`, ctx.now(), h).changes !== 1) return null;
  return { keys };
}
