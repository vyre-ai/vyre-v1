import { loadCryptoKeys } from "../../../../../client/src/crypto/load.ts";
import type { Options } from "../../../../../client/src/crypto/keys.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

/** Rewrap the same person key locally; never replace private data keys during a password change. */
export async function changeOwnPassword(call: Call, currentPassword: string, newPassword: string): Promise<void> {
  const out = await call("identity.keys_get", {}) as { keys: { personKeyByPassword: string; personKeyByRecovery?: string; publicKey: string; privateKeyWrapped: string; spaceKeys: unknown[] } };
  const { rewrap } = await loadCryptoKeys();
  const wrapped = await rewrap(currentPassword, newPassword, { ...out.keys, personKeyByRecovery: out.keys.personKeyByRecovery ?? "" });
  const { personKeyByRecovery, ...rest } = wrapped;
  await call("identity.change_password", { currentPassword, newPassword, keys: { ...rest, ...(out.keys.personKeyByRecovery ? { personKeyByRecovery } : {}) } });
}

/** Another Space this device is signed in to, reached as the same person. */
export interface OtherSpace { name: string; call: Call }
type Bundle = { personKeyByPassword: string; personKeyByRecovery?: string; publicKey: string; privateKeyWrapped: string };

/**
 * Make a new recovery code (rc.14): the password opens the person key, which is sealed again under the new code. The new wrap replaces the old one in this Space and in every other Space
 * this device is in with the same account (the same public key), so the old code stops working there too. Answers the Spaces it changed and the ones it could not reach.
 * A wrong password throws before anything is saved.
 */
export async function makeNewRecoveryCode(call: Call, password: string, code: string, others: readonly OtherSpace[] = [], here = "This Space", o: Options = {}): Promise<{ updated: string[]; missed: string[] }> {
  const { keys } = await call("identity.keys_get", {}) as { keys: Bundle };
  const { rewrapRecovery } = await loadCryptoKeys();
  const personKeyByRecovery = await rewrapRecovery(password, code, keys, o);
  await call("identity.recovery_save", { personKeyByRecovery });
  const updated = [here], missed: string[] = [];
  for (const other of others) {
    try {
      const theirs = (await other.call("identity.keys_get", {}) as { keys?: Bundle }).keys;
      if (theirs?.publicKey !== keys.publicKey) continue;   // a different account there: its own code stays
      await other.call("identity.recovery_save", { personKeyByRecovery });
      updated.push(other.name);
    } catch (e) { if ((e as { code?: string } | null)?.code !== "validation.not_found") missed.push(other.name); }
  }
  return { updated, missed };
}

/** A Space this device is signed in to, as "Use one account everywhere" lists it: who the person is there, and the key pair that says which account it is. */
export interface LinkSide { name: string; spaceId: string; call: Call; username: string; publicKey: string }
type FullBundle = Bundle & { spaceKeys: { epoch: number; wrapped: string }[]; formerKey?: string };

/** The Spaces on this device, read once for the sheet: each one's username and public key. One that does not answer is left out. */
export async function linkSides(spaces: readonly { name: string; spaceId: string; call: Call }[]): Promise<LinkSide[]> {
  const out: LinkSide[] = [];
  for (const sp of spaces) {
    try {
      const [sec, keys] = await Promise.all([sp.call("identity.security.get", {}) as Promise<{ username?: string }>, sp.call("identity.keys_get", {}) as Promise<{ keys: Bundle }>]);
      if (sec.username && keys.keys?.publicKey) out.push({ ...sp, username: sec.username, publicKey: keys.keys.publicKey });
    } catch { /* not reachable now: not offered */ }
  }
  return out;
}

/**
 * Use one account everywhere (rc.17). `keep` is the account the person keeps, proved with its password; `other` is the Space whose sign-in moves to it, proved with its password or recovery
 * code. On this device: both bundles open, the other Space's keys are sealed again to the kept key pair and its data key goes into `formerKey` (client/src/crypto/keys.ts linkBundle). Then that
 * Space takes the kept username, password and wraps (identity.link_account), every old session there ends, and the new session it answers is what `onSession` stores.
 */
export async function linkAccounts(keep: LinkSide, keepPassword: string, other: LinkSide, otherSecret: string, device: { deviceName: string; deviceClass: string }, onSession: (spaceId: string, token: string, username: string) => void, o: Options = {}): Promise<void> {
  const crypto = await loadCryptoKeys();
  const [kept, theirs] = await Promise.all([(keep.call("identity.keys_get", {}) as Promise<{ keys: FullBundle }>), (other.call("identity.keys_get", {}) as Promise<{ keys: FullBundle }>)]);
  const code = /^[A-Z0-9]{4}-?[A-Z0-9]{4}-?[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(otherSecret.replace(/\s+/g, "").toUpperCase());
  const secret = code ? { recoveryCode: otherSecret.replace(/[\s-]+/g, "").toUpperCase().replace(/(.{4})(?!$)/g, "$1-") } : { password: otherSecret };
  const keys = await crypto.linkBundle({ password: keepPassword, bundle: kept.keys }, { secret, bundle: theirs.keys }, other.spaceId, o);
  let proof: { currentPassword: string } | { recoveryProof: string };
  if ("password" in secret) proof = { currentPassword: secret.password };
  else {
    // the recovery code proves the other account to its Space with the same one-use challenge a recovery uses; nothing is changed by fetching it
    const { recoverAccountKeys } = await import("../../../../../client/src/crypto/recovery.ts");
    const download = await other.call("identity.recovery_fetch", { username: other.username }) as Parameters<typeof recoverAccountKeys>[2];
    const r = await recoverAccountKeys(secret.recoveryCode, "unused-password-for-proof", download, o);
    crypto.wipe(r.personKey); const dk = (r as { dataKey?: Uint8Array }).dataKey; if (dk) crypto.wipe(dk);
    proof = { recoveryProof: r.recoveryProof };
  }
  const answer = await other.call("identity.link_account", { ...proof, username: keep.username, password: keepPassword, keys, ...device }) as { session?: { token?: string } };
  const token = answer.session?.token;
  if (!token) throw new Error("The Space did not return a session. Sign in there again.");
  onSession(other.spaceId, token, keep.username);
}
