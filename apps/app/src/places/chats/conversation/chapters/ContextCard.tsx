// The /context card (G44, prototype code case 'ctx'): the context and the limits as meters, then two buttons. Compact opens a field, "What should it keep? Optional", a "Keep this every time" box and the
// Compact button; the server (engine.compact) compacts, says so in the chat in one line, and with the box ticked keeps the words for every compaction of this chat. What it knows opens the memory pane.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { Usage } from "./SessionBlock.tsx";

export interface Meter {
  key: string;
  label: string;
  /** 0 to 100. */
  pct: number;
}

/** The meters the card shows from what engine.usage.get said: the context, the provider's session limit and the week. */
export function metersOf(u: Usage): Meter[] {
  return [
    ...(u.context !== null ? [{ key: "context", label: "Context", pct: u.context }] : []),
    ...(u.session !== null ? [{ key: "session", label: "This session's limit", pct: u.session }] : []),
    ...(u.plan !== null ? [{ key: "week", label: "Plan this week", pct: u.plan }] : []),
  ];
}

export interface ContextCardProps {
  meters: readonly Meter[];
  /** Words kept for every compaction of this chat, if any. */
  keepEvery?: string;
  /** Compact now. Resolves when the server has said so in the chat. */
  onCompact(keep: string, always: boolean): Promise<void>;
  /** Open what the agent knows (the memory pane). */
  onKnows?(): void;
}

export function ContextCard({ meters, keepEvery, onCompact, onKnows }: ContextCardProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [keep, setKeep] = useState("");
  const [always, setAlways] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = (): void => {
    if (busy) return;
    setBusy(true);
    void onCompact(keep.trim(), always).then(
      () => {
        setBusy(false);
        setOpen(false);
        setKeep("");
      },
      () => setBusy(false),
    );
  };
  return (
    <View testID="context-card" style={st.card}>
      <Text accessibilityRole="header" style={st.title}>
        Context
      </Text>
      {meters.map((m) => (
        <View key={m.key} testID={`context-meter-${m.key}`} style={st.meter}>
          <View style={st.meterHead}>
            <Text style={st.label}>{m.label}</Text>
            <Text style={st.value}>{`${Math.round(m.pct)}%`}</Text>
          </View>
          <View style={st.track}>
            <View style={[st.fill, { width: `${Math.max(0, Math.min(100, m.pct))}%` }]} />
          </View>
        </View>
      ))}
      {keepEvery ? (
        <Text testID="context-keep-every" style={st.note}>{`Every compaction keeps: ${keepEvery}`}</Text>
      ) : null}
      {open ? (
        <View style={st.form}>
          <TextInput
            testID="context-keep"
            accessibilityLabel="What should it keep?"
            placeholder="What should it keep? Optional"
            value={keep}
            onChangeText={setKeep}
            onSubmitEditing={go}
            autoFocus
            style={st.input}
          />
          <Pressable
            testID="context-always"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: always }}
            onPress={() => setAlways((a) => !a)}
            style={st.check}
          >
            <View style={[st.box, always && st.boxOn]} />
            <Text style={st.label}>Keep this every time</Text>
          </Pressable>
          <View style={st.buttons}>
            <Pressable testID="context-go" accessibilityRole="button" onPress={go} style={[st.btn, st.primary]}>
              <Text style={st.primaryText}>{busy ? "Compacting" : "Compact"}</Text>
            </Pressable>
            <Pressable testID="context-cancel" accessibilityRole="button" onPress={() => setOpen(false)} style={st.btn}>
              <Text style={st.btnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={st.buttons}>
          <Pressable testID="context-open" accessibilityRole="button" onPress={() => setOpen(true)} style={st.btn}>
            <Text style={st.btnText}>Compact</Text>
          </Pressable>
          {onKnows ? (
            <Pressable testID="context-knows" accessibilityRole="button" onPress={onKnows} style={st.btn}>
              <Text style={st.btnText}>What it knows</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: {
    maxWidth: 520,
    marginVertical: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
    gap: 10,
  },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  meter: { gap: 4 },
  meterHead: { flexDirection: "row", justifyContent: "space-between" },
  label: { fontSize: 13, color: "var(--ink-2)" as string },
  value: { fontSize: 13, color: "var(--ink)" as string },
  track: { height: 4, borderRadius: 2, backgroundColor: "var(--hover)" as string, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2, backgroundColor: "var(--accent)" as string },
  note: { fontSize: 12.5, color: "var(--ink-3)" as string },
  form: { gap: 10 },
  input: {
    fontSize: 14,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "var(--line)" as string,
    color: "var(--ink)" as string,
  },
  check: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  box: { width: 16, height: 16, borderRadius: 4, borderWidth: 1, borderColor: "var(--ink-3)" as string },
  boxOn: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  buttons: { flexDirection: "row", gap: 8 },
  btn: {
    minHeight: 32,
    paddingHorizontal: 14,
    borderRadius: 10,
    justifyContent: "center",
    backgroundColor: "var(--hover)" as string,
  },
  btnText: { fontSize: 13, color: "var(--ink)" as string },
  primary: { backgroundColor: "var(--accent)" as string },
  primaryText: { fontSize: 13, color: "var(--on-accent, #fff)" as string },
});
