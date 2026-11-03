// One Vyre account across Spaces (rc.14): only the username, the password, GitHub sign-in and devices are universal. When this device is already signed in to a Space as someone, owning
// or joining another Space uses that account: the person types the current password, the bundle they already have opens with it, and the same person key, wraps and key pair go to the
// new Space with a fresh Space key. No new password and no new recovery code.
// rc.17: the same with no session on this device ("I already have a Vyre account": sign in at a Space you are in, or bring the account with its recovery code), and for a person who signs in
// with Google, Microsoft or GitHub, so this device never stored a username: their password (the one they set when they joined) or their recovery code opens the bundle here, on the device.
// The server never hands out a person key (ruling 62): what crosses is ciphertext, opened on this device.
import type { MadeBundle, RecoveryBundle, SealedSpaceKey, StoredBundle } from "../../../../client/src/crypto/keys.ts";
import type { StoredSession } from "../shell/session/stored.ts";

/**
 * The account this device already knows: who it is, and the Space session that can hand back its key bundle. `username` is absent when the person signed in there with a provider
 * (`provider` is then true): the username is read from that Space, and the bundle opens with the password they set when they joined, or with their recovery code.
 */
export interface KnownIdentity { username?: string; name: string; baseUrl: string; token: string; spaceId: string; spaceName: string; provider?: true }

/**
 * The account to offer for a new Space: one whose password this device has seen first (the Personal Space's, else any with a username), then one signed in with a provider. Never the Space
 * being set up or joined.
 */
export function knownIdentity(sessions: readonly StoredSession[], target: { spaceId?: string | null; baseUrl?: string | null } = {}): KnownIdentity | null {
  const usable = sessions.filter((s) => !!s.token && s.def.spaceId !== target.spaceId && s.baseUrl !== target.baseUrl);
  const named = usable.filter((s) => !!s.username);
  const pick = named.find((s) => s.def.kind === "personal") ?? named[0] ?? usable.find((s) => s.def.kind === "personal") ?? usable[0];
  if (!pick) return null;
  const base = { name: pick.displayName?.trim() || pick.username || pick.def.name, baseUrl: pick.baseUrl, token: pick.token, spaceId: pick.def.spaceId, spaceName: pick.def.name };
  return pick.username ? { username: pick.username, ...base } : { ...base, provider: true };
}

/** A recovery code as Vyre makes them: four groups of four, letters and digits (join/recovery-code.ts). Spaces and case do not matter. */
export function isRecoveryCode(value: string): boolean {
  return /^[A-Z0-9]{4}-?[A-Z0-9]{4}-?[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(value.replace(/\s+/g, "").toUpperCase());
}
export const cleanCode = (value: string): string => {
  const raw = value.replace(/[\s-]+/g, "").toUpperCase();
  return raw.length === 16 ? [raw.slice(0, 4), raw.slice(4, 8), raw.slice(8, 12), raw.slice(12)].join("-") : value.trim().toUpperCase();
};

export type CarryFailure = "password" | "unreachable" | "no_keys" | "code" | "no_code" | "either" | "signin" | "second_factor";
export class CarryError extends Error {
  readonly failure: CarryFailure;
  constructor(failure: CarryFailure, message: string) { super(message); this.name = "CarryError"; this.failure = failure; }
  /** The line a screen shows. */
  get line(): string { return this.message; }
}

export const CARRY_LINE: Readonly<Record<CarryFailure, string>> = {
  password: "That password is not right.",
  unreachable: "Couldn't reach your Space on this device. Try again, or use a different account.",
  no_keys: "This account has no keys to bring. Use a different account.",
  code: "That recovery code is not right.",
  no_code: "This account has no recovery code. Use your password.",
  either: "That password or recovery code is not right.",
  signin: "Check the username and password.",
  second_factor: "That code is not right.",
};

/** Read the username a Space knows this person by (identity.security.get): a device that signed in with a provider never stored one. */
export async function usernameAt(source: CarryDeps["source"]): Promise<string> {
  let got: { username?: unknown };
  try { got = (await source("identity.security.get", {})) as { username?: unknown }; } catch { throw new CarryError("unreachable", CARRY_LINE.unreachable); }
  if (typeof got.username !== "string" || !got.username) throw new CarryError("unreachable", CARRY_LINE.unreachable);
  return got.username;
}

export interface RecoveryCarryDeps {
  carryWithRecovery(code: string, newPassword: string, bundle: RecoveryBundle, spaceId: string): Promise<MadeBundle & { spaceKeys: SealedSpaceKey[] }>;
}
const keyOf = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

/** The bundle for the new Space, opened with the recovery code; a password the person chose now wraps the same person key there. A wrong code reads as one plain line. */
export async function carryByRecovery(deps: RecoveryCarryDeps, bundle: RecoveryBundle | undefined, code: string, newPassword: string, spaceId: string): Promise<MadeBundle & { spaceKeys: SealedSpaceKey[] }> {
  if (!bundle?.personKeyByRecovery || !bundle.publicKey || !bundle.privateKeyWrapped) throw new CarryError("no_code", CARRY_LINE.no_code);
  try { return await deps.carryWithRecovery(cleanCode(code), newPassword, bundle, spaceId); } catch (e) {
    if (keyOf(e) === "bad_secret" || keyOf(e) === "bad_blob") throw new CarryError("code", CARRY_LINE.code);
    throw e;
  }
}

/** The bundle a signed-in Space holds for this person, for a recovery-code carry. */
export async function bundleAt(source: CarryDeps["source"]): Promise<StoredBundle> {
  try {
    const keys = ((await source("identity.keys_get", {})) as { keys?: StoredBundle }).keys;
    if (!keys?.publicKey || !keys.privateKeyWrapped) throw new CarryError("no_keys", CARRY_LINE.no_keys);
    return keys;
  } catch (e) {
    if (e instanceof CarryError) throw e;
    if (keyOf(e) === "validation.not_found") throw new CarryError("no_keys", CARRY_LINE.no_keys);
    throw new CarryError("unreachable", CARRY_LINE.unreachable);
  }
}

// ---- "I already have a Vyre account" (rc.17): a device with no session for the account

type Caller = (capability: string, input: unknown) => Promise<unknown>;
/** How the Space a person is already in is reached with no session: an anonymous caller for an address, and one for a token there. */
export interface HomeDeps { anonymous(address: string): Caller; signedIn(address: string, token: string): Caller; device: { deviceName: string; deviceClass: string } }
export interface HomeOptions { name: string; password: boolean; sso: Array<{ key: string; title: string }> }

/** What a sign-in at the home Space brings back: who the person is and their bundle (ciphertext only). The session it opened is ended at once: this device keeps nothing there. */
export interface HomeAccount { username: string; name: string; bundle: StoredBundle }

export async function homeOptions(deps: HomeDeps, address: string): Promise<HomeOptions> {
  try { return (await deps.anonymous(address)("identity.sign_in_options", {})) as HomeOptions; } catch { throw new CarryError("unreachable", "Couldn't reach that Space. Check the address and try again."); }
}

/**
 * Sign in at the home Space with the username and password, read the bundle and the person's name, then sign out there. `totp` is sent when the Space asked for a second factor; the answer
 * "second_factor" asks the screen for it. Wrong details read as one line.
 */
export async function signInHome(deps: HomeDeps, address: string, username: string, password: string, totp?: string): Promise<HomeAccount | "second_factor"> {
  const name = username.trim().toLowerCase();
  let out: { status?: string; session?: { token?: string }; keys?: StoredBundle };
  try { out = (await deps.anonymous(address)("identity.sign_in", { username: name, password, ...deps.device, ...(totp ? { totp } : {}) })) as typeof out; } catch (e) {
    if (keyOf(e) === "auth.invalid_code") throw new CarryError("second_factor", CARRY_LINE.second_factor);
    if (keyOf(e)?.startsWith("auth.")) throw new CarryError("signin", CARRY_LINE.signin);
    throw new CarryError("unreachable", "Couldn't reach that Space. Check the address and try again.");
  }
  if (out.status === "second_factor_required") return "second_factor";
  const token = out.session?.token;
  if (!token) throw new CarryError("unreachable", "Couldn't reach that Space. Check the address and try again.");
  const there = deps.signedIn(address, token);
  try {
    const keys = out.keys ?? (await bundleAt(there));
    if (!keys?.personKeyByPassword || !keys.publicKey || !keys.privateKeyWrapped) throw new CarryError("no_keys", CARRY_LINE.no_keys);
    let display = name;
    try { display = ((await there("identity.whoami", {})) as { name?: string }).name?.trim() || name; } catch { /* the username stands in */ }
    return { username: name, name: display, bundle: keys };
  } finally {
    await there("identity.sign_out", {}).catch(() => undefined);
  }
}

/**
 * The recovery-only bundle for a username at the home Space (identity.recovery_fetch, no session). An unknown username gets a stand-in that no code opens, so a wrong username and a wrong
 * code read the same.
 */
export async function recoveryAtHome(deps: HomeDeps, address: string, username: string): Promise<RecoveryBundle> {
  try {
    const got = (await deps.anonymous(address)("identity.recovery_fetch", { username: username.trim().toLowerCase() })) as { keys?: RecoveryBundle };
    if (!got.keys?.personKeyByRecovery) throw new Error("none");
    return { personKeyByRecovery: got.keys.personKeyByRecovery, publicKey: got.keys.publicKey, privateKeyWrapped: got.keys.privateKeyWrapped };
  } catch (e) {
    if ((e as { status?: number } | null)?.status === 429) throw new CarryError("unreachable", "Too many tries. Wait a minute, then try again.");
    throw new CarryError("unreachable", "Couldn't reach that Space. Check the address and try again.");
  }
}

/**
 * What the screens hand the claim and the join once the person proved the account: the username and name it brings, the password the new Space signs in with (the account's own, or the
 * one chosen with the recovery code), and the bundle for the new Space, made when its id is known.
 */
export interface Carried { username: string; name: string; password: string; carry(spaceId: string): Promise<MadeBundle & { spaceKeys: SealedSpaceKey[] }>; /** proved with the account's own password, which opens it where it came from too */ viaPassword?: true }


export interface CarryDeps {
  /** A caller signed in to the Space that holds the account (the known identity's session). */
  source: (capability: string, input: unknown) => Promise<unknown>;
  carryBundle(password: string, bundle: StoredBundle, spaceId: string): Promise<MadeBundle & { spaceKeys: SealedSpaceKey[] }>;
}

/** The bundle for the new Space, opened with the current password. Throws CarryError; a wrong password reads as one plain line. The caller wipes `personKey`. */
export async function carryIdentity(deps: CarryDeps, password: string, spaceId: string): Promise<MadeBundle & { spaceKeys: SealedSpaceKey[] }> {
  let keys: StoredBundle | undefined;
  try { keys = ((await deps.source("identity.keys_get", {})) as { keys?: StoredBundle }).keys; } catch (e) {
    if ((e as { code?: string } | null)?.code === "validation.not_found") throw new CarryError("no_keys", CARRY_LINE.no_keys);
    throw new CarryError("unreachable", CARRY_LINE.unreachable);
  }
  if (!keys?.personKeyByPassword || !keys.publicKey || !keys.privateKeyWrapped) throw new CarryError("no_keys", CARRY_LINE.no_keys);
  try { return await deps.carryBundle(password, keys, spaceId); } catch (e) {
    if ((e as { code?: string } | null)?.code === "bad_secret") throw new CarryError("password", CARRY_LINE.password);
    throw e;
  }
}

/** How the person proved the account on this device: its password and the bundle it opens, or its recovery code, a password chosen now, and the recovery-only bundle. */
export type Proof =
  | { kind: "password"; username: string; name: string; password: string; bundle: StoredBundle }
  | { kind: "code"; username: string; name: string; code: string; newPassword: string; bundle: RecoveryBundle };

export interface CarryCrypto {
  carryBundle(password: string, bundle: StoredBundle, spaceId: string): Promise<MadeBundle & { spaceKeys: SealedSpaceKey[] }>;
  carryWithRecovery(code: string, newPassword: string, bundle: RecoveryBundle, spaceId: string): Promise<MadeBundle & { spaceKeys: SealedSpaceKey[] }>;
}

/** The proof as the claim and the join use it. The new Space signs in with the account's password, or with the one chosen alongside the recovery code. */
export function carriedOf(p: Proof, crypto: CarryCrypto): Carried {
  if (p.kind === "password") {
    return { username: p.username, name: p.name, password: p.password, viaPassword: true, carry: (spaceId) => carryIdentity({ source: async () => ({ keys: p.bundle }), carryBundle: crypto.carryBundle }, p.password, spaceId) };
  }
  return { username: p.username, name: p.name, password: p.newPassword, carry: (spaceId) => carryByRecovery({ carryWithRecovery: crypto.carryWithRecovery }, p.bundle, p.code, p.newPassword, spaceId) };
}

/** Check a recovery code against a recovery-only bundle before asking for a new password, so a wrong code is said at once. */
export async function checkCode(open: (code: string, bundle: RecoveryBundle) => Promise<void>, bundle: RecoveryBundle | undefined, code: string): Promise<void> {
  if (!bundle?.personKeyByRecovery) throw new CarryError("no_code", CARRY_LINE.no_code);
  try { await open(cleanCode(code), bundle); } catch (e) {
    if (keyOf(e) === "bad_secret" || keyOf(e) === "bad_blob") throw new CarryError("code", CARRY_LINE.code);
    throw e;
  }
}

/** The recovery-only part of a stored bundle (a provider-signed-in session's own keys, read with keys_get). */
export const recoveryPart = (b: StoredBundle): RecoveryBundle | undefined => b.personKeyByRecovery ? { personKeyByRecovery: b.personKeyByRecovery, publicKey: b.publicKey, privateKeyWrapped: b.privateKeyWrapped } : undefined;
