// ui/Group: the one titled block of rows (P3 contract). A head (title; the count and the action at the right; the hint behind an Info on hover, never a paragraph) over a card whose rows get their
// hairlines from the Group itself: a line between neighbours, none above the first or below the last. For up to about 50 rows; a longer list is a list, not a Group. A Group with nothing in it
// draws its empty state: one line and at most one action.
import { Children, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Info } from "../Tip/index.tsx";
import type { StateAction } from "../States/props.ts";

export interface GroupProps {
  title?: string;
  count?: number | string;
  action?: ReactNode;
  /** Help that waits behind an Info mark on hover. */
  hint?: string;
  /** One quiet line under the rows. */
  note?: string;
  /** What the Group says when it holds no rows. */
  empty?: { title: string; action?: StateAction };
  children?: ReactNode;
}

export function Group({ title, count, action, hint, note, empty, children }: GroupProps): ReactElement {
  const rows = Children.toArray(children).filter((c) => c !== "");
  const head =
    title !== undefined || action !== undefined ? (
      <View style={st.head}>
        {title !== undefined ? (
          <Text accessibilityRole="header" style={st.title}>
            {title}
          </Text>
        ) : null}
        {count !== undefined && count !== "" ? <Text style={st.count}>{count}</Text> : null}
        {hint ? <Info help={hint} /> : null}
        <View style={st.grow} />
        {action}
      </View>
    ) : null;
  return (
    <View accessibilityLabel={title} style={st.group}>
      {head}
      {rows.length === 0 && empty ? (
        <View style={st.empty}>
          <Text style={st.emptyTitle}>{empty.title}</Text>
          {empty.action ? (
            <Pressable accessibilityRole="button" onPress={empty.action.onPress}>
              <Text style={st.emptyAction}>{empty.action.label}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        // ui-rows-lint: not a list (the Group's own children, each given its hairline; the rows are the caller's)
        rows.map((row, i) => (
          <View key={isValidElement(row) && row.key !== null ? String(row.key) : i}>
            {i > 0 ? <View testID="group-line" style={st.line} /> : null}
            {row}
          </View>
        ))
      )}
      {note ? <Text style={st.note}>{note}</Text> : null}
    </View>
  );
}

const st = StyleSheet.create({
  group: { gap: 0 },
  head: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28, paddingBottom: 4 },
  title: { fontSize: 12, fontWeight: "500", color: "var(--ink-3)" as string },
  count: { fontSize: 12, color: "var(--ink-4)" as string },
  grow: { flex: 1 },
  line: { height: 1, backgroundColor: "var(--line)" as string },
  note: { fontSize: 12, color: "var(--ink-3)" as string, paddingTop: 6 },
  empty: { gap: 4, paddingVertical: 10 },
  emptyTitle: { fontSize: 13, color: "var(--ink-3)" as string },
  emptyAction: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
});
