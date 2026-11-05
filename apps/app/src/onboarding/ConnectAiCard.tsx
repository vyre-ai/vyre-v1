// The Connect AI card (owner flowchart step 2). Three subscription tiles and an "API key instead" form with a secure field. The value goes to the Vault through connect-ai.ts and is
// cleared from this component at once; the chat only ever learns that a provider was connected.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { CapCall } from "../shell/session/caps.ts";
import { SignInPanel } from "../ai-signin/SignInPanel.tsx";
import { LOCAL_SIGNINS, SIGNIN_BUTTONS, localNote, onMacDevice, takeLocalSignin } from "../ai-signin/flow.ts";
import { API_KEYS, saveApiKey, startSubscription } from "./connect-ai.ts";
import type { SignInFlow } from "./connect-ai.ts";
import { Mark } from "./ProviderLogo.tsx";
import { Row } from "../../../../ui/src/Row/index.tsx";
import { checkKey } from "../ai-signin/key-prefix.ts";
import { CARD } from "./card-style.ts";
import type { AiHome } from "../ai-signin/own-ai.ts";
import { accountLine, afterRemoval } from "./connect-change.ts";
import type { AccountRow } from "./connect-change.ts";

export function ConnectAiCard({ call, connected, onConnected, onDisconnected, initialFlow, home = "here", local = false, mac = onMacDevice() }: { call: CapCall; connected?: boolean; onConnected(providerId: string): void; /** The last connected account was disconnected here: the step is open again. */ onDisconnected?(): void; /** Opens with this sign-in showing (screenshots and tests). */ initialFlow?: SignInFlow & { provider: string }; /** where the person's own key can be kept from here, for the words of a refusal (ai-signin/own-ai.ts) */ home?: AiHome; /** A Personal Space: offer the Claude Code or Codex sign-in already on this computer first (owner decision D2). */ local?: boolean; /** On a Mac the Claude button says the Keychain will ask once. */ mac?: boolean }): ReactElement {
  const attempt = useRef(globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
  const [mode, setMode] = useState<"tiles" | "key">("tiles");
  const [flow, setFlow] = useState<(SignInFlow & { provider: string }) | null>(initialFlow ?? null);
  const [provider, setProvider] = useState(API_KEYS[0]!.key);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // reopened after an account was connected: who is connected, a way to switch to another, a way to disconnect. `replacing` is the account a new sign-in takes the place of.
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [changing, setChanging] = useState(false);
  const [replacing, setReplacing] = useState<AccountRow | null>(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!connected) return undefined;
    let off = false;
    void Promise.resolve(call("providers.list", {})).then((r) => { if (!off) setAccounts(((r as { providers?: AccountRow[] }).providers ?? []).filter((a) => a.scope !== "shared")); }, () => { if (!off) setAccounts([]); });
    return () => { off = true; };
  }, [call, connected, changing]);
  // a new account is in: the one it replaces goes, so nothing is left half-connected; if that removal fails the new one stays and the card says so
  // the account is in, but can the engine run here? A sign-in whose program is missing or whose login needs doing again says so now, with the fix, before the first message fails
  const [held, setHeld] = useState<{ id: string; text: string; old: AccountRow | null } | null>(null);
  const problemOf = async (id: string): Promise<string> => {
    try {
      const mine = ((await call("providers.list", {})) as { providers?: AccountRow[] }).providers ?? [];
      const key = mine.find((x) => x.id === id)?.providerKey ?? "";
      const driver = key === "claude-code" ? "claude_code" : key;
      const eng = ((await call("engine.providers.list", {})) as { providers?: Array<{ driver: string; allowed: boolean; reason?: string }> }).providers ?? [];
      const row = eng.find((r) => r.driver === driver);
      return row && !row.allowed && row.reason ? row.reason : "";
    } catch { return ""; }
  };
  const settle = async (id: string, old: AccountRow | null): Promise<void> => {
    onConnected(id);
    if (old && old.id !== id) {
      try { await call("providers.remove", { providerId: old.id }); setNote(`Switched from ${accountLine(old)}.`); }
      catch (e) { setNote(`The new account is connected. ${accountLine(old)} could not be removed: ${e instanceof Error && e.message ? e.message : "That did not work."}`); }
    }
  };
  const connectedNew = async (id: string): Promise<void> => {
    const old = replacing;
    setReplacing(null); setChanging(false); setNote("");
    const trouble = await problemOf(id);
    if (trouble !== "") { setHeld({ id, text: trouble, old }); return; }
    await settle(id, old);
  };
  const disconnect = (a: AccountRow): void => void run(async () => {
    await call("providers.remove", { providerId: a.id });
    const left = (accounts ?? []).filter((x) => x.id !== a.id);
    setAccounts(left); setNote(`Disconnected ${accountLine(a)}.`);
    if (afterRemoval(left) === "reopen") onDisconnected?.();
  });
  const run = async (work: () => Promise<void>): Promise<void> => {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); }
  };
  if (held) {
    return (
      <View testID="ai-problem" style={s.col}>
        <Text accessibilityRole="alert" style={s.warn}>{held.text}</Text>
        <View style={s.row}>
          <Pressable testID="ai-pick-another" accessibilityRole="button" onPress={() => { setHeld(null); setChanging(true); }} style={s.ghost}><Text style={s.tileText}>Pick another AI</Text></Pressable>
          <Pressable testID="ai-continue-anyway" accessibilityRole="button" onPress={() => { const h = held; setHeld(null); void settle(h.id, h.old); }} style={s.ghost}><Text style={s.tileText}>Keep it anyway</Text></Pressable>
        </View>
      </View>
    );
  }
  if (connected && !changing) {
    const rows: ReactElement[] = [];
    for (const a of accounts ?? []) {
      rows.push(
        <View key={a.id} testID={`ai-account-${a.id}`} style={s.acct}>
          <Mark k={a.providerKey} size={18} />
          <Text style={s.acctName} numberOfLines={1}>{accountLine(a)}</Text>
          <Pressable testID={`ai-switch-${a.id}`} accessibilityRole="button" accessibilityLabel={`Switch ${accountLine(a)} to another account`} disabled={busy} onPress={() => { setReplacing(a); setChanging(true); setNote(""); setError(""); }} style={s.ghost}><Text style={s.tileText}>Switch</Text></Pressable>
          <Pressable testID={`ai-remove-${a.id}`} accessibilityRole="button" accessibilityLabel={`Disconnect ${accountLine(a)}`} disabled={busy} onPress={() => disconnect(a)} style={s.ghost}><Text style={s.tileText}>Disconnect</Text></Pressable>
        </View>,
      );
    }
    return (
      <View testID="ai-connected" style={s.col}>
        <Text style={s.ok}>AI account connected.</Text>
        {rows}
        {note ? <Text testID="ai-note" style={s.dim}>{note}</Text> : null}
        {error ? <Text testID="ai-error" style={s.err}>{error}</Text> : null}
        <Pressable testID="ai-change" accessibilityRole="link" onPress={() => { setChanging(true); setNote(""); }}><Text style={s.link}>Add or use a different account</Text></Pressable>
      </View>
    );
  }
  if (mode === "key") {
    const mismatch = checkKey(provider, secret, (k) => API_KEYS.find((o) => o.key === k)?.label ?? null);
    const rows: ReactElement[] = [];
    for (const o of API_KEYS) {
      const on = provider === o.key;
      rows.push(<Row key={o.key} id={`ai-provider-${o.key}`} title={o.label} note={o.help} selected={on} leading={<View style={s.lead}><Mark k={o.key} size={18} /></View>} onPress={() => setProvider(o.key)} domProps={{ role: "radio", "aria-checked": on }} />);
    }
    return (
      <View testID="ai-key-form" style={s.col}>
        <View testID="ai-provider-list" accessibilityRole="radiogroup" style={s.list}>{rows}</View>
        <TextInput testID="ai-key-field" secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" value={secret} onChangeText={setSecret} placeholder="Paste your API key" accessibilityLabel="API key" style={s.input} />
        {mismatch ? (
          <View testID="ai-key-mismatch" style={s.row}>
            <Text accessibilityRole="alert" style={s.warn}>{mismatch.line}</Text>
            {mismatch.suggest && API_KEYS.some((o) => o.key === mismatch.suggest) ? <Pressable testID="ai-key-switch" accessibilityRole="button" onPress={() => setProvider(mismatch.suggest!)}><Text style={s.link}>{`Use ${API_KEYS.find((o) => o.key === mismatch.suggest)!.label}`}</Text></Pressable> : null}
          </View>
        ) : null}
        <Text testID="ai-key-note" style={s.dim}>The key goes straight into your Vault. I never see it.</Text>
        {error ? <Text testID="ai-error" style={s.err}>{error}</Text> : null}
        <View style={s.row}>
          <Pressable testID="ai-key-save" accessibilityRole="button" disabled={busy || secret.trim() === ""} onPress={() => void run(async () => { const value = secret; setSecret(""); void connectedNew(await saveApiKey(call, provider, value, attempt.current, home)); })} style={[s.primary, (busy || secret.trim() === "") && s.off]}><Text style={[s.primaryText, (busy || secret.trim() === "") && s.offText]}>{busy ? "Saving" : "Save key"}</Text></Pressable>
          <Pressable testID="ai-back" accessibilityRole="button" onPress={() => { setSecret(""); setMode("tiles"); setError(""); }} style={s.ghost}><Text style={s.tileText}>Back</Text></Pressable>
        </View>
      </View>
    );
  }
  return (
    <View testID="ai-tiles" style={s.col}>
      {/* ui-rows-lint: not a list (sign-in choices are tiles, not list rows) */}
      {flow ? (
        <SignInPanel call={call as never} flow={flow} home={home} onCancel={() => { setFlow(null); setError(""); }} onDone={(p) => { setFlow(null); void connectedNew(p.id); }} />
      ) : (
        <View style={s.col}>
          {/* ui-rows-lint: not a list (sign-in choices are buttons, not list rows) */}
          {local ? LOCAL_SIGNINS.map((o) => {
            const note = localNote(o.key, mac);
            return (
              <View key={`local-${o.key}`} style={s.local}>
                <Pressable testID={`ai-local-${o.key}`} accessibilityRole="button" accessibilityLabel={o.button} {...(note ? { accessibilityHint: note } : {})} disabled={busy} onPress={() => void run(async () => connectedNew((await takeLocalSignin(call as never, o.key, `${attempt.current}:local:${o.key}:${Date.now()}`, home)).id))} style={[s.signin, busy && s.busyDim]}><Mark k={o.key} size={18} /><Text style={s.tileText}>{o.button}</Text></Pressable>
                {note ? <Text testID={`ai-local-note-${o.key}`} style={s.dim}>{note}</Text> : null}
              </View>
            );
          }) : null}
          {/* ui-rows-lint: not a list (sign-in choices are buttons, not list rows) */}
          {SIGNIN_BUTTONS.map((o) => (
            <Pressable key={o.key} testID={`ai-sub-${o.key}`} accessibilityRole="button" accessibilityLabel={o.button} disabled={busy} onPress={() => void run(async () => setFlow({ ...(await startSubscription(call, o.key, `${attempt.current}:${o.key}:${Date.now()}`, home)), provider: o.key }))} style={[s.signin, busy && s.busyDim]}><Mark k={o.key} size={18} /><Text style={s.tileText}>{o.button}</Text></Pressable>
          ))}
        </View>
      )}
      {error ? <Text testID="ai-error" style={s.err}>{error}</Text> : null}
      {connected ? <Pressable testID="ai-keep" accessibilityRole="link" onPress={() => { setChanging(false); setReplacing(null); setError(""); }}><Text style={s.link}>Keep what I have</Text></Pressable> : null}
      <Pressable testID="ai-use-key" accessibilityRole="link" onPress={() => { setMode("key"); setError(""); }}><Text style={s.link}>Use an API key instead</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 10 },
  local: { gap: 4 },
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
  off: CARD.off,
  offText: CARD.offText,
  busyDim: { opacity: 0.45 },
  warn: { flexShrink: 1, fontSize: 13, lineHeight: 18, color: "var(--warn)" as string },
  list: { borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, padding: 4, backgroundColor: "var(--win)" as string },
  lead: { marginRight: 10 },
  ghost: CARD.ghost,
  acct: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 40 },
  acctName: { flex: 1, fontSize: 14, color: "var(--ink)" as string },
  link: { fontSize: 13, color: "var(--accent)" as string },
});
