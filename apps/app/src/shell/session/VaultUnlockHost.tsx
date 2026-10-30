// The one "Unlock your Vault" prompt (see vault-gate.ts): drawn over whatever is open when a call meets a locked Mine vault key. The person types their password, the key opens on this
// computer, and the call that was waiting goes again. Cancel leaves the page as it was. Mounted once by the shell; skin tokens only, so every skin paints it.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
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
    <View style={s.scrim} testID="vault-unlock" accessibilityViewIsModal>
      <View style={s.card} accessibilityRole="alert" accessibilityLabel="Unlock your Vault">
        <Text accessibilityRole="header" style={s.title}>Unlock your Vault</Text>
        <Text style={s.sub}>Your password opens your Mine items on this computer.</Text>
        <TextInput
          value={password} onChangeText={(v) => { setPassword(v); setError(null); }} secureTextEntry placeholder="Your password" placeholderTextColor="var(--ink-4)" accessibilityLabel="Your password"
          autoFocus onSubmitEditing={submit} editable={!busy} style={s.input} testID="vault-unlock-password"
        />
        {error ? <Text style={s.error} accessibilityRole="alert" testID="vault-unlock-error">{error}</Text> : null}
        <View style={s.row}>
          <Pressable accessibilityRole="button" onPress={() => close(false)} style={s.ghost} testID="vault-unlock-cancel"><Text style={s.ghostText}>Cancel</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={submit} style={[s.go, busy && s.dim]} testID="vault-unlock-go"><Text style={s.goText}>{busy ? "Unlocking" : "Unlock"}</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  scrim: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 9999, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)", padding: 16 },
  card: { width: "100%", maxWidth: 380, gap: 10, padding: 18, borderRadius: 14, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string },
  title: { fontSize: 16, fontWeight: "600", color: "var(--ink)" as string },
  sub: { fontSize: 13, color: "var(--ink-3)" as string },
  input: { height: 36, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--win)" as string, color: "var(--ink)" as string, fontSize: 14 },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
  row: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 },
  ghost: { height: 32, paddingHorizontal: 12, justifyContent: "center", borderRadius: 8 },
  ghostText: { fontSize: 13, color: "var(--ink-2)" as string },
  go: { height: 32, paddingHorizontal: 14, justifyContent: "center", borderRadius: 8, backgroundColor: "var(--accent)" as string },
  goText: { fontSize: 13, fontWeight: "600", color: "#fff" },
  dim: { opacity: 0.6 },
});
