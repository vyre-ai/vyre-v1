// The left side as one list (design 2.6), from listView(): the head returns to the first page and carries the count of what needs him; one search; one list of shared ui/Row.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { listView } from "../list/model.ts";
import type { ListRowIn } from "../list/model.ts";

const DOT = { amber: "var(--warn)", green: "var(--ok)", grey: "var(--ink-4)" } as const;

export function ListView({
  rows,
  onOpen,
  onHome,
  onNew,
}: {
  rows: readonly ListRowIn[];
  onOpen(id: string): void;
  onHome(): void;
  onNew?(): void;
}): ReactElement {
  const [q, setQ] = useState("");
  const v = listView(rows, q);
  return (
    <View style={s.col} testID="auto-list">
      <Pressable testID="al-home" accessibilityRole="button" onPress={onHome} style={s.head}>
        <Text style={s.title}>{v.head.title}</Text>
        {v.head.count > 0 ? <Text style={s.count}>{String(v.head.count)}</Text> : null}
        <View style={{ flex: 1 }} />
        {onNew ? (
          <Pressable testID="al-new" accessibilityRole="button" accessibilityLabel="New automation" onPress={onNew}>
            <Text style={s.plus}>+</Text>
          </Pressable>
        ) : null}
      </Pressable>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search"
        placeholderTextColor="var(--ink-3)"
        accessibilityLabel="Search automations"
        testID="al-search"
        style={s.search}
      />
      {v.rows.map((r) => (
        <Row
          key={r.id}
          id={`al-${r.id}`}
          title={r.name}
          leading={<View style={[s.dot, { backgroundColor: DOT[r.dot] as string }]} />}
          domProps={{ style: { minHeight: 34 } }}
          {...(r.scope ? { trailing: <Text style={s.quiet}>{r.scope}</Text> } : {})}
          onPress={() => onOpen(r.id)}
        />
      ))}
      {v.empty ? <Text style={s.quiet}>{v.empty}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  col: { gap: 2, padding: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, height: 40 },
  title: { fontSize: 17, fontWeight: "600", color: "var(--ink)" as string },
  count: {
    fontSize: 12,
    fontWeight: "600",
    color: "var(--accent)" as string,
    backgroundColor: "var(--accent-wash)" as string,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 1,
    overflow: "hidden",
  },
  plus: { fontSize: 22, color: "var(--ink-2)" as string, paddingHorizontal: 6 },
  search: {
    height: 30,
    paddingHorizontal: 10,
    fontSize: 13,
    color: "var(--ink)" as string,
    borderRadius: 12,
    backgroundColor: "var(--sunk)" as string,
    marginBottom: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  quiet: { fontSize: 12, color: "var(--ink-3)" as string, paddingHorizontal: 8 },
});
