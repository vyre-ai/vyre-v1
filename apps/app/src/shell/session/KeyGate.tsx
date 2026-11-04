// The lock screen at launch, and the keeper behind it (owner decision, rc.9). The Mac app does not show the shell until this computer holds the person's key: one entry, name and password, hands the key to the
// daemon and opens everything. After that there is no lock, no timer and no password prompt in the session. The key is kept in this app's memory only (client/src/gateway/key-keeper.ts), so a daemon that
// restarts behind an open app gets it back by itself, before the next turn needs it. Quit and relaunch, or an update, shows this screen once. Nothing is written to disk. Phone and web do not use it: a Space
// that is not on this computer never holds a Mine key here (isLoopbackUrl), so they keep their existing flows. Every state has a way on: a wrong password stays here, a Space that does not answer can be
// retried, a forgotten password goes straight to recovery, and Sign out always leaves.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { isLoopbackUrl, keyDoor, keyStatusOnOwnNode, serverKeyState } from "../../../../../client/src/gateway/local-key.ts";
import { keyIsKept, rehandKey } from "../../../../../client/src/gateway/key-keeper.ts";
import { askVaultUnlock } from "./vault-gate.ts";
import { OFFLINE_OWN, SESSION_OVER, WRONG_PASSWORD, afterBeat, passwordKeyState, remoteGateState, unlockWithPassword } from "./key-unlock.ts";
export { hasPasswordKey, passwordKeyState, unlockWithPassword } from "./key-unlock.ts";
import { Bar, Button, ErrorLine, Field, Group, JoinFrame, Links, Opening, Panel, Step, TextButton, Title, useHoldFirstFrame } from "../../join/kit.tsx";
import { whenUsable } from "../../startup/marks.ts";
import { MANY_TRIES, TOO_MANY } from "../../join/failure.ts";

/** How long the lock screen holds Unlock after too many wrong passwords. */
export const LOCK_WAIT_MS = 30_000;

/** The app is mounted but not drawn yet: the first frame stays until the first place is usable. */
function HoldUntilUsable(): null { useHoldFirstFrame(whenUsable); return null; }

export function LockScreen({ name, onUnlock, onForgot, onSignOut, onSkip, notice, sub }: { name: string; onUnlock: (password: string) => Promise<void>; onForgot?: () => void; onSignOut?: () => void; /** a Space server: go on without unlocking; the Mine items stay closed */ onSkip?: () => void; /** one quiet line under the greeting: why the lock is back while Vyre was open */ sub?: string; /** a line to start with: the Space on this computer did not answer */ notice?: string }): ReactElement {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(notice ?? "");
  const [held, setHeld] = useState(false);
  const misses = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const submit = useCallback((): void => {
    if (busy || held || password === "") return;
    setBusy(true); setError("");
    onUnlock(password).catch((e: unknown) => {
      if (!alive.current) return;
      const line = e instanceof Error && e.message ? e.message : OFFLINE_OWN;
      setBusy(false); setPassword("");
      if (line !== WRONG_PASSWORD) { setError(line); return; }
      misses.current++;
      if (misses.current < MANY_TRIES) { setError(line); return; }
      misses.current = 0; setError(TOO_MANY); setHeld(true);
      setTimeout(() => { if (alive.current) { setHeld(false); setError(""); } }, LOCK_WAIT_MS);
    });
  }, [busy, held, onUnlock, password]);
  const gone = error === SESSION_OVER;
  return (
    <JoinFrame>
      <Panel hug below={<LockLinks {...(onForgot ? { onForgot } : {})} {...(onSignOut && !gone ? { onSignOut } : {})} {...(onSkip && !gone ? { onSkip } : {})} />} bar={<Bar cont={gone && onSignOut ? <Button label="Sign in" onPress={onSignOut} testID="lock-signout" /> : <Button label={busy ? "Unlocking" : "Unlock"} onPress={submit} busy={busy} disabled={password === "" || held} testID="lock-unlock" />} />}>
        <Step id="lock">
          <Title title={name ? `Welcome back, ${name}` : "Welcome back"} {...(sub ? { sub } : {})} />
          <Group>
            <Field label="Password" value={password} onChange={(v) => { setPassword(v); if (!held) setError(""); }} secure autoFocus onSubmit={submit} disabled={busy} testID="lock-password" autoComplete="current-password" error={!!error && !held} visibilityTestID="lock-password-visibility" />
          </Group>
          <ErrorLine testID="lock-error" collapse>{error}</ErrorLine>
        </Step>
      </Panel>
    </JoinFrame>
  );
}

/** The two ways out of the lock screen, under the sheet's primary. */
function LockLinks({ onForgot, onSignOut, onSkip }: { onForgot?: () => void; onSignOut?: () => void; onSkip?: () => void }): ReactElement | null {
  if (!onForgot && !onSignOut && !onSkip) return null;
  return <Links>{onSkip ? <TextButton label="Not now" onPress={onSkip} testID="lock-skip" /> : null}{onForgot ? <TextButton label="Forgot password" onPress={onForgot} testID="lock-forgot" /> : null}{onSignOut ? <TextButton label="Sign out" onPress={onSignOut} testID="lock-signout" /> : null}</Links>;
}

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

type GateState = "checking" | "locked" | "offline" | "nopassword" | "open";

/** Shows `children` once this computer holds the key (or at once for a Space that is not on this computer). While the app runs it hands the key back to a daemon that restarted. */
export function KeyGate({ baseUrl, token, name, onSignOut, onForgot, children }: { baseUrl: string; token: string; name: string; onSignOut?: () => void; /** go to recovery for this account; without it Forgot password signs out */ onForgot?: () => void; children: ReactNode }): ReactElement | null {
  const own = isLoopbackUrl(baseUrl);
  // a Space server reached over https: it holds the person's key only while an unlocked device hands it over, so the app asks at launch
  const remote = !own && keyDoor(baseUrl) !== null;
  const [state, setState] = useState<GateState>(own || remote ? "checking" : "open");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!own) return undefined;
    let live = true;
    void (async () => {
      // a daemon still starting does not answer yet: ask again for a few seconds, never read silence as "locked"
      for (let i = 0; i < WAIT_TRIES && live; i++) {
        const st = await keyStatusOnOwnNode(baseUrl, token);
        if (!live) return;
        if (st === "held") { setState("open"); return; }
        if (st === "locked") {
          if (await rehandKey(baseUrl, token)) { if (live) setState("open"); return; }
          const pw = await passwordKeyState(baseUrl, token);
          if (live) setState(pw === "yes" ? "locked" : pw === "no" ? "nopassword" : "offline");
          return;
        }
        await new Promise<void>((r) => setTimeout(r, WAIT_MS));
      }
      if (live) setState("open"); // it never answered: the shell shows its own offline state; the app is not held behind a blank screen
    })();
    return () => { live = false; };
  }, [own, baseUrl, token]);
  useEffect(() => {
    if (!remote) return undefined;
    let live = true;
    void remoteGateState({
      kept: keyIsKept, rehand: () => rehandKey(baseUrl, token),
      serverHolds: async () => { const k = await serverKeyState(baseUrl, token); return k === null ? null : k.held; },
      passwordKey: () => passwordKeyState(baseUrl, token),
    }).then((next) => { if (live) setState(next); }, () => { if (live) setState("open"); });
    return () => { live = false; };
  }, [remote, baseUrl, token]);
  // while the app is open on a Space server: a server that restarted and holds no key, with no key in this app either, shows the lock once (never again for the same loss after Not now)
  const dismissed = useRef(false);
  const [banner, setBanner] = useState(false);
  useEffect(() => {
    if (!remote || state !== "open") return undefined;
    let live = true;
    const timer = setInterval(() => {
      void remoteGateState({
        kept: keyIsKept, rehand: () => rehandKey(baseUrl, token),
        serverHolds: async () => { const k = await serverKeyState(baseUrl, token); return k === null ? null : k.held; },
        passwordKey: () => passwordKeyState(baseUrl, token),
      }).then((now) => { const next = afterBeat(now, { dismissed: dismissed.current }); dismissed.current = next.dismissed; if (live && next.show) setState("locked"); }, () => undefined);
    }, 30_000);
    return () => { live = false; clearInterval(timer); };
  }, [remote, state, baseUrl, token]);
  // while the app is open: a daemon that lost the key (a restart) gets it back from this app's memory, silently
  useEffect(() => {
    if (!own || state !== "open") return undefined;
    const timer = setInterval(() => { void rehandKey(baseUrl, token); }, 3_000);
    return () => clearInterval(timer);
  }, [own, state, baseUrl, token]);
  if (state === "checking") return <Opening testID="lock-checking" />;
  if (state === "nopassword") return <NoPasswordKey onContinue={() => setState("open")} {...(onSignOut ? { onSignOut } : {})} />;
  if (state === "locked" || state === "offline") {
    const forgot = onForgot ?? onSignOut;
    return <LockScreen name={name} {...(forgot ? { onForgot: forgot } : {})} {...(onSignOut ? { onSignOut } : {})} {...(remote ? { onSkip: () => { dismissed.current = true; setState("open"); } } : {})} {...(state === "offline" ? { notice: OFFLINE_OWN } : {})} onUnlock={async (password) => { await unlockWithPassword(baseUrl, token, password); if (alive.current) setState("open"); }} />;
  }
  // the app stays on screen while it works: a slim banner says the sign-ins are locked after a restart, Unlock opens the small sheet over whatever is open, the x is Not now
  const unlockHere = (): void => {
    const forgot = onForgot ?? onSignOut;
    void askVaultUnlock((password) => unlockWithPassword(baseUrl, token, password), { title: "Unlock your sign-ins", sub: SHEET_LINE, ...(forgot ? { forgot } : {}) }).then((ok) => { if (ok) setBanner(false); });
  };
  const dismiss = (): void => { dismissed.current = true; setBanner(false); };
  return (
    <View style={{ flex: 1 }}>
      <HoldUntilUsable />
      {remote && banner ? <LockedBanner onUnlock={unlockHere} onDismiss={dismiss} /> : null}
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

/** The slim line over the app while the server holds no key (owner, 4 Nov): says what is locked and why, with Unlock and a dismiss that does what Not now does. */
export const BANNER_LINE = "Your sign-ins are locked on this server after a restart.";
export const SHEET_LINE = "Your password unlocks your sign-ins on this server.";
export function LockedBanner({ onUnlock, onDismiss }: { onUnlock: () => void; onDismiss: () => void }): ReactElement {
  return (
    <View style={b.bar} accessibilityRole="alert" testID="key-banner">
      <Text style={b.text} numberOfLines={2}>{BANNER_LINE}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Unlock" onPress={onUnlock} testID="key-banner-unlock" style={b.go}><Text style={b.goText}>Unlock</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} testID="key-banner-dismiss" style={b.x}><Text style={b.xText}>{"\u00d7"}</Text></Pressable>
    </View>
  );
}
const b = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "var(--accent-wash)" as string, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  text: { flex: 1, fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
  go: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  goText: { fontSize: 13, fontWeight: "600", color: "var(--accent)" as string },
  x: { width: 24, height: 24, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  xText: { fontSize: 18, lineHeight: 20, color: "var(--ink-3)" as string },
});
