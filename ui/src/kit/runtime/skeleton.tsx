// Loading placeholder: rows as tall as real two-line rows, so the swap to data never changes the screen's box (layout_shift 0).
import { StyleSheet, View } from "react-native";
import { ROW_HEIGHT_WITH_NOTE } from "../../Row/index.tsx";
import { each } from "./each.ts";

export const SKELETON_ROWS = 8;

export function SkeletonRows({ rows = SKELETON_ROWS }: { rows?: number }) {
  const bars = each(Array.from({ length: rows }, (_, i) => i), (i) => (
    <View key={i} style={styles.row}>
      <View style={[styles.bar, { width: `${70 - (i % 4) * 11}%` }]} />
    </View>
  ));
  return (
    <View accessibilityLabel="Loading" accessibilityState={{ busy: true }} testID="kit-skeleton" style={styles.fill}>
      {bars}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { height: ROW_HEIGHT_WITH_NOTE, justifyContent: "center", paddingHorizontal: 8 },
  bar: { height: 10, borderRadius: 5, backgroundColor: "var(--sunk)" as string },
});
