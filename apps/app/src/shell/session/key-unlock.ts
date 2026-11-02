// The password step of the lock screen, without any screen: open the person's key with the password and hand it to this computer's daemon, keeping a copy for the session. A plain module so a test can run the
// real thing with no UI toolchain.
import { loadCryptoKeys } from "../../../../../client/src/crypto/load.ts";
import { holdKeyOnOwnNode } from "../../../../../client/src/gateway/local-key.ts";
import { keepKey } from "../../../../../client/src/gateway/key-keeper.ts";
import { createCapCaller } from "./caps.ts";

type Keys = { personKeyByPassword: string; personKeyByRecovery?: string; publicKey: string; privateKeyWrapped: string };

/** The lock screen's words. Kept beside the step so the screen and the step cannot disagree. */
export const WRONG_PASSWORD = "That password is not right.";
export const OFFLINE_OWN = "Vyre cannot reach the Space on this computer. Try again.";
export const SESSION_OVER = "You were signed out. Sign in again.";
export const VAULT_REFUSED = "Your Vault could not be opened on this computer.";

const lineOf = (e: unknown): string => ((e as { status?: number } | null)?.status === 401 ? SESSION_OVER : OFFLINE_OWN);

/** Opens the key with the password and hands it to this computer's daemon, keeping a copy for the session. Throws one plain sentence for a wrong password, an unreachable daemon or a session that ended. */
export async function unlockWithPassword(baseUrl: string, token: string, password: string): Promise<void> {
  const reach = createCapCaller({ baseUrl, token: () => token });
  let got: { keys: Keys };
  try { got = (await reach("identity.keys_get", {})) as { keys: Keys }; } catch (e) { throw new Error(lineOf(e)); }
  const { openBundle, wipe } = await loadCryptoKeys();
  let opened: Awaited<ReturnType<typeof openBundle>>;
  try { opened = await openBundle(password, { ...got.keys, personKeyByRecovery: got.keys.personKeyByRecovery ?? "" }); } catch { throw new Error(WRONG_PASSWORD); }
  try {
    let held = false;
    try { held = await holdKeyOnOwnNode(baseUrl, token, opened.personKey); } catch { throw new Error(OFFLINE_OWN); }
    if (!held) throw new Error(VAULT_REFUSED);
    keepKey(opened.personKey);
  } finally { wipe(opened.personKey); wipe(opened.privateKey); }
}

/** Whether this account has a password key to open here. "no" only when the Space answered that it has none; a Space that did not answer is "unknown", never read as no password. */
export async function passwordKeyState(baseUrl: string, token: string): Promise<"yes" | "no" | "unknown"> {
  try {
    const got = (await createCapCaller({ baseUrl, token: () => token })("identity.keys_get", {})) as { keys?: { personKeyByPassword?: unknown } };
    return typeof got.keys?.personKeyByPassword === "string" && got.keys.personKeyByPassword !== "" ? "yes" : "no";
  } catch (e) { return (e as { status?: number } | null)?.status === 404 ? "no" : "unknown"; }
}

/** Whether there is a password key to open here. Kept for callers that only need yes or no. */
export async function hasPasswordKey(baseUrl: string, token: string): Promise<boolean> { return (await passwordKeyState(baseUrl, token)) === "yes"; }
