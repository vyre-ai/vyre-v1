// Talk's place in the shell. It sits above every place, gives each composer the mic through context, and holds the one first-press sheet. A native app has no web microphone, so it gives no port there.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import { TalkContext } from "../../../../../ui/src/Composer/index.tsx";
import type { TalkPort } from "../../../../../ui/src/Composer/index.tsx";
import { attemptKey } from "../providers/files-review.ts";
import type { ShellRuntime } from "../providers/runtime.tsx";

export type TalkStatus = CapMap["talk.status"]["out"];
export type KeyScope = "mine" | "space";
const web = Platform.OS === "web";
export const keyFields = (value: string): { key: string; value: string; secret: boolean }[] => [{ key: "api_key", value, secret: true }];
const NOTICE = "Goes straight to your Vault, never into a chat.";
const SPACE_NOTICE = "Goes straight to this Space's Vault. People can talk through it and can never read it.";

/** Who may see the choice of scope: someone who may run the Space, in a Space that has other people. */
export const offersSpace = (status: TalkStatus | null, personal: boolean): boolean => status?.mayManage === true && !personal;

export function TalkSheet({ rt, status, only, onDone, onCancel }: { rt: ShellRuntime; status: TalkStatus | null; only?: KeyScope; onDone(): void; onCancel(): void }): ReactElement {
  const personal = rt.space.kind === "personal";
  const choose = only === undefined && offersSpace(status, personal);
  const [scope, setScope] = useState<KeyScope>(only ?? (choose ? "space" : "mine"));
  // the typed key lives here and nowhere else, and goes once to the one call that keeps it in the Vault
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  const provider = status?.providers.find((p) => p.key === status.provider) ?? status?.providers[0];
  const name = provider?.name ?? "Deepgram";
  const turnOn = async (): Promise<void> => {
    if (value.trim() === "" || busy || !provider) return;
    setBusy(true); setLine(null);
    try {
      await rt.call(scope === "space" ? "talk.space.connect" : "talk.connect", { provider: provider.key, fields: keyFields(value), idempotencyKey: attemptKey() });
      setValue("");
      onDone();
    } catch (e) {
      const locked = (e as { details?: { reason?: string } }).details?.reason === "vault_locked";
      setLine(locked ? "Your own key needs your Vault unlocked on this computer. An admin can turn on Talk for everyone instead." : e instanceof Error && e.message ? e.message : `Could not reach ${name}. Try again.`);
      setBusy(false);
    }
  };
  return (
    <Dialog title="Turn on Talk" width={400} fill onClose={onCancel} testID="talk-sheet" actions={[
      { label: "Not now", onPress: onCancel, testID: "talk-cancel" },
      { label: busy ? "Checking" : "Turn on", primary: true, disabled: value.trim() === "" || busy, why: "Paste the key first", onPress: () => void turnOn(), testID: "talk-turn-on" },
    ]}>
      <Text style={s.lead}>Speak and your words land in the message. Nothing sends until you press Send.</Text>
      <View style={s.provider} testID="talk-provider"><Text style={s.provName}>{name}</Text><Text style={s.provNote}>Transcription</Text></View>
      {choose ? (
        <View accessibilityRole="radiogroup" accessibilityLabel="Who this key covers" style={s.scopes}>
          {/* ui-rows-lint: not a list (two choices of one value) */}
          {([["space", "For everyone in this Space", "People just press the mic"], ["mine", "Just me", "Your own key"]] as const).map(([key, title, note]) => (
            <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: scope === key }} accessibilityLabel={title} testID={`talk-scope-${key}`} onPress={() => setScope(key)} style={[s.scope, scope === key && s.scopeOn]}>
              <View style={[s.dot, scope === key && s.dotOn]} /><View style={s.scopeText}><Text style={s.scopeTitle}>{title}</Text><Text style={s.provNote}>{note}</Text></View>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text style={s.label}>{`${name} key`}</Text>
      <TextInput
        accessibilityLabel={`${name} key`} placeholder="Paste your key" placeholderTextColor="var(--ink-4)" secureTextEntry autoComplete="off" autoCorrect={false} autoCapitalize="none" spellCheck={false}
        value={value} onChangeText={(v) => { setValue(v); setLine(null); }} onSubmitEditing={() => void turnOn()} testID="talk-key" style={s.input} {...(web ? { dataSet: { lpignore: "true", "1pIgnore": "true" } } as object : {})}
      />
      <Text style={s.hint}>{scope === "space" ? SPACE_NOTICE : NOTICE}</Text>
      {provider ? <Pressable accessibilityRole="link" testID="talk-get-key" onPress={() => rt.openUrl(provider.keyUrl)}><Text style={s.link}>{`Get a key from ${name}. It needs the Member role.`}</Text></Pressable> : null}
      {!choose && only === undefined && !personal ? <Text style={s.hint} testID="talk-admin-note">An admin can turn this on for everyone.</Text> : null}
      <Text style={s.error} testID="talk-error" accessibilityRole={line ? "alert" : "text"}>{line ?? ""}</Text>
    </Dialog>
  );
}

export function TalkHost({ rt, children }: { rt: ShellRuntime | null; children: ReactNode }): ReactElement {
  const [status, setStatus] = useState<TalkStatus | null>(null);
  const [off, setOff] = useState(false);
  const [sheet, setSheet] = useState<{ only?: KeyScope } | null>(null);
  const settle = useRef<((saved: boolean) => void) | null>(null);
  const refresh = useCallback(async (): Promise<TalkStatus | null> => {
    if (!rt) return null;
    try { const out = (await rt.call("talk.status", {})) as TalkStatus; setStatus(out); setOff(!out.on); return out; }
    catch { return null; }   // a server that cannot say keeps the mic; the press says what is wrong
  }, [rt]);
  useEffect(() => { void refresh(); }, [refresh]);
  const close = useCallback((saved: boolean) => {
    const done = settle.current;
    settle.current = null;
    setSheet(null);
    if (saved) void refresh();
    done?.(saved);
  }, [refresh]);
  useEffect(() => () => { settle.current?.(false); settle.current = null; }, []);
  const port = useMemo<TalkPort | null>(() => (rt && web ? {
    on: !off,
    session: async () => (await rt.call("talk.session", {})) as CapMap["talk.session"]["out"],
    setup: async (only) => {
      await refresh();
      settle.current?.(false);
      return new Promise<boolean>((resolve) => { settle.current = resolve; setSheet(only ? { only } : {}); });
    },
    noteOff: () => setOff(true),
    refresh: async () => { await refresh(); },
  } : null), [rt, off, refresh]);
  return (
    <TalkContext.Provider value={port}>
      {children}
      {sheet && rt ? <TalkSheet rt={rt} status={status} {...(sheet.only ? { only: sheet.only } : {})} onDone={() => close(true)} onCancel={() => close(false)} /> : null}
    </TalkContext.Provider>
  );
}

const s = StyleSheet.create({
  lead: { fontSize: 13.5, lineHeight: 20, color: "var(--ink-3)" as string, marginBottom: 12 },
  provider: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  provName: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  provNote: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  scopes: { marginTop: 10, gap: 6 },
  scope: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string },
  scopeOn: { borderColor: "var(--accent-line)" as string },
  scopeText: { flex: 1, minWidth: 0 },
  scopeTitle: { fontSize: 13.5, color: "var(--ink)" as string },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: "var(--line-2)" as string },
  dotOn: { borderWidth: 4, borderColor: "var(--accent)" as string },
  label: { marginTop: 14, marginBottom: 6, fontSize: 12.5, color: "var(--ink-3)" as string },
  input: { height: 38, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--sunk)" as string, color: "var(--ink)" as string, fontSize: 14 },
  hint: { marginTop: 7, fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  link: { marginTop: 3, fontSize: 12, lineHeight: 17, color: "var(--ink-2)" as string, textDecorationLine: "underline" },
  error: { minHeight: 18, marginTop: 8, fontSize: 12.5, lineHeight: 18, color: "var(--danger)" as string },
});
