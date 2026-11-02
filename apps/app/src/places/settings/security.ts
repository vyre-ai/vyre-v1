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
