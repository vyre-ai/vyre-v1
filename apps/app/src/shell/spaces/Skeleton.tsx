// The skeleton a place shows while a Space loads (spec 2.1, 3.0 "Space switch"): nothing at first, then one quiet sign; no names, no rows, nothing from either Space.
// It holds no data, so data from two Spaces can never meet on screen.
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { Quiet } from "../../../../../ui/src/States/Quiet.tsx";

export function SpaceSkeleton(): ReactElement {
  return (
    <View testID="shell-skeleton" aria-busy accessibilityLabel="Loading" accessibilityRole="progressbar" style={styles.root}>
      <Quiet testID="shell-skeleton-quiet" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "var(--win)" as string },
});
