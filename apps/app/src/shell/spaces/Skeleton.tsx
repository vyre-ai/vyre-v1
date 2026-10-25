// The skeleton a place shows while a Space loads (spec 2.1, 3.0 "Space switch"): the shape of a sidebar and a page, no names, no rows, nothing from either Space.
// It holds no data, so data from two Spaces can never meet on screen.
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";

const SIDE: readonly number[] = [44, 70, 56, 62, 48, 66];
const MAIN: readonly number[] = [90, 100, 80, 64, 92, 72];

function bars(widths: readonly number[]): ReactElement[] {
  const out: ReactElement[] = [];
  widths.forEach((w, i) => { out.push(<View key={i} style={[styles.bar, { width: `${w}%` }]} />); });
  return out;
}

export function SpaceSkeleton(): ReactElement {
  return (
    <View testID="shell-skeleton" aria-busy accessibilityLabel="Loading" accessibilityRole="progressbar" style={styles.root}>
      <View style={styles.side}>
        {bars(SIDE)}
      </View>
      <View style={styles.main}>
        <View style={[styles.bar, styles.head, { width: "36%" }]} />
        {bars(MAIN)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: "var(--win)" as string },
  side: { width: 240, padding: 20, gap: 14, backgroundColor: "var(--side)" as string, borderRightWidth: 1, borderRightColor: "var(--line)" as string },
  main: { flex: 1, padding: 24, gap: 14 },
  bar: { height: 14, borderRadius: 6, backgroundColor: "var(--sunk)" as string },
  head: { height: 22 },
});
