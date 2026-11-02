// The reaction picker: the six people reach for, and a search over every emoji. It opens where you pressed, and an outside press or Escape closes it.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { findEmoji } from "../../../../../../ui/src/Composer/emoji.ts";
import { each } from "../../../shell/sidebar/model.ts";

export const QUICK: readonly string[] = ["👍", "❤️", "😂", "🎉", "🙏", "👀"];

/** What the grid shows for what is typed: the quick six, the matches, or nothing by that name. */
export function reactionChoices(q: string): readonly { char: string; name?: string }[] {
  const t = q.trim().toLowerCase();
  return t.length > 1 ? findEmoji(t, 12) : QUICK.map((char) => ({ char }));
}

export function ReactionPicker({ x, y, onPick, onClose }: { x: number; y: number; onPick(emoji: string): void; onClose(): void }): ReactElement {
  const [q, setQ] = useState("");
  const win = useWindowDimensions();
  const box = useRef<{ contains?: (n: unknown) => boolean } | null>(null);
  const list = useMemo(() => reactionChoices(q), [q]);
  useEffect(() => {
    if (Platform.OS !== "web") return undefined;
    const doc = (globalThis as { document?: { addEventListener(t: string, f: (e: never) => void): void; removeEventListener(t: string, f: (e: never) => void): void } }).document;
    const down = (e: { target?: unknown }): void => { if (!box.current?.contains?.(e.target)) onClose(); };
    const key = (e: { key?: string }): void => { if (e.key === "Escape") onClose(); };
    doc?.addEventListener("mousedown", down as never);
    doc?.addEventListener("keydown", key as never);
    return () => { doc?.removeEventListener("mousedown", down as never); doc?.removeEventListener("keydown", key as never); };
  }, [onClose]);
  return (
    <View ref={box as never} testID="reaction-picker" accessibilityRole="menu" style={[st.pop, { left: Math.min(x, win.width - 300), top: Math.min(y + 6, win.height - 170) }]}>
      <View style={st.grid}>
        {each(list, (e) => <Pressable key={e.char} role="button" aria-label={e.name ?? e.char} testID={`react-${e.char}`} onPress={() => onPick(e.char)} style={(({ hovered }: { hovered?: boolean }) => [st.cell, hovered === true && st.over]) as never}><Text style={st.emoji}>{e.char}</Text></Pressable>)}
        {list.length === 0 ? <Text style={st.none}>Nothing by that name</Text> : null}
      </View>
      <TextInput autoFocus testID="reaction-search" accessibilityLabel="Search emoji" placeholder="Search emoji" placeholderTextColor="var(--ink-3)" value={q} onChangeText={setQ} style={st.field} />
    </View>
  );
}

const st = StyleSheet.create({
  pop: { position: "fixed" as "absolute", width: 288, padding: 6, zIndex: 70, borderRadius: 16, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" as string },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 2, padding: 2 },
  cell: { width: 38, height: 38, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  over: { backgroundColor: "var(--hover)" as string },
  emoji: { fontSize: 20 },
  none: { fontSize: 12, color: "var(--ink-3)" as string, padding: 6 },
  field: { height: 32, marginTop: 4, borderRadius: 8, paddingHorizontal: 10, fontSize: 13, color: "var(--ink)" as string, backgroundColor: "var(--field)" as string, outlineStyle: "none", outlineWidth: 0 } as object,
});
