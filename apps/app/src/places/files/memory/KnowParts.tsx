// Small pieces every Knowledge screen draws the same way: the tile of a subject (a face for a person, client or agent, a coloured glyph for a project, topic, record or chat), the source chip under
// a fact, and a quiet text button. Colours are tokens; the one hue per kind is the graph's.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { useMemoryData } from "./data.tsx";
import { sourceGlyph } from "./know.ts";
import type { KFact, PageKind } from "./know.ts";
import { Icon } from "./parts.tsx";
import type { IconName } from "./parts.tsx";

const KIND_HUE: Record<string, number> = { project: 265, topic: 280, record: 100, chat: 170, run: 100, decision: 35, site: 190, note: 215 };
const KIND_ICON: Record<string, IconName> = { project: "folder", topic: "hash", record: "sheet", chat: "chat", run: "run", decision: "note", site: "note", note: "note" };

/** The tile of a subject at `size` px. */
export function SubjectTile({ name, kind, size = 28 }: { name: string; kind: PageKind | "chat" | "run" | "note"; size?: number }): ReactElement {
  if (kind === "person" || kind === "client") return <Avatar name={name} kind="person" size={size} />;
  if (kind === "agent") return <Avatar name={name} kind="agent" size={size} />;
  const hue = KIND_HUE[kind] ?? 215;
  return (
    <View style={[t.glyph, { width: size, height: size, backgroundColor: `hsla(${hue}, 60%, 55%, 0.16)` }]} accessibilityElementsHidden>
      <Icon name={KIND_ICON[kind] ?? "note"} size={Math.round(size * 0.5)} color={`hsl(${hue}, 62%, 62%)`} />
    </View>
  );
}

const GLYPH: Record<ReturnType<typeof sourceGlyph>, IconName> = { chat: "chat", channel: "hash", record: "sheet", run: "run", note: "note" };

/** "(chat icon) Brooks weekly update": the chip under a fact. A press opens the source, at the line when it is a chat (the shell scrolls to and highlights it). */
export function SourceChip({ fact, testID }: { fact: KFact; testID?: string }): ReactElement {
  const { nav } = useMemoryData();
  const link = fact.sourceLink;
  const label = fact.sourceTitle ?? "Source";
  return (
    <Pressable
      accessibilityRole="link" accessibilityLabel={`Open the source: ${label}`} {...(testID ? { testID } : {})}
      onPress={() => { if (link) nav.openChat(link); else nav.openSource(fact.sourceRef); }}
      style={({ hovered }: { hovered?: boolean }) => [t.chip, hovered === true && t.chipOver]}
    >
      <Icon name={GLYPH[sourceGlyph(fact.sourceKind)]} size={11} color="var(--ink-3)" />
      <Text style={t.chipText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** A quiet text button: ink-2 text, a hover wash; `accent` for the one that does the thing. */
export function TextButton({ label, onPress, accent = false, testID, a11y }: { label: string; onPress: () => void; accent?: boolean; testID?: string; a11y?: string }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={a11y ?? label} {...(testID ? { testID } : {})} onPress={onPress}
      style={({ hovered }: { hovered?: boolean }) => [t.btn, hovered === true && t.btnOver]}
    >
      <Text style={[t.btnText, accent && t.accent]}>{label}</Text>
    </Pressable>
  );
}

const t = StyleSheet.create({
  glyph: { borderRadius: 8, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  chip: { height: 20, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, borderRadius: 6, backgroundColor: "var(--sunk)" as string, maxWidth: 260 },
  chipOver: { backgroundColor: "var(--hover)" as string },
  chipText: { fontSize: 12, color: "var(--ink-2)" as string },
  btn: { height: 26, paddingHorizontal: 8, borderRadius: 6, justifyContent: "center", alignItems: "center" },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  accent: { color: "var(--accent)" as string },
});
