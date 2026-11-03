// The network and crypto behind "Continue as" and "I already have a Vyre account" (rc.17), shared by the claim and the join: the home Space is reached with the same capability caller the app
// uses everywhere, and the key work loads the crypto chunk only when a person presses Continue.
import { loadCryptoKeys } from "../../../../client/src/crypto/load.ts";
import type { RecoveryBundle } from "../../../../client/src/crypto/keys.ts";
import { createCapCaller } from "../shell/session/caps.ts";
import { readStored, spaceEndpoint, writeStored } from "../shell/session/stored.ts";
import { normalizeSpaceAddress } from "./logic.ts";
import type { HaveAccountDeps } from "./HaveAccount.tsx";
import { CarryError, bundleAt, carriedOf, checkCode, homeOptions, recoveryAtHome, recoveryPart, signInHome, usernameAt } from "./identity.ts";
import type { Carried, CarryCrypto, HomeDeps, KnownIdentity, Proof } from "./identity.ts";

export async function cryptoCarry(): Promise<CarryCrypto & { openCode(code: string, bundle: RecoveryBundle): Promise<void> }> {
  const k = await loadCryptoKeys();
  return {
    carryBundle: (p, b, id) => k.carryBundle(p, b, id),
    carryWithRecovery: (c, p, b, id) => k.carryWithRecovery(c, p, b, id),
    openCode: async (code, b) => { const opened = await k.openWithRecovery(code, { personKeyByPassword: "", ...b }); k.wipeOpened(opened); },
  };
}

export function homeDeps(device: { deviceName: string; deviceClass: string }): HomeDeps {
  return { anonymous: (address) => createCapCaller({ baseUrl: address, token: () => null }), signedIn: (address, token) => createCapCaller({ baseUrl: address, token: () => token }), device };
}

/** The deps HaveAccount needs, reached over the network from this device. */
export function haveAccountDeps(device: { deviceName: string; deviceClass: string }): HaveAccountDeps {
  const deps = homeDeps(device);
  return {
    options: async (typed) => {
      const normalized = normalizeSpaceAddress(typed);
      const address = normalized ? spaceEndpoint(normalized) : null;
      if (!address) throw new CarryError("unreachable", "That is not a Space address. It looks like northwind.vyre.run.");
      return { ...(await homeOptions(deps, address)), address };
    },
    signIn: (address, username, password, totp) => signInHome(deps, address, username, password, totp),
    recovery: (address, username) => recoveryAtHome(deps, address, username),
    checkCode: async (code, bundle) => { const c = await cryptoCarry(); await checkCode(c.openCode, bundle, code); },
  };
}

/** A proof turned into what the claim and the join send. */
export async function carried(proof: Proof): Promise<Carried> { return carriedOf(proof, await cryptoCarry()); }

/** "Continue as": the known identity's session hands back the bundle; the password, or the code and a new password, prove it here. */
export async function knownProof(known: KnownIdentity, secret: { password: string } | { code: string; newPassword: string }): Promise<Proof> {
  const source = createCapCaller({ baseUrl: known.baseUrl, token: () => known.token });
  const [username, bundle] = await Promise.all([known.username ? Promise.resolve(known.username) : usernameAt(source), bundleAt(source)]);
  if ("password" in secret) {
    if (!bundle.personKeyByPassword) throw new CarryError("no_keys", "This account has no keys to bring. Use a different account.");
    return { kind: "password", username, name: known.name, password: secret.password, bundle };
  }
  const part = recoveryPart(bundle);
  if (!part) throw new CarryError("no_code", "This account has no recovery code. Use your password.");
  return { kind: "code", username, name: known.name, code: secret.code, newPassword: secret.newPassword, bundle: part };
}

/** "Continue as" with a recovery code: say a wrong code before a password is chosen. */
export async function checkKnownCode(known: KnownIdentity, code: string): Promise<void> {
  const bundle = await bundleAt(createCapCaller({ baseUrl: known.baseUrl, token: () => known.token }));
  const c = await cryptoCarry();
  await checkCode(c.openCode, recoveryPart(bundle), code);
}

/** The device remembers who it is (rc.17): a session made with a provider sign-in gets the username, once the account's password opened its bundle, so it is never asked the long way again. */
export function rememberAccount(from: KnownIdentity, username: string): void {
  const s = readStored(undefined, from.baseUrl);
  if (s && !s.username && s.def.spaceId === from.spaceId) writeStored({ ...s, username });
}
