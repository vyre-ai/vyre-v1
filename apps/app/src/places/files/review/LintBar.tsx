// The lint bar over an agent's instruction files (spec 2.14, 3.5; screen files.lint-bar, vyre-v1.html .lintbar): one 34 px line of checks, each a dot and a few words (lines against the limit, Inherits VYRE.md,
// Override: lines, the secret scan, the schema of agent.toml). A press jumps to the line, or opens a menu of lines when there are several. agent.toml has a Text and Form switch on the right.
// The checks come from files.lint over the draft text, so they follow every keystroke; the editor below saves with files.save and the version the draft started from.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { useCap } from "./data.tsx";
import { jumpLabel, lintItems } from "./model.ts";
import type { LintItem, Sev } from "./model.ts";
import { Dot, Segmented, Skeleton, anchorOf, webProps } from "./parts.tsx";

export type EditView = "text" | "form";

export const SEV_COLOR: Readonly<Record<Sev, string>> = { ok: "var(--ok)", warn: "var(--warn)", err: "var(--danger)", info: "var(--accent)" };

export interface LintBarProps {
  fileId: string;
  name: string;
  text: string;
  /** Given for agent.toml: the Text and Form switch. */
  view?: EditView;
  onView?(view: EditView): void;
  /** Jump to a line of the file. */
  onJump(line: number): void;
}

function Chip({ item, onPress }: { item: LintItem; onPress: (e: unknown) => void }): ReactElement {
  const [over, setOver] = useState(false);
  const many = item.list.length > 1;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.label}
      onPress={onPress}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      testID={`lint-${item.k}`}
      style={[st.chip, over && st.chipOver]}
      {...webProps({ title: item.tip || item.label, ...(many ? { "aria-haspopup": "menu" } : {}) })}
    >
      <Dot color={SEV_COLOR[item.sev]} />
      <Text style={st.chipText} numberOfLines={1}>{item.label}</Text>
    </Pressable>
  );
}

export function LintBar({ fileId, name, text, view, onView, onJump }: LintBarProps): ReactElement {
  const q = useCap("files.lint", { fileId, text });
  const { element: menu, show } = useMenu();
  if (q.status !== "ready") return <Skeleton height={34} testID="lint-loading" />;
  const items = lintItems(q.data);
  const press = (item: LintItem) => (e: unknown): void => {
    if (item.list.length > 1) {
      const at = anchorOf(e);
      show(item.list.slice(0, 12).map((p) => ({ label: jumpLabel(p), onSelect: () => onJump(p.line) })), at.x, at.y, "other");
    } else onJump(item.line);
  };
  return (
    <View style={st.bar} testID="lint-bar" role="status" aria-label={`Checks for ${name}`}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.scroll} contentContainerStyle={st.items}>
        {/* ui-rows-lint: not a list (a bar of check chips in one 34 px line, as in the prototype) */}
        {items.map((i) => <Chip key={i.k} item={i} onPress={press(i)} />)}
      </ScrollView>
      {q.data.file === "agent_toml" && view && onView ? (
        <Segmented options={[{ id: "text", label: "Text" }, { id: "form", label: "Form" }]} value={view} onChange={onView} label="Text or form" testID="lint-view" />
      ) : null}
      {menu}
    </View>
  );
}

const st = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 8, height: 34, paddingLeft: 10, paddingRight: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)", backgroundColor: "var(--win)" as string },
  scroll: { flex: 1, minWidth: 0 },
  items: { alignItems: "center", gap: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 7, height: 24, paddingHorizontal: 8, borderRadius: 6 },
  chipOver: { backgroundColor: "var(--hover)" as string },
  chipText: { fontSize: 12, color: "var(--ink-2)" as string },
});
