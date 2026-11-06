// The question island: an agent's open question docked to the top of the composer, with its own space (never over the messages). The agent's face, the question, the first answer as the one primary
// action, Other (the rest of the answers and a box for words), the people icon (who is in this chat), dismiss, and "1 of 3" with arrows when more than one waits. It shows the newest open question
// of this chat; answering sends chat.answer_block and the next one shows.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { IconButton, TextButton } from "./parts.tsx";
import { Face } from "../needsyou/parts.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { OpenQuestion } from "./island.ts";

export interface QuestionIslandProps {
  list: readonly OpenQuestion[];
  index: number;
  nameOf(id: string): string;
  onStep(delta: 1 | -1): void;
  onAnswer(q: OpenQuestion, answer: string): void;
  onDismiss(q: OpenQuestion): void;
  /** The people icon: who is in this chat. */
  onPeople(x: number, y: number): void;
}

export function QuestionIsland({ list, index, nameOf, onStep, onAnswer, onDismiss, onPeople }: QuestionIslandProps): ReactElement | null {
  const q = list[index];
  const menu = useMenu();
  const [writing, setWriting] = useState<string | null>(null);
  const [text, setText] = useState("");
  if (!q) return null;
  // two answers are two buttons, the first the primary one (the prototype's "12 px" and "14 px"); more than two, the first is the button and the rest wait under Other
  const shown = q.options.length <= 2 ? q.options : q.options.slice(0, 1);
  const [first] = shown;
  const rest = q.options.slice(shown.length);
  const send = (answer: string): void => { setWriting(null); setText(""); onAnswer(q, answer); };
  const otherEntries = (): MenuEntry[] => [
    ...rest.map((o): MenuEntry => ({ label: o.label, onSelect: () => send(o.id) })),
    ...(rest.length > 0 ? [{ separator: true } as MenuEntry] : []),
    { label: "Write an answer…", onSelect: () => setWriting(q.id) },
  ];
  const own = writing === q.id;
  return (
    <View testID="question-island" accessibilityLabel={`${nameOf(q.agentId)} asks: ${q.prompt}`} accessibilityRole="alert" style={st.island}>
      {menu.element}
      <View style={st.row}>
        <Face name={nameOf(q.agentId)} seedId={q.agentId} kind="agent" size={24} />
        <Text testID="island-question" numberOfLines={2} style={st.q}>{q.prompt}</Text>
        {list.length > 1 ? (
          <View style={st.count} testID="island-count">
            <IconButton icon="back" label="Previous question" size={22} testID="island-prev" onPress={() => onStep(-1)} />
            <Text style={st.countText}>{`${index + 1} of ${list.length}`}</Text>
            <IconButton icon="chev" label="Next question" size={22} testID="island-next" onPress={() => onStep(1)} />
          </View>
        ) : null}
        {first && !own ? <TextButton label={first.label} primary testID="island-primary" onPress={() => send(first.id)} /> : null}
        {/* ui-rows-lint: not a list (the answer buttons of one question, side by side) */}
        {!own ? shown.slice(1).map((o) => <TextButton key={o.id} label={o.label} testID={`island-option-${o.id}`} onPress={() => send(o.id)} />) : null}
        {!own && q.options.length > 2 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Other answers" testID="island-other" style={({ hovered }: { hovered?: boolean }) => [st.other, hovered === true && st.otherOver]}
            onPress={(e) => { const r = (e as unknown as { currentTarget?: { getBoundingClientRect?: () => { left: number; top: number } } }).currentTarget?.getBoundingClientRect?.(); menu.show(otherEntries(), r?.left ?? 0, r?.top ?? 0, "other", { label: "Other answers" }); }}>
            <Text style={st.otherText}>Other</Text>
          </Pressable>
        ) : null}
        <IconButton icon="people" label="Who is in this chat" size={26} testID="island-people" onPress={onPeople} />
        <IconButton icon="x" label="Put this question away" size={26} testID="island-dismiss" onPress={() => onDismiss(q)} />
      </View>
      {own ? (
        <View style={st.write}>
          <TextInput autoFocus value={text} onChangeText={setText} placeholder="Your answer" accessibilityLabel="Your answer" testID="island-input" style={st.input}
            onSubmitEditing={() => { if (text.trim() !== "") send(text.trim()); }} onKeyPress={(e) => { if ((e.nativeEvent as { key?: string }).key === "Escape") setWriting(null); }} />
          <TextButton label="Send" primary testID="island-send" onPress={() => { if (text.trim() !== "") send(text.trim()); }} />
          <TextButton label="Cancel" testID="island-cancel" onPress={() => setWriting(null)} />
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  island: { width: "100%", marginBottom: 8, paddingVertical: 8, paddingLeft: 14, paddingRight: 8, gap: 8, borderRadius: 12, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-2), inset 0 0 0 1px var(--line), inset 3px 0 0 var(--warn)" } as object,
  row: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32, flexWrap: "wrap" },
  q: { flex: 1, minWidth: 160, fontSize: 14, lineHeight: 20, color: "var(--ink)" as string },
  other: { height: 32, paddingHorizontal: 12, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  otherOver: { backgroundColor: "var(--hover)" as string },
  otherText: { fontSize: 13, color: "var(--ink-2)" as string },
  count: { flexDirection: "row", alignItems: "center", gap: 2 },
  countText: { fontSize: 12, color: "var(--ink-3)" as string },
  write: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  input: { flex: 1, minWidth: 160, height: 32, paddingHorizontal: 10, borderRadius: 12, fontSize: 14, color: "var(--ink)" as string, backgroundColor: "var(--sunk)" as string },
});
