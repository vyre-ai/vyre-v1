import { loadCryptoKeys } from "../../../../../client/src/crypto/load.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

/** Rewrap the same person key locally; never replace private data keys during a password change. */
export async function changeOwnPassword(call: Call, currentPassword: string, newPassword: string): Promise<void> {
  const out = await call("identity.keys_get", {}) as { keys: { personKeyByPassword: string; personKeyByRecovery?: string; publicKey: string; privateKeyWrapped: string; spaceKeys: unknown[] } };
  const { rewrap } = await loadCryptoKeys();
  const wrapped = await rewrap(currentPassword, newPassword, { ...out.keys, personKeyByRecovery: out.keys.personKeyByRecovery ?? "" });
  const { personKeyByRecovery, ...rest } = wrapped;
  await call("identity.change_password", { currentPassword, newPassword, keys: { ...rest, ...(out.keys.personKeyByRecovery ? { personKeyByRecovery } : {}) } });
}
