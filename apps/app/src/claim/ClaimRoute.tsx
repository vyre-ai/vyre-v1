// /claim/<token>: wires the claim screen to the Space it was opened from. The link and the Space are the same address (the daemon prints it), so the Space is the page's origin (or ?space=).
// There is no preflight: the first call tells (auth.invalid_code, auth.expired), and a refused call does not spend the link. The one thing known without asking: a session on this very Space means it has its owner, so nobody is sent through a form that cannot work. The claim itself is ./claim.ts.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { holdKeyOnOwnNode } from "../../../../client/src/gateway/local-key.ts";
import { loadCryptoKeys } from "../../../../client/src/crypto/load.ts";
import { makeRecoveryCode } from "../join/JoinFlow.tsx";
import { createCapCaller } from "../shell/session/caps.ts";
import { openRealSession } from "../shell/session/session.ts";
import { readStoredSessions, readStoredSpace, spaceAddress, writeStored } from "../shell/session/stored.ts";
import { claimAppLink } from "../shell/session/entry.ts";
import { useRelayAddress } from "../shell/session/use-relay-address.ts";
import { knownIdentity } from "../join/identity.ts";
import type { Carried, KnownIdentity } from "../join/identity.ts";
import { carried, checkKnownCode, haveAccountDeps, knownProof, rememberAccount } from "../join/carry-wiring.ts";
import { HaveAccount } from "../join/HaveAccount.tsx";
import { claimOwner } from "./claim.ts";
import { fingerprintOf, spaceIdOf, spaceNameOf } from "./logic.ts";
import { storeClaimedOwnerSession } from "./session.ts";
import { ClaimOwner } from "./ClaimOwner.tsx";
import { deviceFor } from "../join/logic.ts";
import { prefillFor, rememberClaimed } from "../onboarding/doors.ts";

/** A browser on a computer (not a phone) can hand a claim link to the desktop app, where the person's account already is. */
function onComputer(): boolean {
  const ua = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? "";
  return !/iPhone|iPad|iPod|Android/.test(ua);
}

/**
 * `local`: the Space is this computer's own Personal Space, so there is no server whose printed fingerprint to compare with and none is shown.
 * `identity`: the account to offer as "Continue as" (rc.14); by default the one this device is signed in to elsewhere, and none for a Space it is already in.
 */
export function ClaimRoute({ token, onDone, onSignIn, onBack, address, fragment, deviceClass="web", local=false, identity }: { token: string; onDone(): void; onSignIn(): void; onBack?():void; address?:string; fragment?:string;deviceClass?:"web"|"desktop";local?:boolean; identity?: KnownIdentity | null }): ReactElement | null {
  const baseUrl = address ?? spaceAddress();
  const call = useMemo(() => (baseUrl ? createCapCaller({ baseUrl, token: () => null }) : null), [baseUrl]);
  const hash = fragment ?? (globalThis as { location?: { hash?: string } }).location?.hash ?? "";
  const spaceId = spaceIdOf(hash);
  // Read once: the claim below stores its own session just before it finishes, and that must not turn this screen into "already used".
  const [spent] = useState(() => !!spaceId && readStoredSpace(spaceId) !== null);
  const [known] = useState(() => identity !== undefined ? identity : knownIdentity(readStoredSessions(), { spaceId, baseUrl }));
  const relay = useRelayAddress(baseUrl, deviceClass === "web" && !local);
  // rc.17: "I already have a Vyre account", for an account this device has no session for
  const [have, setHave] = useState(false);

  if (!call || !baseUrl) return null;
  // A link without the Space id (#s=) is not the link the server printed.
  if (!spaceId) return <ClaimOwner space={spaceNameOf(hash)} newCode={makeRecoveryCode} onClaim={async () => undefined} dead="invalid" onSignIn={onSignIn} />;
  if (spent) return <ClaimOwner space={spaceNameOf(hash)} newCode={makeRecoveryCode} onClaim={async () => undefined} dead="used" onSignIn={onSignIn} signInLabel="Open" />;
  const finish = async (claimed: { token: string }, username: string): Promise<void> => {
    const authenticated = createCapCaller({ baseUrl, token: () => claimed.token });
    await storeClaimedOwnerSession({ baseUrl, token: claimed.token, spaceId, username: username.trim().toLowerCase() }, {
      open: () => openRealSession({ baseUrl, token: claimed.token }),
      getSpace: async () => {
        const current = ((await authenticated("spaces.get", {})) as { space: { id: string; fingerprint: string } }).space;
        return { id: current.id, marker: current.fingerprint };
      },
      persist: writeStored,
    });
  };
  const claim = async (v: { name: string; username: string; password: string; recoveryCode: string }): Promise<void> => {
    const { makeBundle, wipe } = await loadCryptoKeys();
    const claimed = await claimOwner(
      { call, makeBundle: (password, recoveryCode, id) => makeBundle(password, recoveryCode, { spaceId: id }), holdKey: (t, key) => holdKeyOnOwnNode(baseUrl, t, key), wipe },
      { token, spaceId, name: v.name, username: v.username, password: v.password, recoveryCode: v.recoveryCode, ...deviceFor(deviceClass) },
    );
    await finish(claimed, v.username);
    rememberClaimed({ name: v.name, username: v.username, address: baseUrl });
    onDone();
  };
  // An account the person already has: the same keys, opened on this device, and a new Space key for this Space. No new recovery code; a new password only when the recovery code proved it.
  const claimWith = async (c: Carried, from?: KnownIdentity): Promise<void> => {
    const { wipe } = await loadCryptoKeys();
    const claimed = await claimOwner(
      { call, makeBundle: (_pw, _code, id) => c.carry(id), holdKey: (t, key) => holdKeyOnOwnNode(baseUrl, t, key), wipe },
      { token, spaceId, name: c.name, username: c.username, password: c.password, recoveryCode: "", ...deviceFor(deviceClass) },
    );
    await finish(claimed, c.username);
    if (from?.provider && c.viaPassword) rememberAccount(from, c.username);
    onDone();
  };
  const claimAs = known ? async (password: string): Promise<void> => claimWith(await carried(await knownProof(known, { password })), known) : undefined;
  if (have) return <HaveAccount prefix="claim-have" space={spaceNameOf(hash)} working={spaceNameOf(hash) ? `Setting up ${spaceNameOf(hash)}` : "Setting up your Space"} deps={haveAccountDeps(deviceFor(deviceClass))} onProof={async (proof) => claimWith(await carried(proof))} onBack={() => setHave(false)} />;
  const appLink = deviceClass === "web" && !local && onComputer() ? claimAppLink(baseUrl, token, hash, relay) : null;
  return <ClaimOwner space={spaceNameOf(hash)} newCode={makeRecoveryCode} onClaim={claim} onSignIn={onSignIn} {...(onBack ? { onBack } : {})} fingerprint={local ? null : fingerprintOf(hash)} prefill={prefillFor(baseUrl)}
    {...(known && claimAs ? { known: { username: known.username ?? known.name, name: known.name, ...(known.provider ? { provider: true as const } : {}) }, onClaimAs: claimAs } : {})}
    {...(known?.provider ? { either: { onCheckCode: (code: string) => checkKnownCode(known, code), onRecovery: async (code: string, newPassword: string) => claimWith(await carried(await knownProof(known, { code, newPassword })), known) } } : {})}
    onHaveAccount={() => setHave(true)}
    {...(appLink ? { onOpenApp: () => { (globalThis as { location?: { assign(url: string): void } }).location?.assign(appLink); } } : {})} />;
}
