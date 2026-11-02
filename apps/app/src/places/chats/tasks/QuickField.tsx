// The one line a task is typed in (quick add on Tasks, a subtask on a task's page): typing @ lists the people and agents of the Space under it, as a comment or a chat does. Up and Down move, Enter or
// Tab picks, Escape hides the list, a click picks too. A pick writes the word quick.ts reads back (their username, else the first word of their name), so the task is assigned to who was picked.
import { forwardRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import type { QuickPerson } from "./quick.ts";

/** The @word being typed at the end of the text, or null. */
export function atQuery(text: string): { at: number; query: string } | null {
  const m = /(^|\s)@([^\s@]{0,40})$/.exec(text);
  return m ? { at: text.length - m[2]!.length - 1, query: m[2]! } : null;
}

/** Who matches the @word: people first, then agents, a word of the name or the username starting with it; at most six. */
export function atMatches(people: readonly QuickPerson[], query: string): QuickPerson[] {
  const q = query.toLowerCase();
  const hit = (p: QuickPerson): boolean => q === "" || p.username?.toLowerCase().startsWith(q) === true || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q));
  return people.filter(hit).sort((a, b) => Number(a.kind === "agent") - Number(b.kind === "agent")).slice(0, 6);
}

/** The text with the half-typed @word replaced by the word quick add reads for this person. */
export function atInsert(text: string, p: QuickPerson): string {
  const q = atQuery(text);
  const word = p.username ?? p.name.split(/\s+/)[0] ?? p.name;
  return q ? `${text.slice(0, q.at)}@${word} ` : text;
}

interface Props {
  value: string;
  onChangeText(v: string): void;
  onSubmit(): void;
  people: readonly QuickPerson[];
  placeholder: string;
  label: string;
  testID: string;
  style: object;
}

export const QuickField = forwardRef<TextInput, Props>(function QuickField({ value, onChangeText, onSubmit, people, placeholder, label, testID, style }, ref): ReactElement {
  const [hidden, setHidden] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const q = atQuery(value);
  const list = q && hidden !== value ? atMatches(people, q.query) : [];
  const at = Math.min(cursor, Math.max(0, list.length - 1));
  const pick = (p: QuickPerson): void => { onChangeText(atInsert(value, p)); setCursor(0); };
  const onKeyPress = (e: { nativeEvent: { key: string }; preventDefault?: () => void }): void => {
    if (list.length === 0) return;
    const k = e.nativeEvent.key;
    if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault?.(); setCursor((c) => (c + (k === "ArrowDown" ? 1 : list.length - 1)) % list.length); }
    else if (k === "Enter" || k === "Tab") { e.preventDefault?.(); pick(list[at]!); }
    else if (k === "Escape") { e.preventDefault?.(); setHidden(value); }
  };
  return (
    <View style={st.wrap}>
      <TextInput
        ref={ref} testID={testID} accessibilityLabel={label} placeholder={placeholder} placeholderTextColor="var(--ink-3)" value={value}
        onChangeText={(v) => { onChangeText(v); setCursor(0); }} onKeyPress={onKeyPress as never} onSubmitEditing={() => { if (list.length === 0) onSubmit(); }} style={style}
      />
      {list.length > 0 ? (
        <View testID={`${testID}-people`} accessibilityRole="menu" style={st.pop}>
          {list.map((p, i) => (
            <Pressable key={p.id} accessibilityRole="menuitem" testID={`${testID}-person-${p.id}`} onPress={() => pick(p)} style={({ hovered }: { hovered?: boolean }) => [st.item, (i === at || hovered === true) && st.on]}>
              <Avatar name={p.name} seedId={p.id} kind={p.kind === "agent" ? "agent" : "person"} size={20} />
              <Text numberOfLines={1} style={st.name}>{p.name}</Text>
              {p.kind === "agent" ? <Text style={st.kind}>Agent</Text> : p.username ? <Text style={st.kind}>{`@${p.username}`}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
});

const st = StyleSheet.create({
  wrap: { flex: 1, minWidth: 0, position: "relative", zIndex: 5 },
  pop: { position: "absolute", top: "100%", left: -8, marginTop: 4, width: 260, padding: 4, borderRadius: 12, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)", zIndex: 10 } as object,
  item: { flexDirection: "row", alignItems: "center", gap: 9, height: 32, paddingHorizontal: 8, borderRadius: 8 },
  on: { backgroundColor: "var(--hover)" as string },
  name: { flex: 1, minWidth: 0, fontSize: 13.5, color: "var(--ink)" as string },
  kind: { fontSize: 12, color: "var(--ink-4)" as string },
});
