// The lock screen at launch, and the keeper behind it (owner decision, rc.9). The Mac app does not show the shell until this computer holds the person's key: one entry, name and password, hands the key to the
// daemon and opens everything. After that there is no lock, no timer and no password prompt in the session. The key is kept in this app's memory only (client/src/gateway/key-keeper.ts), so a daemon that
// restarts behind an open app gets it back by itself, before the next turn needs it. Quit and relaunch, or an update, shows this screen once. Nothing is written to disk. Phone and web do not use it: a Space
// that is not on this computer never holds a Mine key here (isLoopbackUrl), so they keep their existing flows. Every state has a way on: a wrong password stays here, a Space that does not answer can be
// retried, a forgotten password goes straight to recovery, and Sign out always leaves.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { isLoopbackUrl, keyStatusOnOwnNode } from "../../../../../client/src/gateway/local-key.ts";
import { rehandKey } from "../../../../../client/src/gateway/key-keeper.ts";
import { OFFLINE_OWN, SESSION_OVER, WRONG_PASSWORD, passwordKeyState, unlockWithPassword } from "./key-unlock.ts";
export { hasPasswordKey, passwordKeyState, unlockWithPassword } from "./key-unlock.ts";
import { Bar, Button, ErrorLine, Field, Group, JoinFrame, Links, Opening, Panel, Step, TextButton, Title } from "../../join/kit.tsx";
import { MANY_TRIES, TOO_MANY } from "../../join/failure.ts";

/** How long the lock screen holds Unlock after too many wrong passwords. */
export const LOCK_WAIT_MS = 30_000;

export function LockScreen({ name, onUnlock, onForgot, onSignOut, notice }: { name: string; onUnlock: (password: string) => Promise<void>; onForgot?: () => void; onSignOut?: () => void; /** a line to start with: the Space on this computer did not answer */ notice?: string }): ReactElement {
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
      <Panel below={<LockLinks {...(onForgot ? { onForgot } : {})} {...(onSignOut && !gone ? { onSignOut } : {})} />} bar={<Bar cont={gone && onSignOut ? <Button label="Sign in" onPress={onSignOut} testID="lock-signout" /> : <Button label={busy ? "Unlocking" : "Unlock"} onPress={submit} busy={busy} disabled={password === "" || held} testID="lock-unlock" />} />}>
        <Step id="lock">
          <Title title={name ? `Welcome back, ${name}` : "Welcome back"} />
          <Group>
            <Field label="Password" value={password} onChange={(v) => { setPassword(v); if (!held) setError(""); }} secure autoFocus onSubmit={submit} disabled={busy} testID="lock-password" autoComplete="current-password" error={!!error && !held} visibilityTestID="lock-password-visibility" />
          </Group>
          <ErrorLine testID="lock-error">{error}</ErrorLine>
        </Step>
      </Panel>
    </JoinFrame>
  );
}

/** The two ways out of the lock screen, under the sheet's primary. */
function LockLinks({ onForgot, onSignOut }: { onForgot?: () => void; onSignOut?: () => void }): ReactElement | null {
  if (!onForgot && !onSignOut) return null;
  return <Links>{onForgot ? <TextButton label="Forgot password" onPress={onForgot} testID="lock-forgot" /> : null}{onSignOut ? <TextButton label="Sign out" onPress={onSignOut} testID="lock-signout" /> : null}</Links>;
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
  const [state, setState] = useState<GateState>(own ? "checking" : "open");
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
  // while the app is open: a daemon that lost the key (a restart) gets it back from this app's memory, silently
  useEffect(() => {
    if (!own || state !== "open") return undefined;
    const timer = setInterval(() => { void rehandKey(baseUrl, token); }, 3_000);
    return () => clearInterval(timer);
  }, [own, state, baseUrl, token]);
  if (state === "checking") return <Opening title="Opening your Vault" testID="lock-checking" />;
  if (state === "nopassword") return <NoPasswordKey onContinue={() => setState("open")} {...(onSignOut ? { onSignOut } : {})} />;
  if (state === "locked" || state === "offline") {
    const forgot = onForgot ?? onSignOut;
    return <LockScreen name={name} {...(forgot ? { onForgot: forgot } : {})} {...(onSignOut ? { onSignOut } : {})} {...(state === "offline" ? { notice: OFFLINE_OWN } : {})} onUnlock={async (password) => { await unlockWithPassword(baseUrl, token, password); if (alive.current) setState("open"); }} />;
  }
  return <>{children}</>;
}
