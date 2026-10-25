// Identity projections (spec 3.13, 2.25, ARCH 7.13). Accounts, sessions, challenges, one-time codes and the wrapped key bundle.
// The server keeps a salted Argon2id verifier of the login secret, never the secret, and never an unwrapped key.
// Durable tables: migrations/0001_identity.sql. Handlers reach them only through ctx.db.
// Crypto comes from the kernel (argon2id, sha-256, constant-time compare) and the platform WebCrypto (random bytes, HMAC-SHA1 for TOTP); modules import no crypto themselves (B3).
import { unwrapPersonKey } from "./handlers/personkey.ts";
import { argon2id } from "../../kernel/src/identity/stretch.ts";
import { sameMac, sha256b64 } from "../../kernel/src/seal/wire.ts";
import { fail } from "../../host/src/routes/errors.ts";

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}
export interface Github { resolve(code: string): Promise<{ id: string; login: string }> }
export interface IdentityCtx {
  space: string;
  /** Absent on pre-auth calls (caller 'anonymous'). */
  principal?: { kind: string; id: string };
  /** The session the call arrived on, when there is one. */
  session?: { id?: string; deviceId: string };
  /** The device the gateway resolved the call's token to (the host's ctx.device). */
  device?: string;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: string, subject: string, payload: unknown): unknown;
  /** The host's capability call. Sign-in registers the device and its session through it (devices.register). */
  call?(name: string, input: unknown): Promise<unknown>;
  /** GitHub OAuth code exchange, built by the host from ctx.http (egress github.com). */
  github?: Github;
  /** Roles and groups of a person, read through the access projection by the host. */
  /** The person keys held in daemon memory on this node (ruling 62): hold at sign-in with the password, stage while a second factor is owed, clear at sign-out. Absent: nothing is unlocked. */
  keyring?: Keyring;
  directory?: { of(personId: string): { roles: string[]; groups: string[] } };
  /** Invites, supplied by the members module through the host: peek never spends, accept marks the invite accepted and puts the person in the Space with its role and groups. */
  invites?: { peek(code: string): Invite | "invalid" | "expired" | Promise<Invite | "invalid" | "expired">; accept(inviteId: string, personId: string): void | Promise<void> };
  /** Counts for the reset preview, supplied by the vault, chat and memory modules through the host. */
  losses?: { of(personId: string): { vault_mine: number; private_chats: number; personal_memory: number } };
}

export interface Keyring {
  hold(personId: string, key: Uint8Array): void;
  clear(personId: string): void;
  stage(challengeId: string, personId: string, key: Uint8Array): void;
  release(challengeId: string): void;
}

export interface Invite { inviteId: string; role: string; groups: string[]; invitedBy: string }

export interface Account {
  person_id: string;
  username: string;
  name: string;
  verifier: string;
  totp_secret: string | null;
  totp_last_step: number;
  github_id: string | null;
  github_login: string | null;
  keys_json: string | null;
  recovery_hash: string | null;
  fails: number;
  locked_until: number;
  epoch: number;
  created_at: number;
}
export interface KeyBundle {
  personKeyByPassword: string;
  personKeyByRecovery?: string;
  publicKey: string;
  privateKeyWrapped: string;
  spaceKeys: { epoch: number; wrapped: string }[];
}
export type Method = "password" | "github" | "sso" | "pair" | "recovery";
export type Device = { deviceName: string; deviceClass: "desktop" | "phone" | "web" | "extension" | "daemon" };
export interface SignInOut {
  status: "ok" | "second_factor_required";
  challengeId?: string;
  session?: { sessionId: string; deviceId: string; token: string; expiresAt: number; epoch: number };
  keys?: KeyBundle;
}

export const SESSION_TTL_MS = 30 * 24 * 3_600_000;
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const PAIR_TTL_MS = 10 * 60_000;
export const RESET_TTL_MS = 24 * 3_600_000;
export const ENROL_TTL_MS = 10 * 60_000;
export const LOCK_AFTER = 5;
export const MIN_SECRET = 8;
export const USERNAME = /^[a-z0-9_.-]{2,32}$/;
/** Login verifier cost: Argon2id, 19 MiB, two passes (the OWASP floor, and the kernel's own stretch parameters). */
const ARGON = { memoryKiB: 19456, passes: 2 } as const;
const PAIR_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const B64 = /^[A-Za-z0-9+/_-]+={0,2}$/;

type Code = Parameters<typeof fail>[0];
export function raise(traceId: string, code: Code, message?: string): never {
  throw fail(code, traceId, message ? { message } : {});
}

// ---- small crypto helpers
export function randomBytes(n: number): Buffer { return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n))); }
export function nid(prefix: string): string { return `${prefix}_${randomBytes(9).toString("hex")}`; }
export function sha(s: string): string { return sha256b64(s); }
export function newToken(): string { return `vst_${randomBytes(32).toString("base64url")}`; }
export function pairCode(): string {
  const b = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += PAIR_ALPHABET[b[i]! % PAIR_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
export function normCode(code: string): string { return code.trim().toUpperCase().replace(/\s+/g, ""); }

function stretch(secret: string, salt: Buffer, memoryKiB: number, passes: number): string {
  return argon2id(secret.normalize("NFKC"), salt, { memoryKiB, passes }).toString("base64url");
}
export async function makeVerifier(secret: string): Promise<string> {
  const salt = randomBytes(16);
  return `argon2id$${ARGON.memoryKiB}$${ARGON.passes}$${salt.toString("base64url")}$${stretch(secret, salt, ARGON.memoryKiB, ARGON.passes)}`;
}
export async function checkVerifier(secret: string, verifier: string): Promise<boolean> {
  const parts = verifier.split("$");
  if (parts.length !== 5 || parts[0] !== "argon2id") return false;
  const [m, t] = [Number(parts[1]), Number(parts[2])];
  if (!Number.isInteger(m) || !Number.isInteger(t) || m < 8 || t < 1) return false;
  return sameMac(stretch(secret, Buffer.from(parts[3]!, "base64url"), m, t), parts[4]!);
}
let dummy: Promise<string> | null = null;
/** Burn the same time for an unknown name as for a known one. */
export async function burnVerify(secret: string): Promise<void> {
  dummy ??= makeVerifier("vyre-dummy");
  await checkVerifier(secret, await dummy);
}

// ---- TOTP (RFC 6238, SHA-1, 6 digits, 30 s)
export function base32(b: Uint8Array): string {
  let bits = 0, val = 0, out = "";
  for (const x of b) {
    val = (val << 8) | x; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function unbase32(s: string): Buffer {
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("bad base32");
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
async function hmacSha1(key: Uint8Array, msg: Uint8Array): Promise<Buffer> {
  const k = await globalThis.crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return Buffer.from(await globalThis.crypto.subtle.sign("HMAC", k, msg as BufferSource));
}
export async function totpAt(secret: string, step: number): Promise<string> {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = await hmacSha1(unbase32(secret), msg);
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}
/** The step a code matches within one step either side of now and after `after`, or null. A step is never accepted twice. */
export async function matchTotp(secret: string, code: string, nowMs: number, after: number): Promise<number | null> {
  if (!/^[0-9]{6}$/.test(code)) return null;
  const cur = Math.floor(nowMs / 30_000);
  for (const step of [cur, cur - 1, cur + 1]) {
    if (step > after && (await totpAt(secret, step)) === code) return step;
  }
  return null;
}
export function newTotpSecret(): string { return base32(randomBytes(20)); }

// ---- key bundle
export function validBundle(k: KeyBundle): boolean {
  const ok = (s: unknown): boolean => typeof s === "string" && s.length > 0 && B64.test(s);
  return ok(k.personKeyByPassword) && ok(k.privateKeyWrapped) && ok(k.publicKey) && (k.personKeyByRecovery === undefined || ok(k.personKeyByRecovery))
    && Array.isArray(k.spaceKeys) && k.spaceKeys.every((s) => Number.isInteger(s.epoch) && s.epoch >= 0 && ok(s.wrapped));
}
export function epochOf(k: KeyBundle): number { return k.spaceKeys.reduce((m, s) => Math.max(m, s.epoch), 0); }
export function bundleOf(a: Account): KeyBundle | undefined { return a.keys_json ? (JSON.parse(a.keys_json) as KeyBundle) : undefined; }

// ---- account access
export function accountByName(ctx: IdentityCtx, username: string): Account | undefined {
  return ctx.db.all(`SELECT * FROM identity_accounts WHERE username = ?`, username.trim().toLowerCase())[0] as Account | undefined;
}
export function accountById(ctx: IdentityCtx, id: string): Account | undefined {
  return ctx.db.all(`SELECT * FROM identity_accounts WHERE person_id = ?`, id)[0] as Account | undefined;
}
export function mustAccount(ctx: IdentityCtx, id: string): Account {
  const a = accountById(ctx, id);
  if (!a) raise(ctx.trace.traceId, "validation.not_found", "no such person");
  return a;
}
/** The signed-in person's account; refuses an anonymous call. */
export function me(ctx: IdentityCtx): Account {
  if (!ctx.principal || ctx.principal.kind !== "person") raise(ctx.trace.traceId, "auth.unauthenticated");
  return mustAccount(ctx, ctx.principal.id);
}
export function setKeys(ctx: IdentityCtx, personId: string, keys: KeyBundle, reason: string): void {
  if (!validBundle(keys)) raise(ctx.trace.traceId, "validation.bad_input", "keys must be base64 ciphertext");
  const recovery = keys.personKeyByRecovery;
  ctx.db.run(`UPDATE identity_accounts SET keys_json = ?, epoch = ?, recovery_hash = ? WHERE person_id = ?`,
    JSON.stringify(keys), epochOf(keys), recovery ? sha(recovery) : null, personId);
  ctx.emit("keys.stored", personId, { personId, reason });
}

// ---- failures and lockout
export function lockedFor(a: Account, now: number): number { return a.locked_until > now ? Math.ceil((a.locked_until - now) / 1000) : 0; }
export function noteFail(ctx: IdentityCtx, a: Account | undefined, username: string, reason: "bad_credentials" | "bad_code" | "locked" | "sso_denied"): void {
  if (a && reason !== "locked") {
    const fails = a.fails + 1;
    const until = fails >= LOCK_AFTER ? ctx.now() + Math.min(15 * 60_000, 15_000 * 2 ** (fails - LOCK_AFTER)) : a.locked_until;
    ctx.db.run(`UPDATE identity_accounts SET fails = ?, locked_until = ? WHERE person_id = ?`, fails, until, a.person_id);
  }
  ctx.emit("signin.failed", username, { username, reason });
}
export function clearFails(ctx: IdentityCtx, a: Account): void {
  if (a.fails > 0 || a.locked_until > 0) ctx.db.run(`UPDATE identity_accounts SET fails = 0, locked_until = 0 WHERE person_id = ?`, a.person_id);
}

// ---- sessions
/**
 * The two halves of a session that live in the host: the gateway resolves a bearer token through the host's own token table to a devices_session row, so a token only works when it is minted
 * there for a session the devices module holds. `mint` creates that token for a devices session id; `end` stops the session at the gateway (devices_session.revoked_at). The host calls
 * configureSessionTokens once at boot. Without it sign-in refuses: a token nothing honors would sign a person in to an app that gets 401 on every call (P-SEC_05).
 */
export interface SessionTokens { mint(sessionId: string): string; end(sessionId: string): void }
let sessionTokens: SessionTokens | null = null;
export function configureSessionTokens(t: SessionTokens | null): void { sessionTokens = t; }

/** Open a per-device session: devices.register makes the device and its session, the host mints the token for that session, and identity keeps the row that sign-out and reset act on. */
export async function issueSession(ctx: IdentityCtx, a: Account, dev: Device, method: Method): Promise<SignInOut> {
  const tid = ctx.trace.traceId;
  if (!sessionTokens || typeof ctx.call !== "function") raise(tid, "internal.unavailable", "Sign-in cannot open a device session on this server yet.");
  const reg = (await ctx.call("devices.register", { person: a.person_id, name: dev.deviceName, class: dev.deviceClass })) as { device?: { id?: unknown }; sessionId?: unknown };
  const deviceId = typeof reg?.device?.id === "string" ? reg.device.id : "";
  const sessionId = typeof reg?.sessionId === "string" ? reg.sessionId : "";
  if (!deviceId || !sessionId) raise(tid, "internal.unexpected", "The device could not be registered.");
  clearFails(ctx, a);
  const now = ctx.now();
  const token = sessionTokens.mint(sessionId);
  const expiresAt = now + SESSION_TTL_MS;
  ctx.db.run(
    `INSERT INTO identity_sessions (id, person_id, device_id, device_name, device_class, token_hash, method, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sessionId, a.person_id, deviceId, dev.deviceName, dev.deviceClass, sha(token), method, now, expiresAt, null);
  ctx.emit("signin.succeeded", a.person_id, { personId: a.person_id, method, deviceId });
  const keys = bundleOf(a);
  return { status: "ok", session: { sessionId, deviceId, token, expiresAt, epoch: a.epoch }, ...(keys ? { keys } : {}) };
}
/** The caller's own session: the one the call names, else the live session of the device the gateway resolved the token to. */
export function currentSessionId(ctx: IdentityCtx, personId: string): string | undefined {
  if (ctx.session?.id) return ctx.session.id;
  if (!ctx.device) return undefined;
  const r = ctx.db.all(`SELECT id FROM identity_sessions WHERE device_id = ? AND person_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`, ctx.device, personId)[0] as { id: string } | undefined;
  return r?.id;
}
/** End one session here and at the gateway. */
export function endSessionRow(ctx: IdentityCtx, personId: string, sessionId: string): void {
  const got = ctx.db.run(`UPDATE identity_sessions SET revoked_at = ? WHERE id = ? AND person_id = ? AND revoked_at IS NULL`, ctx.now(), sessionId, personId);
  if (got.changes > 0) sessionTokens?.end(sessionId);
}
/** Revoke every live session of a person, except one when given, here and at the gateway. A password change or reset also takes their key out of memory. */
export function revokeSessions(ctx: IdentityCtx, personId: string, except?: string): void {
  ctx.keyring?.clear(personId);
  const live = ctx.db.all(`SELECT id FROM identity_sessions WHERE person_id = ? AND revoked_at IS NULL AND id != ?`, personId, except ?? "") as { id: string }[];
  ctx.db.run(`UPDATE identity_sessions SET revoked_at = ? WHERE person_id = ? AND revoked_at IS NULL AND id != ?`, ctx.now(), personId, except ?? "");
  for (const r of live) sessionTokens?.end(r.id);
}
/** Resolve a bearer token to its live session; the host gateway calls this to build the principal. */
export function sessionOfToken(ctx: IdentityCtx, token: string): { sessionId: string; personId: string; deviceId: string } | undefined {
  const r = ctx.db.all(`SELECT id, person_id, device_id, expires_at, revoked_at FROM identity_sessions WHERE token_hash = ?`, sha(token))[0] as
    { id: string; person_id: string; device_id: string; expires_at: number; revoked_at: number | null } | undefined;
  if (!r || r.revoked_at !== null || r.expires_at <= ctx.now()) return undefined;
  return { sessionId: r.id, personId: r.person_id, deviceId: r.device_id };
}

// ---- one-time codes (pair, reset)
export function putCode(ctx: IdentityCtx, kind: "pair" | "reset", personId: string, code: string, ttl: number, purpose?: string): number {
  const expiresAt = ctx.now() + ttl;
  ctx.db.run(`INSERT INTO identity_codes (code_hash, kind, person_id, purpose, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?)`,
    sha(`${kind}:${code}`), kind, personId, purpose ?? null, expiresAt, null);
  return expiresAt;
}
/** Spend a code once. Unknown, spent and expired codes all read the same to the caller except expired. */
export function spendCode(ctx: IdentityCtx, kind: "pair" | "reset", code: string): { personId: string; purpose: string | null } {
  const h = sha(`${kind}:${code}`);
  const r = ctx.db.all(`SELECT person_id, purpose, expires_at, used_at FROM identity_codes WHERE code_hash = ?`, h)[0] as
    { person_id: string; purpose: string | null; expires_at: number; used_at: number | null } | undefined;
  if (!r || r.used_at !== null) raise(ctx.trace.traceId, "auth.invalid_code");
  if (r.expires_at <= ctx.now()) raise(ctx.trace.traceId, "auth.expired");
  const got = ctx.db.run(`UPDATE identity_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL`, ctx.now(), h);
  if (got.changes !== 1) raise(ctx.trace.traceId, "auth.invalid_code");
  return { personId: r.person_id, purpose: r.purpose };
}

// ---- challenges for the second factor
export function newChallenge(ctx: IdentityCtx, personId: string, method: Method): string {
  const id = nid("chl");
  ctx.db.run(`INSERT INTO identity_challenges (id, person_id, method, expires_at, used_at, tries) VALUES (?, ?, ?, ?, ?, ?)`, id, personId, method, ctx.now() + CHALLENGE_TTL_MS, null, 0);
  return id;
}

/** Create an account. The members module's invite accept reaches this through the host (identity.pair_redeem on an invite) and tests seed through it. */
export async function provisionAccount(ctx: IdentityCtx, p: { personId: string; username: string; name: string; secret: string }): Promise<Account> {
  if (!USERNAME.test(p.username)) raise(ctx.trace.traceId, "validation.bad_input", "username is 2 to 32 letters, digits, dot, dash or underscore");
  if (p.secret.length < MIN_SECRET) raise(ctx.trace.traceId, "validation.bad_input", "password is too short");
  if (accountByName(ctx, p.username)) raise(ctx.trace.traceId, "validation.duplicate", "that username is taken");
  const verifier = await makeVerifier(p.secret);
  ctx.db.run(
    `INSERT INTO identity_accounts (person_id, username, name, verifier, totp_secret, totp_last_step, github_id, github_login, keys_json, recovery_hash, fails, locked_until, epoch, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    p.personId, p.username, p.name, verifier, null, 0, null, null, null, null, 0, 0, 0, ctx.now());
  return mustAccount(ctx, p.personId);
}

/** The person key the password opens from their stored bundle, or null. */
export function personKeyOf(a: Account, password: string): Uint8Array | null {
  const keys = bundleOf(a);
  return keys ? unwrapPersonKey(password, a.person_id, keys.personKeyByPassword) : null;
}
