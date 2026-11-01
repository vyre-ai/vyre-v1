// The lock screen at launch, and the keeper behind it (owner decision, rc.9). The Mac app does not show the shell until this computer holds the person's key: one entry, name and password, hands the key to the
// daemon and opens everything. After that there is no lock, no timer and no password prompt in the session. The key is kept in this app's memory only (client/src/gateway/key-keeper.ts), so a daemon that
// restarts behind an open app gets it back by itself, before the next turn needs it. Quit and relaunch, or an update, shows this screen once. Nothing is written to disk. Phone and web do not use it: a Space
// that is not on this computer never holds a Mine key here (isLoopbackUrl), so they keep their existing flows.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { isLoopbackUrl, keyStatusOnOwnNode } from "../../../../../client/src/gateway/local-key.ts";
import { rehandKey } from "../../../../../client/src/gateway/key-keeper.ts";
import { hasPasswordKey, unlockWithPassword } from "./key-unlock.ts";
export { hasPasswordKey, unlockWithPassword } from "./key-unlock.ts";
import { View } from "react-native";
import { Button, Field, JoinFrame, Panel, Step, TextButton, Title, Working } from "../../join/kit.tsx";

export function LockScreen({ name, onUnlock, onForgot, onSignOut, mode }: { name: string; onUnlock: (password: string) => Promise<void>; onForgot?: () => void; onSignOut?: () => void; mode?: "light" | "dark" }): ReactElement {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = useCallback((): void => {
    if (busy) return;
    if (password === "") { setError("Type your password."); return; }
    setBusy(true); setError("");
    onUnlock(password).catch((e: unknown) => { setBusy(false); setPassword(""); setError(e instanceof Error && e.message ? e.message : "That did not open. Try again."); });
  }, [busy, onUnlock, password]);
  return (
    <JoinFrame {...(mode ? { mode } : {})}>
      <Panel center>
        <Step id="lock">
          <Title title={name ? `Welcome back, ${name}` : "Welcome back"} sub="Enter your password to open your Vault on this computer." />
          <View style={{ marginTop: 28, gap: 16 }}>
            <Field label="Password" value={password} onChange={(v) => { setPassword(v); setError(""); }} secure autoFocus onSubmit={submit} disabled={busy} testID="lock-password" autoComplete="current-password" {...(error ? { error } : {})} />
            <Button label={busy ? "Unlocking" : "Unlock"} onPress={submit} disabled={busy} large testID="lock-unlock" />
            {onForgot || onSignOut ? (
              <View style={{ flexDirection: "row", justifyContent: "center", gap: 16 }}>
                {onForgot ? <TextButton label="Forgot password" onPress={onForgot} testID="lock-forgot" /> : null}
                {onSignOut ? <TextButton label="Sign out" onPress={onSignOut} testID="lock-signout" /> : null}
              </View>
            ) : null}
          </View>
        </Step>
      </Panel>
    </JoinFrame>
  );
}

/** An account with no password key: nothing to unlock here, said plainly, with the way on. */
export function NoPasswordKey({ onContinue, onSignOut, mode }: { onContinue: () => void; onSignOut?: () => void; mode?: "light" | "dark" }): ReactElement {
  return (
    <JoinFrame {...(mode ? { mode } : {})}>
      <Panel center>
        <Step id="nokey">
          <Title title="Your Vault has no password here" sub="This account signed in another way, so there is no password to open your Mine items on this computer. Everything else works." />
          <View style={{ marginTop: 28, gap: 16 }}>
            <Button label="Continue" onPress={onContinue} large testID="lock-continue" />
            {onSignOut ? <View style={{ flexDirection: "row", justifyContent: "center" }}><TextButton label="Sign out" onPress={onSignOut} testID="lock-signout" /></View> : null}
          </View>
        </Step>
      </Panel>
    </JoinFrame>
  );
}

const WAIT_MS = 500;
const WAIT_TRIES = 20;

/** Shows `children` once this computer holds the key (or at once for a Space that is not on this computer). While the app runs it hands the key back to a daemon that restarted. */
export function KeyGate({ baseUrl, token, name, onSignOut, children }: { baseUrl: string; token: string; name: string; onSignOut?: () => void; children: ReactNode }): ReactElement | null {
  const own = isLoopbackUrl(baseUrl);
  const [state, setState] = useState<"checking" | "locked" | "nopassword" | "open">(own ? "checking" : "open");
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
          const pw = await hasPasswordKey(baseUrl, token);
          if (live) setState(pw ? "locked" : "nopassword");
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
  if (state === "checking") return <JoinFrame><Panel center><Step id="checking"><Working title="Opening your Vault" testID="lock-checking" /></Step></Panel></JoinFrame>;
  if (state === "nopassword") return <NoPasswordKey onContinue={() => setState("open")} {...(onSignOut ? { onSignOut } : {})} />;
  if (state === "locked") {
    return <LockScreen name={name} {...(onSignOut ? { onForgot: onSignOut, onSignOut } : {})} onUnlock={async (password) => { await unlockWithPassword(baseUrl, token, password); if (alive.current) setState("open"); }} />;
  }
  return <>{children}</>;
}
