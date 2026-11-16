// Right pane > Details: when this record was made and last changed, in two quiet lines (its facts are the page itself, so the pane does not say them twice). The pane opens here; Activity is the second tab.
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { When } from "../../../../../../ui/src/Time/index.tsx";
import { usePageData } from "../recordpage/data.tsx";
import type { RecordRow } from "../recordpage/model.ts";

export function DetailsTab({ row }: { row: RecordRow }): ReactElement {
  const data = usePageData();
  const now = data.now();
  return (
    <View testID="pane-details" style={s.box}>
      <Line label="Made" testID="pane-details-made">
        <When at={row.createdAt} now={now} style={s.value} />
      </Line>
      <Line label="Last changed" testID="pane-details-changed">
        <When at={row.updatedAt} now={now} style={s.value} />
      </Line>
    </View>
  );
}

function Line({ label, children, testID }: { label: string; children: ReactElement; testID?: string }): ReactElement {
  return (
    <View style={s.line} testID={testID}>
      <Text style={s.label} numberOfLines={1}>
        {label}
      </Text>
      <View style={s.right}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  box: { paddingHorizontal: 14, paddingVertical: 8 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 8 },
  label: { width: 104, color: "var(--ink-3)" as string, fontSize: 12.5, lineHeight: 18 },
  right: { flex: 1, minWidth: 0 },
  value: { color: "var(--ink)" as string, fontSize: 13, lineHeight: 18 },
});
