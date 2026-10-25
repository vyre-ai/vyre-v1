// The AI provider panel above an item's card (spec 3.8): how it connects, Mine or Shared, how it is doing, what it cost this month, and the agents and Automations that use it. Test connection
// asks the provider and says what came back. An API key can be shared and lets the Space use it; a subscription sign-in is yours and says so. Each action is one capability call; a refusal
// shows as a quiet line.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useVaultData, usePrincipals } from "../layout/data.tsx";
import type { Provider } from "../layout/model.ts";
import { Btn, Glyph } from "../layout/parts.tsx";
import { canShare, countWords, howConnected, scopeWords, stateWords, testWords, usageWords, userKind } from "./model.ts";

export interface ProviderPanelProps {
  provider: Provider;
  /** A quiet line for the place ("Removed Anthropic"). */
  onNote(text: string): void;
  /** The provider was removed; the place picks another row. */
  onRemoved(): void;
}

const STATE_COLOR = { ok: "var(--ok)", needs_sign_in: "var(--warn)", failing: "var(--danger)" } as const;

export function ProviderPanel({ provider, onNote, onRemoved }: ProviderPanelProps): ReactElement {
  const data = useVaultData();
  const people = usePrincipals();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [spaceMay, setSpaceMay] = useState(provider.spaceMayUse);
  const fail = (e: unknown): void => onNote(e instanceof Error ? e.message : "That did not work.");

  const test = async (): Promise<void> => {
    setTesting(true); setResult(null);
    try { setResult(testWords((await data.call("providers.test", { providerId: provider.id })) as { ok: boolean; models: string[]; latencyMs: number; detail?: string })); } catch (e) { fail(e); }
    setTesting(false);
  };
  const toggleSpace = async (): Promise<void> => {
    const allow = !spaceMay;
    try { await data.call("providers.set_space_use", { providerId: provider.id, allow }); setSpaceMay(allow); onNote(allow ? `The Space can use ${provider.name}` : `The Space no longer uses ${provider.name}`); } catch (e) { fail(e); }
  };
  const remove = async (): Promise<void> => {
    setAsking(false);
    try { await data.call("providers.remove", { providerId: provider.id }); onNote(`Removed ${provider.name}`); onRemoved(); } catch (e) { fail(e); }
  };

  return (
    <View style={s.panel} testID="provider-panel" accessibilityLabel={`${provider.name}, AI provider`}>
      <ScrollView style={s.scroll} contentContainerStyle={s.body}>
        <View style={s.facts}>
          <View style={s.fact}><Text style={s.k}>Connects with</Text><Text style={s.v} testID="provider-how">{howConnected(provider)}</Text></View>
          <View style={s.fact}><Text style={s.k}>Belongs to</Text><Text style={s.v} testID="provider-scope">{scopeWords(provider)}</Text></View>
          <View style={s.fact}><Text style={s.k}>Right now</Text><View style={s.state}><View style={[s.dot, { backgroundColor: STATE_COLOR[provider.state] as string }]} /><Text style={s.v} testID="provider-state">{stateWords(provider.state)}</Text></View></View>
          <View style={s.fact}><Text style={s.k}>This month</Text><Text style={s.v} testID="provider-usage">{usageWords(provider)}</Text></View>
        </View>

        <Text accessibilityRole="header" style={s.head}>{`Used by ${countWords(provider.agentsUsing.length, "agent or Automation", "agents and Automations")}`}</Text>
        {provider.agentsUsing.length === 0 ? <Text style={s.none} testID="provider-nobody">Nothing uses it yet.</Text> : provider.agentsUsing.map((id) => (
          <Row key={id} id={`use:${id}`} title={people.name(id)} note={userKind(id) === "automation" ? "Automation" : "Agent"} leading={<View style={s.face}><Avatar name={people.name(id)} kind={userKind(id)} size={24} /></View>}
            {...(userKind(id) === "agent" ? { trailing: <Glyph name="chevron" size={11} />, onPress: () => data.nav.openAgent(id) } : {})} />
        ))}

        <View style={s.acts}>
          <Btn label={testing ? "Testing" : "Test connection"} icon="check" onPress={() => void test()} disabled={testing} testID="provider-test" />
          {canShare(provider) ? <Btn label="Share" icon="share" onPress={() => data.nav.openShare(provider.itemId)} testID="provider-share" /> : null}
          {asking ? (
            <View style={s.ask}><Text style={s.askText}>{`Remove ${provider.name}?`}</Text><Btn label="Remove" danger onPress={() => void remove()} testID="provider-remove-yes" /><Btn label="Keep" onPress={() => setAsking(false)} testID="provider-remove-no" /></View>
          ) : <Btn label="Remove" danger onPress={() => setAsking(true)} testID="provider-remove" />}
        </View>
        {result ? <Text style={s.result} accessibilityLiveRegion="polite" testID="provider-result">{result}</Text> : null}

        {canShare(provider) ? (
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: spaceMay }} aria-checked={spaceMay} testID="provider-space" onPress={() => void toggleSpace()} style={s.switchRow}>
            <View style={{ flex: 1 }}><Text style={s.switchTitle}>The Space can use this key</Text><Text style={s.switchNote}>Automations and agents without a key of their own run on it.</Text></View>
            <View style={[s.track, spaceMay && s.trackOn]}><View style={[s.knob, spaceMay && s.knobOn]} /></View>
          </Pressable>
        ) : <Text style={s.note} testID="provider-private">A subscription sign-in stays yours. It follows you across Spaces and devices and cannot be shared.</Text>}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  panel: { maxHeight: 360, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  scroll: { flexGrow: 0 },
  body: { paddingHorizontal: 24, paddingTop: 14, paddingBottom: 14, gap: 4 },
  facts: { flexDirection: "row", flexWrap: "wrap", columnGap: 28, rowGap: 10, paddingBottom: 10 },
  fact: { minWidth: 120, gap: 2 },
  k: { fontSize: 11.5, color: "var(--ink-3)" as string },
  v: { fontSize: 13, color: "var(--ink)" as string },
  state: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 99 },
  head: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, paddingTop: 6, paddingBottom: 2 },
  none: { fontSize: 13, color: "var(--ink-3)" as string, paddingVertical: 6 },
  face: { marginRight: 10 },
  acts: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4, paddingTop: 10, marginLeft: -10 },
  ask: { flexDirection: "row", alignItems: "center", gap: 4 },
  askText: { fontSize: 13, color: "var(--ink-2)" as string, paddingHorizontal: 6 },
  result: { fontSize: 12.5, color: "var(--ink-2)" as string, paddingTop: 4 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 12 },
  switchTitle: { fontSize: 13, color: "var(--ink)" as string },
  switchNote: { fontSize: 12, color: "var(--ink-3)" as string },
  track: { width: 34, height: 20, borderRadius: 99, backgroundColor: "var(--line-2)" as string, justifyContent: "center", paddingHorizontal: 2 },
  trackOn: { backgroundColor: "var(--accent)" as string },
  knob: { width: 16, height: 16, borderRadius: 99, backgroundColor: "var(--raised)" as string },
  knobOn: { alignSelf: "flex-end" },
  note: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingTop: 12 },
});
