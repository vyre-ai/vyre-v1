// /claim/<token>: wires the claim screen to the Space it was opened from. The link and the Space are the same address (the daemon prints it), so the Space is the page's origin (or ?space=).
// There is no preflight: the first call tells (auth.invalid_code, auth.expired), and a refused call does not spend the link. The claim itself is ./claim.ts.
import { useMemo } from "react";
import type { ReactElement } from "react";
import { holdKeyOnOwnNode } from "../../../../client/src/gateway/local-key.ts";
import { makeBundle, wipe } from "../../../../client/src/crypto/keys.ts";
import { makeRecoveryCode } from "../join/JoinFlow.tsx";
import { createCapCaller } from "../shell/session/caps.ts";
import { openRealSession } from "../shell/session/session.ts";
import { spaceAddress, writeStored } from "../shell/session/stored.ts";
import { claimOwner } from "./claim.ts";
import { fingerprintOf, spaceIdOf } from "./logic.ts";
import { ClaimOwner } from "./ClaimOwner.tsx";

const hostOf = (baseUrl: string): string => baseUrl.replace(/^https?:\/\//, "").split(":")[0] ?? baseUrl;

export function ClaimRoute({ token, onDone, onSignIn }: { token: string; onDone(): void; onSignIn(): void }): ReactElement | null {
  const baseUrl = spaceAddress();
  const call = useMemo(() => (baseUrl ? createCapCaller({ baseUrl, token: () => null }) : null), [baseUrl]);

  if (!call || !baseUrl) return null;
  const hash = (globalThis as { location?: { hash?: string } }).location?.hash ?? "";
  const spaceId = spaceIdOf(hash);
  // A link without the Space id (#s=) is not the link the server printed.
  if (!spaceId) return <ClaimOwner space={hostOf(baseUrl)} newCode={makeRecoveryCode} onClaim={async () => undefined} dead="invalid" onSignIn={onSignIn} />;
  const claim = async (v: { name: string; username: string; password: string; recoveryCode: string }): Promise<void> => {
    const claimed = await claimOwner(
      { call, makeBundle: (password, recoveryCode, id) => makeBundle(password, recoveryCode, { spaceId: id }), holdKey: (t, key) => holdKeyOnOwnNode(baseUrl, t, key), wipe },
      { token, spaceId, name: v.name, username: v.username, password: v.password, recoveryCode: v.recoveryCode, deviceName: "Web browser" },
    );
    const real = await openRealSession({ baseUrl, token: claimed.token });
    writeStored({ baseUrl, token: claimed.token, def: real.def, personId: real.me.id });
    real.close();
    onDone();
  };
  return <ClaimOwner space={hostOf(baseUrl)} newCode={makeRecoveryCode} onClaim={claim} onSignIn={onSignIn} fingerprint={fingerprintOf(hash)} />;
}
