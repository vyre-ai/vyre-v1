// /claim/<token>: wires the claim screen to the Space it was opened from. The link and the Space are the same address (the daemon prints it), so the Space is the page's origin (or ?space=).
// There is no preflight: the first call tells (auth.invalid_code, auth.expired), and a refused call does not spend the link. The one thing known without asking: a session on this very Space means it has its owner, so nobody is sent through a form that cannot work. The claim itself is ./claim.ts.
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { holdKeyOnOwnNode } from "../../../../client/src/gateway/local-key.ts";
import { loadCryptoKeys } from "../../../../client/src/crypto/load.ts";
import { makeRecoveryCode } from "../join/JoinFlow.tsx";
import { createCapCaller } from "../shell/session/caps.ts";
import { openRealSession } from "../shell/session/session.ts";
import { readStoredSpace, spaceAddress, writeStored } from "../shell/session/stored.ts";
import { claimOwner } from "./claim.ts";
import { fingerprintOf, spaceIdOf, spaceNameOf } from "./logic.ts";
import { storeClaimedOwnerSession } from "./session.ts";
import { ClaimOwner } from "./ClaimOwner.tsx";
import { prefillFor, rememberClaimed } from "../onboarding/doors.ts";

export function ClaimRoute({ token, onDone, onSignIn, onBack, address, fragment, deviceClass="web" }: { token: string; onDone(): void; onSignIn(): void; onBack?():void; address?:string; fragment?:string;deviceClass?:"web"|"desktop" }): ReactElement | null {
  const baseUrl = address ?? spaceAddress();
  const call = useMemo(() => (baseUrl ? createCapCaller({ baseUrl, token: () => null }) : null), [baseUrl]);
  const hash = fragment ?? (globalThis as { location?: { hash?: string } }).location?.hash ?? "";
  const spaceId = spaceIdOf(hash);
  // Read once: the claim below stores its own session just before it finishes, and that must not turn this screen into "already used".
  const [spent] = useState(() => !!spaceId && readStoredSpace(spaceId) !== null);

  if (!call || !baseUrl) return null;
  // A link without the Space id (#s=) is not the link the server printed.
  if (!spaceId) return <ClaimOwner space={spaceNameOf(hash)} newCode={makeRecoveryCode} onClaim={async () => undefined} dead="invalid" onSignIn={onSignIn} />;
  if (spent) return <ClaimOwner space={spaceNameOf(hash)} newCode={makeRecoveryCode} onClaim={async () => undefined} dead="used" onSignIn={onSignIn} signInLabel="Open" />;
  const claim = async (v: { name: string; username: string; password: string; recoveryCode: string }): Promise<void> => {
    const { makeBundle, wipe } = await loadCryptoKeys();
    const claimed = await claimOwner(
      { call, makeBundle: (password, recoveryCode, id) => makeBundle(password, recoveryCode, { spaceId: id }), holdKey: (t, key) => holdKeyOnOwnNode(baseUrl, t, key), wipe },
      { token, spaceId, name: v.name, username: v.username, password: v.password, recoveryCode: v.recoveryCode, deviceName: deviceClass==="desktop"?"Vyre desktop":"Web browser", deviceClass },
    );
    const authenticated = createCapCaller({ baseUrl, token: () => claimed.token });
    await storeClaimedOwnerSession({ baseUrl, token: claimed.token, spaceId, username: v.username.trim().toLowerCase() }, {
      open: () => openRealSession({ baseUrl, token: claimed.token }),
      getSpace: async () => {
        const current = ((await authenticated("spaces.get", {})) as { space: { id: string; fingerprint: string } }).space;
        return { id: current.id, marker: current.fingerprint };
      },
      persist: writeStored,
    });
    rememberClaimed({ name: v.name, username: v.username, address: baseUrl });
    onDone();
  };
  return <ClaimOwner space={spaceNameOf(hash)} newCode={makeRecoveryCode} onClaim={claim} onSignIn={onSignIn} {...(onBack ? { onBack } : {})} fingerprint={fingerprintOf(hash)} prefill={prefillFor(baseUrl)} />;
}
