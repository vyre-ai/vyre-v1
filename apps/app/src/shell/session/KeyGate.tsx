// The lock screen at launch, and the keeper behind it (owner decision, rc.9). The Mac app does not show the shell until this computer holds the person's key: one entry, name and password, hands the key to the
// daemon and opens everything. After that there is no lock, no timer and no password prompt in the session. The key is kept in this app's memory only (client/src/gateway/key-keeper.ts), so a daemon that
// restarts behind an open app gets it back by itself, before the next turn needs it. Quit and relaunch, or an update, shows this screen once. Nothing is written to disk. Phone and web do not use it: a Space
// that is not on this computer never holds a Mine key here (isLoopbackUrl), so they keep their existing flows.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createCapCaller } from "./caps.ts";
import { loadCryptoKeys } from "../../../../../client/src/crypto/load.ts";
import { holdKeyOnOwnNode, isLoopbackUrl, keyHeldOnOwnNode } from "../../../../../client/src/gateway/local-key.ts";
import { keepKey, rehandKey } from "../../../../../client/src/gateway/key-keeper.ts";
import { View } from "react-native";
import { Button, Field, JoinFrame, Panel, Step, Title } from "../../join/kit.tsx";

type Keys = { personKeyByPassword: string; personKeyByRecovery?: string; publicKey: string; privateKeyWrapped: string };

/** Opens the key with the password and hands it to this computer's daemon, keeping a copy for the session. Throws a plain sentence for a wrong password. */
export async function unlockWithPassword(baseUrl: string, token: string, password: string): Promise<void> {
  const reach = createCapCaller({ baseUrl, token: () => token });
  const got = (await reach("identity.keys_get", {})) as { keys: Keys };
  const { openBundle, wipe } = await loadCryptoKeys();
  let opened: Awaited<ReturnType<typeof openBundle>>;
  try { opened = await openBundle(password, { ...got.keys, personKeyByRecovery: got.keys.personKeyByRecovery ?? "" }); } catch { throw new Error("That password is not right."); }
  try {
    if (!(await holdKeyOnOwnNode(baseUrl, token, opened.personKey))) throw new Error("Your vault could not be opened on this computer.");
    keepKey(opened.personKey);
  } finally { wipe(opened.personKey); wipe(opened.privateKey); }
}

export function LockScreen({ name, onUnlock, mode }: { name: string; onUnlock: (password: string) => Promise<void>; mode?: "light" | "dark" }): ReactElement {
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
          </View>
        </Step>
      </Panel>
    </JoinFrame>
  );
}

/** Shows `children` once this computer holds the key (or at once for a Space that is not on this computer). While the app runs it hands the key back to a daemon that restarted. */
export function KeyGate({ baseUrl, token, name, children }: { baseUrl: string; token: string; name: string; children: ReactNode }): ReactElement | null {
  const own = isLoopbackUrl(baseUrl);
  const [state, setState] = useState<"checking" | "locked" | "open">(own ? "checking" : "open");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!own) return undefined;
    let live = true;
    void (async () => {
      const held = (await keyHeldOnOwnNode(baseUrl, token)) || (await rehandKey(baseUrl, token));
      if (live) setState(held ? "open" : "locked");
    })();
    return () => { live = false; };
  }, [own, baseUrl, token]);
  // while the app is open: a daemon that lost the key (a restart) gets it back from this app's memory, silently
  useEffect(() => {
    if (!own || state !== "open") return undefined;
    const timer = setInterval(() => { void rehandKey(baseUrl, token); }, 3_000);
    return () => clearInterval(timer);
  }, [own, state, baseUrl, token]);
  if (state === "checking") return null;
  if (state === "locked") return <LockScreen name={name} onUnlock={async (password) => { await unlockWithPassword(baseUrl, token, password); if (alive.current) setState("open"); }} />;
  return <>{children}</>;
}
