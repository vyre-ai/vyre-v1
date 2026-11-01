// The Connect AI card (owner flowchart step 2). Three subscription tiles and an "API key instead" form with a secure field. The value goes to the Vault through connect-ai.ts and is
// cleared from this component at once; the chat only ever learns that a provider was connected.
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { SignInPanel } from "../ai-signin/SignInPanel.tsx";
import { SIGNIN_BUTTONS } from "../ai-signin/flow.ts";
import { API_KEYS, saveApiKey, startSubscription } from "./connect-ai.ts";
import type { SignInFlow } from "./connect-ai.ts";
import { Mark } from "./ProviderLogo.tsx";
import { CARD } from "./card-style.ts";

export function ConnectAiCard({ call, connected, onConnected, initialFlow }: { call: CapCall; connected?: boolean; onConnected(providerId: string): void; /** Opens with this sign-in showing (screenshots and tests). */ initialFlow?: SignInFlow & { provider: string } }): ReactElement {
  const attempt = useRef(globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
  const [mode, setMode] = useState<"tiles" | "key">("tiles");
  const [flow, setFlow] = useState<(SignInFlow & { provider: string }) | null>(initialFlow ?? null);
  const [provider, setProvider] = useState(API_KEYS[0]!.key);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); }
  };
  if (connected) return <Text testID="ai-connected" style={s.ok}>AI account connected.</Text>;
  if (mode === "key") {
    return (
      <View testID="ai-key-form" style={s.col}>
        {/* ui-rows-lint: not a list (provider choices are tiles, not list rows) */}
        <View style={s.row}>{API_KEYS.map((o) => (
          <Pressable key={o.key} testID={`ai-provider-${o.key}`} accessibilityRole="button" accessibilityState={{ selected: provider === o.key }} onPress={() => setProvider(o.key)} style={[s.tile, provider === o.key && s.tileOn]}><Mark k={o.key} size={18} /><Text style={s.tileText}>{o.label}</Text></Pressable>
        ))}</View>
        <TextInput testID="ai-key-field" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" value={secret} onChangeText={setSecret} placeholder="Paste your API key" accessibilityLabel="API key" style={s.input} />
        <Text style={s.dim}>The key goes straight into your Vault. I never see it.</Text>
        {error ? <Text testID="ai-error" style={s.err}>{error}</Text> : null}
        <View style={s.row}>
          <Pressable testID="ai-key-save" accessibilityRole="button" disabled={busy || secret.trim() === ""} onPress={() => void run(async () => { const value = secret; setSecret(""); onConnected(await saveApiKey(call, provider, value, attempt.current)); })} style={[s.primary, (busy || secret.trim() === "") && s.off]}><Text style={s.primaryText}>{busy ? "Saving" : "Save key"}</Text></Pressable>
          <Pressable testID="ai-back" accessibilityRole="button" onPress={() => { setSecret(""); setMode("tiles"); setError(""); }} style={s.ghost}><Text style={s.tileText}>Back</Text></Pressable>
        </View>
      </View>
    );
  }
  return (
    <View testID="ai-tiles" style={s.col}>
      {/* ui-rows-lint: not a list (sign-in choices are tiles, not list rows) */}
      {flow ? (
        <SignInPanel call={call as never} flow={flow} onCancel={() => { setFlow(null); setError(""); }} onDone={(p) => { setFlow(null); onConnected(p.id); }} />
      ) : (
        <View style={s.col}>
          {/* ui-rows-lint: not a list (sign-in choices are buttons, not list rows) */}
          {SIGNIN_BUTTONS.map((o) => (
            <Pressable key={o.key} testID={`ai-sub-${o.key}`} accessibilityRole="button" accessibilityLabel={o.button} disabled={busy} onPress={() => void run(async () => setFlow({ ...(await startSubscription(call, o.key, `${attempt.current}:${o.key}:${Date.now()}`)), provider: o.key }))} style={[s.signin, busy && s.off]}><Mark k={o.key} size={18} /><Text style={s.tileText}>{o.button}</Text></Pressable>
          ))}
        </View>
      )}
      {error ? <Text testID="ai-error" style={s.err}>{error}</Text> : null}
      <Pressable testID="ai-use-key" accessibilityRole="link" onPress={() => { setMode("key"); setError(""); }}><Text style={s.link}>Use an API key instead</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  tile: { minHeight: 40, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center", backgroundColor: "var(--win)" as string },
  signin: { minHeight: 44, paddingHorizontal: 18, borderRadius: 10, flexDirection: "row", gap: 10, borderWidth: 1, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "flex-start", backgroundColor: "var(--win)" as string },
  tileOn: { borderColor: "var(--accent)" as string, backgroundColor: "var(--accent-wash)" as string },
  tileText: { fontSize: 14, fontWeight: "500", color: "var(--ink)" as string },
  input: CARD.input,
  dim: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  err: CARD.err,
  ok: { fontSize: 14, color: "var(--ok)" as string },
  primary: CARD.primary,
  primaryText: CARD.primaryText,
  off: { opacity: 0.45 },
  ghost: CARD.ghost,
  link: { fontSize: 13, color: "var(--accent)" as string },
});
