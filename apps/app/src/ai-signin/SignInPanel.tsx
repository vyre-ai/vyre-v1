// What the person sees after pressing Sign in: the link to open (with a copy fallback), the code to type when the provider shows one, the field for the code the provider shows when it asks for one back,
// and a line that says the page finishes by itself. It polls only for a sign-in that needs no pasted code.
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ViewStyle } from "react-native";
import { GIVE_UP_MS, POLL_MS, checkFlow, nextLine, pastedCode, safeLink } from "./flow.ts";
import type { Call, Flow } from "./flow.ts";

async function copy(text: string): Promise<boolean> {
  try { const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator; if (!nav?.clipboard) return false; await nav.clipboard.writeText(text); return true; } catch { return false; }
}

/** A turning ring: the accent over the hairline. Still for a person who asks for reduced motion. */
function Ring(): ReactElement {
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const style: ViewStyle = { width: 18, height: 18, borderRadius: 9, borderWidth: 2.5, borderColor: "var(--line-2)" as string, borderTopColor: "var(--accent)" as string };
  if (Platform.OS === "web" && !still) Object.assign(style, { animationKeyframes: [{ from: { transform: [{ rotate: "0deg" }] }, to: { transform: [{ rotate: "360deg" }] } }], animationDuration: "900ms", animationIterationCount: "infinite", animationTimingFunction: "linear" });
  return <View accessible={false} style={style} />;
}

export interface SignInPanelProps {
  call: Call;
  flow: Flow;
  /** The account is saved. */
  onDone(provider: { id: string } & Record<string, unknown>): void;
  onCancel(): void;
}

export function SignInPanel({ call, flow, onDone, onCancel }: SignInPanelProps): ReactElement {
  const link = safeLink(flow.url);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const alive = useRef(true);
  const started = useRef(Date.now());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // a sign-in that needs no pasted code finishes when the person approves: ask every few seconds
  useEffect(() => {
    if (flow.needsCode) return;
    let stop = false;
    const tick = async (): Promise<void> => {
      if (stop || !alive.current) return;
      if (Date.now() - started.current > GIVE_UP_MS) { setError("The sign-in took too long and was closed. Start again."); return; }
      try {
        const r = await checkFlow(call, flow.flowId);
        if (stop || !alive.current) return;
        if (r.state === "done") { onDone(r.provider); return; }
      } catch (e) { if (!stop && alive.current) setError(e instanceof Error ? e.message : "The sign-in did not finish."); return; }
      setTimeout(() => { void tick(); }, POLL_MS);
    };
    const t = setTimeout(() => { void tick(); }, POLL_MS);
    return () => { stop = true; clearTimeout(t); };
  }, [flow.flowId, flow.needsCode]);   // eslint-disable-line react-hooks/exhaustive-deps
  const finish = async (): Promise<void> => {
    const c = pastedCode(code);
    if (!c) { setError("Paste the whole code the page shows."); return; }
    setBusy(true); setError("");
    try {
      const r = await checkFlow(call, flow.flowId, c);
      if (!alive.current) return;
      if (r.state === "done") onDone(r.provider); else setError("Still waiting. Check the code and try again.");
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "The sign-in did not finish."); }
    finally { if (alive.current) setBusy(false); }
  };
  return (
    <View style={s.col} testID="signin-panel">
      <Text style={s.body} testID="signin-line">{nextLine(flow)}</Text>
      {flow.userCode ? <Text style={s.code} selectable testID="signin-usercode" accessibilityLabel={`Code ${flow.userCode}`}>{flow.userCode}</Text> : null}
      {link ? (
        <View style={s.row}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open the sign-in" testID="signin-open" onPress={() => { void Linking.openURL(link); }} style={s.primary}><Text style={s.primaryText}>Open the sign-in</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Copy the link" testID="signin-copy" onPress={() => { void copy(link).then((ok) => setNote(ok ? "Link copied. Paste it into any browser." : "Select the link and copy it.")); }} style={s.ghost}><Text style={s.ghostText}>Copy link</Text></Pressable>
        </View>
      ) : <Text style={s.err} testID="signin-nolink">The provider gave no sign-in address. Try again, or use an API key.</Text>}
      {note ? <Text style={s.dim} testID="signin-note">{note}</Text> : null}
      {flow.needsCode ? (
        <View style={s.col}>
          <TextInput value={code} onChangeText={setCode} placeholder="Paste the code from the page" autoCapitalize="none" autoCorrect={false} autoComplete="off" accessibilityLabel="Sign-in code" testID="signin-code" style={s.input} />
          <View style={s.row}>
            <Pressable accessibilityRole="button" accessibilityLabel="Finish sign-in" testID="signin-finish" disabled={busy || code.trim() === ""} onPress={() => { void finish(); }} style={[s.primary, (busy || code.trim() === "") && s.off]}><Text style={s.primaryText}>{busy ? "Finishing" : "Finish"}</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel sign-in" testID="signin-cancel" onPress={onCancel} style={s.ghost}><Text style={s.ghostText}>Cancel</Text></Pressable>
          </View>
        </View>
      ) : (
        <View style={s.row}>
          <View style={s.wait}><Ring /><Text style={s.dim} testID="signin-waiting">Waiting for you</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel sign-in" testID="signin-cancel" onPress={onCancel} style={s.ghost}><Text style={s.ghostText}>Cancel</Text></Pressable>
        </View>
      )}
      {error ? <Text style={s.err} accessibilityRole="alert" testID="signin-error">{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  body: { fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  code: { alignSelf: "flex-start", fontSize: 22, letterSpacing: 2, fontWeight: "600", color: "var(--ink)" as string, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: "var(--sunk)" as string, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  dim: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  err: { fontSize: 13, lineHeight: 18, color: "var(--danger)" as string },
  input: { height: 40, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: "var(--line-2)" as string, color: "var(--ink)" as string, fontSize: 14, backgroundColor: "var(--win)" as string },
  primary: { height: 40, paddingHorizontal: 18, borderRadius: 10, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 13.5, fontWeight: "500", color: "var(--accent-ink)" as string },
  ghost: { height: 40, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: "var(--line-2)" as string, alignItems: "center", justifyContent: "center" },
  ghostText: { fontSize: 13.5, color: "var(--ink)" as string },
  off: { opacity: 0.45 },
  wait: { flexDirection: "row", alignItems: "center", gap: 10, marginRight: 8 },
});
