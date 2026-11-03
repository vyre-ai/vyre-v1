// Add or change a Browser connection: the site, where it runs (My Chrome, agent computers, or both), and for each agent No access, Read only or Act. A send, a post, a payment and a delete are always
// held for the person, and the sheet says so. Remove is on the row's menu and here when editing.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useVaultData } from "../layout/data.tsx";
import { Btn, Glyph } from "../layout/parts.tsx";
import { Sheet } from "../layout/Sheet.tsx";
import { attemptKey, messageOf } from "./actions.ts";
import { ALWAYS_HELD, RIGHTS, RUNS, draftOf, emptyDraft, inputOf } from "./browser.ts";
import type { BrowserSite, Draft, Right, RunsIn } from "./browser.ts";

export interface SheetAgent { id: string; name: string }

export function BrowserSheet({ site, agents, onClose, onSaved }: { site: BrowserSite | null; agents: readonly SheetAgent[]; onClose(): void; onSaved(text: string): void }): ReactElement {
  const data = useVaultData();
  const [d, setD] = useState<Draft>(site ? draftOf(site) : emptyDraft());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const plan = inputOf(d);
  const save = async (): Promise<void> => {
    if (!plan.ok) { setError(plan.why); return; }
    setBusy(true);
    try {
      await data.call("browser.sites.set", { ...plan.input, idempotencyKey: attemptKey() });
      onSaved(site ? `Saved ${plan.input.host}` : `Added ${plan.input.host}`);
    } catch (e) { setError(messageOf(e)); setBusy(false); }
  };
  const remove = async (): Promise<void> => {
    if (!site) return;
    setBusy(true);
    try { await data.call("browser.sites.remove", { siteId: site.id }); onSaved(`Removed ${site.host}`); } catch (e) { setError(messageOf(e)); setBusy(false); }
  };
  const seg = <T extends string>(items: ReadonlyArray<{ key: T; label: string }>, value: T, pick: (k: T) => void, id: string): ReactElement => (
    <View style={s.segs} accessibilityRole="radiogroup">
      {/* ui-rows-lint: not a list (the choices of a segmented control) */}
      {items.map((i) => (
        <Pressable key={i.key} accessibilityRole="radio" accessibilityState={{ checked: value === i.key }} onPress={() => pick(i.key)} style={[s.seg, value === i.key && s.segOn]} testID={`${id}-${i.key}`}>
          <Text style={[s.segText, value === i.key && s.segTextOn]}>{i.label}</Text>
        </Pressable>
      ))}
    </View>
  );
  return (
    <Sheet
      title={site ? `Browser: ${site.host}` : "Add a site"} onClose={onClose} testID="browser-sheet"
      footer={<>{site ? <Btn label="Remove" danger onPress={() => { void remove(); }} disabled={busy} testID="browser-remove" /> : null}<View style={{ flex: 1 }} /><Btn label="Cancel" onPress={onClose} /><Btn label={busy ? "Saving…" : "Save"} primary disabled={busy || !plan.ok} why={!plan.ok ? plan.why : undefined} onPress={() => { void save(); }} testID="browser-save" /></>}
    >
      <View style={{ gap: 4 }}>
        <Text style={s.label}>Site</Text>
        <TextInput placeholderTextColor="var(--ink-4)" value={d.host} onChangeText={(v) => setD((x) => ({ ...x, host: v }))} editable={!site} placeholder="app.gohighlevel.com" accessibilityLabel="Site" autoCapitalize="none" autoCorrect={false} style={s.input} testID="browser-host" />
      </View>
      <View style={{ gap: 4 }}>
        <Text style={s.label}>Runs in</Text>
        {seg<RunsIn>(RUNS, d.runsIn, (k) => setD((x) => ({ ...x, runsIn: k })), "browser-runs")}
        <Text style={s.quiet}>{d.runsIn === "chrome" ? "Agents use the Chrome you are signed in to, with your logins." : d.runsIn === "computers" ? "Agents use their own computer's browser, with their own logins." : "Agents may use either one."}</Text>
      </View>
      <View style={{ gap: 6 }}>
        <Text style={s.label}>What each agent may do here</Text>
        {agents.length === 0 ? <Text style={s.quiet}>You have no agents yet.</Text> : agents.map((a) => (
          <Row key={a.id} id={`browser-agent-${a.id}`} title={a.name} trailing={seg<Right>(RIGHTS, d.rights[a.id] ?? "off", (k) => setD((x) => ({ ...x, rights: { ...x.rights, [a.id]: k } })), `browser-right-${a.id}`)} />
        ))}
      </View>
      <View style={s.held}><Glyph name="lock" /><Text style={s.quiet}>{ALWAYS_HELD}</Text></View>
      {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
    </Sheet>
  );
}

const s = StyleSheet.create({
  segs: { flexDirection: "row", padding: 2, borderRadius: 8, backgroundColor: "var(--sel)" as string, alignSelf: "flex-start" },
  seg: { paddingHorizontal: 12, height: 26, justifyContent: "center", borderRadius: 6 },
  segOn: { backgroundColor: "var(--raised)" as string, boxShadow: "0 1px 2px rgba(0,0,0,0.12)" as string },
  segText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  segTextOn: { color: "var(--ink)" as string, fontWeight: "500" },
  label: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  input: { minHeight: 32, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 6, color: "var(--ink)" as string, backgroundColor: "var(--win)" as string, fontSize: 13 },
  agent: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  agentName: { width: 120, fontSize: 13, color: "var(--ink)" as string },
  held: { flexDirection: "row", alignItems: "center", gap: 8 },
  quiet: { fontSize: 12.5, color: "var(--ink-3)" as string, flexShrink: 1 },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
});
