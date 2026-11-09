// The lock screen at launch, and the keeper behind it (owner decision, rc.9). The Mac app does not show the shell until this computer holds the person's key: one entry, name and password, hands the key to the
// daemon and opens everything. After that there is no lock, no timer and no password prompt in the session. The key is kept in this app's memory only (client/src/gateway/key-keeper.ts), so a daemon that
// restarts behind an open app gets it back by itself, before the next turn needs it. Quit and relaunch, or an update, shows this screen once. Nothing is written to disk. Phone and web do not use it: a Space
// that is not on this computer never holds a Mine key here (isLoopbackUrl), so they keep their existing flows. Every state has a way on: a wrong password stays here, a Space that does not answer can be
// retried, a forgotten password goes straight to recovery, and Sign out always leaves.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { isLoopbackUrl, keyDoor, keyStatusOnOwnNode, serverKeyState } from "../../../../../client/src/gateway/local-key.ts";
import { rehandKey, restoreKey } from "../../../../../client/src/gateway/key-keeper.ts";
import { OFFLINE_OWN, SESSION_OVER, WRONG_PASSWORD, passwordKeyState } from "./key-unlock.ts";
export { hasPasswordKey, passwordKeyState, unlockWithPassword } from "./key-unlock.ts";
import { Bar, Button, ErrorLine, Field, Group, JoinFrame, Links, Opening, Panel, Step, TextButton, Title, useHoldFirstFrame } from "../../join/kit.tsx";
import { whenUsable } from "../../startup/marks.ts";
import { MANY_TRIES, TOO_MANY } from "../../join/failure.ts";

/** The app is mounted but not drawn yet: the first frame stays until the first place is usable. */
function HoldUntilUsable(): null { useHoldFirstFrame(whenUsable); return null; }

/** An account with no password key: nothing to unlock here, said plainly, with the way on. */
export function NoPasswordKey({ onContinue, onSignOut }: { onContinue: () => void; onSignOut?: () => void }): ReactElement {
  return (
    <JoinFrame>
      <Panel below={onSignOut ? <Links><TextButton label="Sign out" onPress={onSignOut} testID="lock-signout" /></Links> : undefined} bar={<Bar cont={<Button label="Continue" onPress={onContinue} testID="lock-continue" />} />}>
        <Step id="nokey"><Title title="No password here" sub="This account signed in another way" /></Step>
      </Panel>
    </JoinFrame>
  );
}

const WAIT_MS = 500;
const WAIT_TRIES = 20;

type GateState = "checking" | "nopassword" | "open";

/**
 * Signed in means unlocked (owner ruling 6 Nov). The person key was opened by the password at sign-in and sealed on this device (client/src/gateway/key-seal.ts); this gate brings it back after a launch and
 * hands it to the node that needs it, with no password, no lock screen and no timer. A session that has no key on this device (signed in before keys were kept here, or the device store was wiped) stays
 * signed in (owner, 10 Nov: every Space is signed in after an update as it was before it): the shell opens and the Vault asks for the password once, where it is first needed. A saved sign-in is never
 * removed for a missing key. While the app runs it hands the key back to a node that restarted.
 */
export function KeyGate({ baseUrl, token, onSignOut, children }: { baseUrl: string; token: string; name?: string; onSignOut?: () => void; /** kept for callers; there is no unlock sheet any more */ onForgot?: () => void; children: ReactNode }): ReactElement | null {
  const own = isLoopbackUrl(baseUrl);
  // a Space server reached over https holds the key while a signed-in device hands it over, so the app hands it over at launch
  const remote = !own && keyDoor(baseUrl) !== null;
  const [state, setState] = useState<GateState>(own || remote ? "checking" : "open");
  useEffect(() => {
    if (!own && !remote) return undefined;
    let live = true;
    void (async () => {
      const restored = await restoreKey(token);
      // a node still starting does not answer yet: ask again for a few seconds, never read silence as "no key"
      for (let i = 0; i < (own ? WAIT_TRIES : 1) && live; i++) {
        const next = await gateState({
          own, restored,
          status: () => own ? keyStatusOnOwnNode(baseUrl, token) : serverKeyState(baseUrl, token).then((k) => k === null ? "unreachable" as const : k.held ? "held" as const : "locked" as const),
          rehand: () => rehandKey(baseUrl, token),
          passwordKey: () => passwordKeyState(baseUrl, token),
        });
        if (!live) return;
        if (next !== "wait") { setState(next); return; }
        await new Promise<void>((r) => setTimeout(r, WAIT_MS));
      }
      if (live) setState("open"); // it never answered: the shell shows its own offline state; the app is not held behind a blank screen
    })();
    return () => { live = false; };
  }, [own, remote, baseUrl, token]);
  // while the app is open: a node that lost the key (a restart, a deploy) gets it back from this app, silently
  useEffect(() => {
    if (!(own || remote) || state !== "open") return undefined;
    const timer = setInterval(() => { void rehandKey(baseUrl, token); }, own ? 3_000 : 30_000);
    return () => clearInterval(timer);
  }, [own, remote, state, baseUrl, token]);
  if (state === "checking") return <Opening testID="lock-checking" />;
  if (state === "nopassword") return <NoPasswordKey onContinue={() => setState("open")} {...(onSignOut ? { onSignOut } : {})} />;
  return (
    <View style={{ flex: 1 }}>
      <HoldUntilUsable />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

/**
 * What one look at the key says: the node holds it (go in), this app can hand it over (go in), the account has no password key to open anything with (say so), or nobody has it and there is none on this
 * device (go in all the same: the Vault asks for the password where it is first needed, and the sign-in is kept). "wait" is a node that did not answer yet.
 */
export async function gateState(d: {
  own: boolean;
  restored: boolean;
  status(): Promise<"held" | "locked" | "unreachable">;
  rehand(): Promise<boolean>;
  passwordKey(): Promise<"yes" | "no" | "unknown">;
}): Promise<"open" | "nopassword" | "wait"> {
  const st = await d.status();
  if (st === "held") return "open";
  if (st === "unreachable") return d.own ? "wait" : "open";
  if (d.restored && await d.rehand()) return "open";
  const pw = await d.passwordKey();
  return pw === "no" ? "nopassword" : "open";
}

/** The notice in the top bar while the sign-ins are locked (no dismiss: it goes when they are unlocked), and the line of the sheet Unlock opens. */
export const NOTICE_LINE = "Sign-ins locked";
export const SHEET_LINE = "Your password unlocks your sign-ins on this server.";
