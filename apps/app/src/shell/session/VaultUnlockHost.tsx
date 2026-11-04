// The one "Unlock your Vault" prompt (see vault-gate.ts): drawn over whatever is open when a call meets a locked Mine vault key. The person types their password, the key opens on this
// computer, and the call that was waiting goes again. Cancel leaves the page as it was. Mounted once by the shell; skin tokens only, so every skin paints it.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text } from "react-native";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import { TextField } from "../../../../../ui/src/TextField/index.tsx";
import { registerVaultPrompt } from "./vault-gate.ts";
import type { Unlock } from "./vault-gate.ts";

interface Req { unlock: Unlock; done: (ok: boolean) => void }

export function VaultUnlockHost(): ReactElement | null {
  const [req, setReq] = useState<Req | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    registerVaultPrompt((unlock) => new Promise<boolean>((done) => { setPassword(""); setError(null); setBusy(false); setReq({ unlock, done }); }));
    return () => registerVaultPrompt(null);
  }, []);
  if (!req) return null;
  const close = (ok: boolean): void => { req.done(ok); setReq(null); setPassword(""); setBusy(false); setError(null); };
  const submit = (): void => {
    if (busy) return;
    if (password === "") { setError("Type your password."); return; }
    setBusy(true); setError(null);
    req.unlock(password).then(() => close(true), (e: unknown) => { setBusy(false); setPassword(""); setError(e instanceof Error && e.message ? e.message : "Could not unlock your Vault."); });
  };
  return (
    <Dialog
      title="Unlock your Vault" testID="vault-unlock" width={400} onClose={() => close(false)}
      actions={[{ label: "Cancel", testID: "vault-unlock-cancel", onPress: () => close(false) }, { label: busy ? "Unlocking" : "Unlock", primary: true, disabled: busy, testID: "vault-unlock-go", onPress: submit }]}
    >
      <Text style={s.sub}>Your password opens your Mine items on this computer.</Text>
      <TextField
        value={password} onChangeText={(v) => { setPassword(v); setError(null); }} secureTextEntry placeholder="Your password" accessibilityLabel="Your password"
        autoFocus onSubmitEditing={submit} editable={!busy} testID="vault-unlock-password"
      />
      {error ? <Text style={s.error} accessibilityRole="alert" testID="vault-unlock-error">{error}</Text> : null}
    </Dialog>
  );
}

const s = StyleSheet.create({
  sub: { fontSize: 13.5, lineHeight: 20, color: "var(--ink-3)" as string },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
});
