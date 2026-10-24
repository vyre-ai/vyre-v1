// ui/Row: the one list item. Hover and selection paint the whole row, edge to edge (spec UI rows).
// Fixed height (28 with one line, 44 with a note) so a list can skip measuring. The note sits under the title.
// Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.

import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { RowProps } from "./props.ts";

export type { RowProps } from "./props.ts";

export const ROW_HEIGHT = 28;
export const ROW_HEIGHT_WITH_NOTE = 44;

export function rowHeight(note?: string): number {
  return note ? ROW_HEIGHT_WITH_NOTE : ROW_HEIGHT;
}

export const Row = memo(function Row({ id, title, note, selected = false, hovered = false, onPress }: RowProps) {
  const [over, setOver] = useState(false);
  const lit = hovered || over;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      onPress={onPress}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      testID={id ? `row-${id}` : undefined}
      style={[styles.row, { height: rowHeight(note) }, lit && HOVER, selected && SELECTED]}
    >
      <View style={styles.text}>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
        {note ? <Text numberOfLines={1} style={styles.note}>{note}</Text> : null}
      </View>
    </Pressable>
  );
});

// Plain objects (not StyleSheet ids) so the painted token is visible in the element's inline style.
const HOVER = { backgroundColor: "var(--hover)" };
const SELECTED = { backgroundColor: "var(--sel)" };

const styles = StyleSheet.create({
  row: { width: "100%", flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderRadius: 6 },
  text: { flex: 1, minWidth: 0, justifyContent: "center" },
  title: { color: "var(--ink)" as string, fontSize: 13, lineHeight: 18 },
  note: { color: "var(--ink-3)" as string, fontSize: 11.5, lineHeight: 16 },
});
