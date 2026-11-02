// Under a Mine sign-in in Vault > AI providers, on a Space server (owner ruling 3 Nov, R62 amended): whether the server keeps a sealed copy of the person's key that opens after their Google, Microsoft or
// GitHub sign-in, and their own "Forget on this server". Forgetting deletes that copy now and keeps none until they say otherwise; their own AI accounts then open when they type their password.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useVaultData } from "../layout/data.tsx";

export const KEPT_LINE = "Opens after you sign in with Google or GitHub on this server";
export const FORGOTTEN_LINE = "Opens when you type your password on this server";

export function ServerKeyLine(): ReactElement | null {
  const data = useVaultData();
  const port = data.serverKey;
  const [state, setState] = useState<{ remembered: boolean; forgotten: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void port?.state().then((s) => { if (live) setState(s); }, () => undefined);
    return () => { live = false; };
  }, [port]);
  if (!port || !state || (!state.remembered && !state.forgotten)) return null;
  const flip = async (): Promise<void> => {
    setBusy(true);
    try { if (await port.keep(state.forgotten)) setState(await port.state()); } finally { setBusy(false); }
  };
  return (
    <View style={s.row} testID="vault-server-key">
      <Text style={s.note}>{state.forgotten ? FORGOTTEN_LINE : KEPT_LINE}</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void flip()} testID={state.forgotten ? "vault-server-key-keep" : "vault-server-key-forget"}>
        <Text style={s.link}>{state.forgotten ? "Keep on this server" : "Forget on this server"}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, paddingTop: 8 },
  note: { fontSize: 12.5, color: "var(--ink-3)" as string },
  link: { fontSize: 12.5, color: "var(--accent)" as string },
});
