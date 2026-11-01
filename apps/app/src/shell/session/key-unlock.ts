// The password step of the lock screen, without any screen: open the person's key with the password and hand it to this computer's daemon, keeping a copy for the session. A plain module so a test can run the
// real thing with no UI toolchain.
import { loadCryptoKeys } from "../../../../../client/src/crypto/load.ts";
import { holdKeyOnOwnNode } from "../../../../../client/src/gateway/local-key.ts";
import { keepKey } from "../../../../../client/src/gateway/key-keeper.ts";
import { createCapCaller } from "./caps.ts";

type Keys = { personKeyByPassword: string; personKeyByRecovery?: string; publicKey: string; privateKeyWrapped: string };

/** Opens the key with the password and hands it to this computer's daemon, keeping a copy for the session. Throws a plain sentence for a wrong password. */
export async function unlockWithPassword(baseUrl: string, token: string, password: string): Promise<void> {
  const reach = createCapCaller({ baseUrl, token: () => token });
  const got = (await reach("identity.keys_get", {})) as { keys: Keys };
  const { openBundle, wipe } = await loadCryptoKeys();
  let opened: Awaited<ReturnType<typeof openBundle>>;
  try { opened = await openBundle(password, { ...got.keys, personKeyByRecovery: got.keys.personKeyByRecovery ?? "" }); } catch { throw new Error("That password is not right."); }
  try {
    if (!(await holdKeyOnOwnNode(baseUrl, token, opened.personKey))) throw new Error("Your vault could not be opened on this computer.");
    keepKey(opened.personKey);
  } finally { wipe(opened.personKey); wipe(opened.privateKey); }
}

/** Whether this account has a password key to open here. False for an account signed in another way, or when the keys cannot be read: there is then nothing to unlock with a password. */
export async function hasPasswordKey(baseUrl: string, token: string): Promise<boolean> {
  try {
    const got = (await createCapCaller({ baseUrl, token: () => token })("identity.keys_get", {})) as { keys?: { personKeyByPassword?: unknown } };
    return typeof got.keys?.personKeyByPassword === "string" && got.keys.personKeyByPassword !== "";
  } catch { return false; }
}

