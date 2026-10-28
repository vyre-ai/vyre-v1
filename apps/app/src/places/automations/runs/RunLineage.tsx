// Child lineage on the run inspector: parent, child, and attempt. No rows are invented.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { lineageLines } from "./lineage.ts";
import type { LineageChild } from "./lineage.ts";

export function RunLineage({ parentRun, steps = [], children = [], testID = "run-lineage" }: {
  parentRun?: string;
  steps?: readonly { attempt?: number }[];
  children?: readonly LineageChild[];
  testID?: string;
}): ReactElement | null {
  const lines = lineageLines(parentRun, steps, children);
  if (!lines) return null;
  return (
    <View testID={testID} style={s.wrap}>
      {lines.parent ? <Text style={s.line}>{lines.parent}</Text> : null}
      {lines.attempt ? <Text style={s.line}>{lines.attempt}</Text> : null}
      {lines.children.map((child) => <Text key={child.id} testID={`lineage-child-${child.id}`} style={s.line}>{child.text}</Text>)}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 4, paddingHorizontal: 16, paddingBottom: 8 },
  line: { fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
});
