// /claim/<token>: wires the claim screen to the Space it was opened from. The link and the Space are the same address (the daemon prints it), so the Space is the page's origin (or ?space=).
// A read-only preflight (identity.claim_status, when the server has it) shows a spent or expired link before the form; the claim itself is ./claim.ts.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { holdKeyOnOwnNode } from "../../../../client/src/gateway/local-key.ts";
import { makeBundle, wipe } from "../../../../client/src/crypto/keys.ts";
import { makeRecoveryCode } from "../join/JoinFlow.tsx";
import { CapError, createCapCaller } from "../shell/session/caps.ts";
import { openRealSession } from "../shell/session/session.ts";
import { spaceAddress, writeStored } from "../shell/session/stored.ts";
import { claimOwner } from "./claim.ts";
import { ClaimOwner } from "./ClaimOwner.tsx";
import { failureOf } from "./logic.ts";
import type { ClaimFailure } from "./logic.ts";

type Preflight = { state: "checking" } | { state: "ready"; space: string } | { state: "dead"; failure: ClaimFailure; space: string };

const hostOf = (baseUrl: string): string => baseUrl.replace(/^https?:\/\//, "").split(":")[0] ?? baseUrl;

export function ClaimRoute({ token, onDone, onSignIn }: { token: string; onDone(): void; onSignIn(): void }): ReactElement | null {
  const baseUrl = spaceAddress();
  const call = useMemo(() => (baseUrl ? createCapCaller({ baseUrl, token: () => null }) : null), [baseUrl]);
  const [pre, setPre] = useState<Preflight>({ state: "checking" });

  useEffect(() => {
    if (!call || !baseUrl) return;
    let off = false;
    call("identity.claim_status", { token }).then((out) => {
      if (off) return;
      const o = out as { state?: string; spaceName?: string } | undefined;
      const space = o?.spaceName || hostOf(baseUrl);
      const failure = o?.state === "used" || o?.state === "expired" ? failureOf(o.state, false) : null;
      setPre(failure ? { state: "dead", failure, space } : { state: "ready", space });
    }, (e: unknown) => {
      if (off) return;
      // A server without the preflight (or one that refuses it) still lets the person try: the claim itself decides.
      const failure = e instanceof CapError ? failureOf(e.code, false) : null;
      setPre(failure && (failure === "used" || failure === "expired") ? { state: "dead", failure, space: hostOf(baseUrl) } : { state: "ready", space: hostOf(baseUrl) });
    });
    return () => { off = true; };
  }, [call, baseUrl, token]);

  if (!call || !baseUrl) return null;
  if (pre.state === "checking") return null;
  const claim = async (v: { name: string; username: string; password: string; recoveryCode: string }): Promise<void> => {
    const claimed = await claimOwner(
      { call, makeBundle, holdKey: (t, key) => holdKeyOnOwnNode(baseUrl, t, key), wipe },
      { token, name: v.name, username: v.username, password: v.password, recoveryCode: v.recoveryCode, deviceName: "Web browser" },
    );
    const real = await openRealSession({ baseUrl, token: claimed.token });
    writeStored({ baseUrl, token: claimed.token, def: real.def, personId: real.me.id });
    real.close();
    onDone();
  };
  return <ClaimOwner space={pre.space} newCode={makeRecoveryCode} onClaim={claim} dead={pre.state === "dead" ? pre.failure : null} onSignIn={onSignIn} />;
}
