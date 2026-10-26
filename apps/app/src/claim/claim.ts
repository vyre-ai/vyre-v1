// The owner claim, end to end (ruling 71): the person key bundle is made on this device from the password and a recovery code, identity.claim_owner creates the owner with that bundle,
// and the answer is a signed-in session. The password and the person key never leave this function except as the wrapped bundle; the unwrapped key goes to the local daemon only.
import type { MadeBundle } from "../../../../client/src/crypto/keys.ts";
import { CapError } from "../shell/session/caps.ts";
import type { CapCall } from "../shell/session/caps.ts";
import { failureOf } from "./logic.ts";
import type { ClaimFailure } from "./logic.ts";

export interface ClaimInput { token: string; name: string; username: string; password: string; recoveryCode: string; deviceName: string }

export interface ClaimDeps {
  /** An anonymous capability caller on the Space's address. */
  call: CapCall;
  makeBundle(password: string, recoveryCode: string): Promise<MadeBundle>;
  /** Gives the unwrapped person key to this computer's own daemon (false when the Space is not on this computer). */
  holdKey(token: string, key: Uint8Array): Promise<boolean>;
  wipe(b: Uint8Array): void;
}

export interface Claimed { token: string; personId: string | null }

export class ClaimError extends Error {
  readonly failure: ClaimFailure;
  constructor(failure: ClaimFailure, message: string) {
    super(message);
    this.name = "ClaimError";
    this.failure = failure;
  }
}

type ClaimOut = { status?: string; session?: { token: string }; principal?: { id: string } };

export async function claimOwner(deps: ClaimDeps, i: ClaimInput): Promise<Claimed> {
  const made = await deps.makeBundle(i.password, i.recoveryCode);
  // identity.claim_owner wants the wrapped halves only, plus the wrapped Space key epochs (spaceKeys) when makeBundle supplies them.
  const spaceKeys = (made as { spaceKeys?: { epoch: number; wrapped: string }[] }).spaceKeys ?? [];
  const keys = { personKeyByPassword: made.personKeyByPassword, personKeyByRecovery: made.personKeyByRecovery, publicKey: made.publicKey, privateKeyWrapped: made.privateKeyWrapped, spaceKeys };
  try {
    let out: ClaimOut;
    try {
      out = (await deps.call("identity.claim_owner", { code: i.token, displayName: i.name.trim(), username: i.username, password: i.password, deviceName: i.deviceName, deviceClass: "web", keys })) as ClaimOut;
    } catch (e) {
      if (e instanceof CapError) throw new ClaimError(failureOf(e.code, false), e.message);
      throw new ClaimError("unreachable", "The Space did not answer.");
    }
    const token = out?.session?.token;
    if (!token) throw new ClaimError("other", "The Space did not return a session.");
    // Personal keys stay locked when this is not the person's own computer, or the daemon refuses; the owner is set up either way.
    await deps.holdKey(token, made.personKey).catch(() => false);
    return { token, personId: out.principal?.id ?? null };
  } finally {
    deps.wipe(made.personKey);
  }
}
