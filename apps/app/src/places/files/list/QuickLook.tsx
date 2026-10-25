// Files > Quick Look: Space on a selected line shows it large without leaving the list. Left and Right step through the list, Space or Escape close, Enter opens the file.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { iconOfKind, Glyph } from "../tree/parts.tsx";
import { kindLabel, sizeText, updatedText } from "../tree/model.ts";
import type { Line } from "../tree/model.ts";

export function QuickLook({ line, now, offsetMin, nameOf, onClose, onOpen }: {
  line: Line; now: number; offsetMin: number; nameOf: (id: string) => string; onClose: () => void; onOpen: () => void;
}): ReactElement {
  const facts: [string, string][] = [["Kind", kindLabel(line.kind)]];
  if (line.type === "file") facts.push(["Size", sizeText(line.size)]);
  else facts.push(["Contains", `${line.items} item${line.items === 1 ? "" : "s"}`]);
  if (line.updatedAt > 0) facts.push(["Modified", updatedText(line.updatedAt, now, offsetMin)]);
  if (line.updatedBy) facts.push(["Modified by", nameOf(line.updatedBy)]);
  if (line.source) facts.push(["From", line.source]);
  const rows: ReactElement[] = [];
  for (const [k, v] of facts) rows.push(<View key={k} style={styles.fact}><Text style={styles.k}>{k}</Text><Text style={styles.v} numberOfLines={1}>{v}</Text></View>);
  return (
    <View style={styles.layer} testID="quicklook" accessibilityViewIsModal accessibilityLabel={`Quick Look, ${line.name}`}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close Quick Look" testID="quicklook-scrim" onPress={onClose} style={styles.scrim} />
      <View style={styles.card}>
        <View style={styles.preview}><Glyph name={iconOfKind(line.kind)} size={56} color="var(--ink-3)" width={1.1} /></View>
        <Text accessibilityRole="header" aria-level={2} numberOfLines={2} style={styles.name} testID="quicklook-name">{line.name}</Text>
        <View style={styles.facts}>
          {rows}
        </View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel={line.type === "folder" ? "Open folder" : "Open file"} testID="quicklook-open" onPress={onOpen} style={styles.primary}><Text style={styles.primaryText}>Open</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" testID="quicklook-close" onPress={onClose} style={styles.ghost}><Text style={styles.ghostText}>Close</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", zIndex: 20 },
  scrim: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.28)" },
  card: { width: 360, maxWidth: "92%", padding: 18, borderRadius: 14, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" as string, gap: 12 },
  preview: { height: 140, borderRadius: 10, backgroundColor: "var(--sunk)" as string, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  facts: { gap: 4 },
  fact: { flexDirection: "row", gap: 10 },
  k: { width: 84, fontSize: 12, color: "var(--ink-3)" as string },
  v: { flex: 1, fontSize: 12.5, color: "var(--ink)" as string },
  actions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  primary: { height: 30, paddingHorizontal: 14, borderRadius: 8, backgroundColor: "var(--accent)" as string, alignItems: "center", justifyContent: "center" },
  primaryText: { fontSize: 12.5, fontWeight: "600", color: "var(--accent-ink)" as string },
  ghost: { height: 30, paddingHorizontal: 12, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--hover)" as string },
  ghostText: { fontSize: 12.5, fontWeight: "600", color: "var(--ink)" as string },
});
