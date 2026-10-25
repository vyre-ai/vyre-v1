// Undo this run (spec 2.13): before anything changes, say what would be reversed and what cannot be (a sent message, a deployment, a record changed since the run). The person
// confirms inside the chat, never in a dialog; nothing is undone until the red button is pressed, and a run with nothing to reverse cannot be undone.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SKIP_WORDS, plural, undoSummary } from "./model.ts";
import type { UndoPreview } from "./model.ts";
import { QuietButton } from "./parts.tsx";
import { each } from "./each.ts";

export type UndoViewState = { phase: "loading" } | { phase: "ready"; preview: UndoPreview };
const SHOWN = 4;

export function UndoPanel({ state, onConfirm, onCancel }: { state: UndoViewState; onConfirm(): void; onCancel(): void }): ReactElement {
  if (state.phase === "loading") {
    return <View style={u.panel} testID="undo-panel" accessibilityLabel="Undo this run"><Text style={u.text}>Looking at what this run changed…</Text></View>;
  }
  const p = state.preview;
  return (
    <View style={u.panel} testID="undo-panel" accessibilityLabel="Undo this run">
      <Text style={u.head}>Undo what this run changed?</Text>
      <Text style={u.text}>{undoSummary(p)}</Text>
      {each(p.undone.slice(0, SHOWN), (x) => <Text key={x.eventId} style={u.li}>{`•  ${x.summary}`}</Text>)}
      {p.undone.length > SHOWN ? <Text style={u.dim}>{`and ${plural(p.undone.length - SHOWN, "more change")}`}</Text> : null}
      {each(p.skipped, (x) => <Text key={x.eventId} style={u.dim}>{`•  ${x.summary} (${SKIP_WORDS[x.reason].toLowerCase()}, stays)`}</Text>)}
      <View style={u.acts}>
        <QuietButton label="Undo this run" icon="undo" tone="danger" disabled={p.undone.length === 0} testID="confirm-undo" onPress={onConfirm} />
        <QuietButton label="Cancel" testID="cancel-undo" onPress={onCancel} />
      </View>
    </View>
  );
}

const u = StyleSheet.create({
  panel: { marginHorizontal: 14, marginBottom: 10, padding: 12, borderRadius: 10, backgroundColor: "var(--sunk)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string, gap: 4 },
  head: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  text: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  li: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string, paddingLeft: 4 },
  dim: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string, paddingLeft: 4 },
  acts: { flexDirection: "row", gap: 6, marginTop: 6 },
});
