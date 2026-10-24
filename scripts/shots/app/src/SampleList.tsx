// Sample React Native component for the tooling proof: rows with a selected state, painted from skin tokens
// (CSS variables on web). Not a product screen; real screens replace it behind their frozen props.
import { Pressable, StyleSheet, Text, View } from "react-native";

export interface SampleRow { id: string; title: string; note: string }

export const SAMPLE_ROWS: readonly SampleRow[] = [
  { id: "r1", title: "Weekly sync", note: "Northwind - 3 people" },
  { id: "r2", title: "Launch checklist", note: "Updated yesterday" },
  { id: "r3", title: "Inbox review", note: "12 unread" },
];

export function SampleList({ selected = "r2", rows = SAMPLE_ROWS }: { selected?: string; rows?: readonly SampleRow[] }) {
  return (
    <View style={styles.page} accessibilityLabel="sample list">
      <Text style={styles.heading}>Sample</Text>
      {rows.map((r) => (
        <Pressable key={r.id} accessibilityRole="button" style={[styles.row, r.id === selected && styles.selected]} accessibilityState={{ selected: r.id === selected }} testID={`row-${r.id}`}>
          <Text style={styles.title}>{r.title}</Text>
          <Text style={styles.note}>{r.note}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "var(--win)" as string, paddingTop: 24 },
  heading: { color: "var(--ink)" as string, fontSize: 20, fontWeight: "600", paddingHorizontal: 16, paddingBottom: 12 },
  row: { height: 52, justifyContent: "center", paddingHorizontal: 16 },
  selected: { backgroundColor: "var(--sel)" as string },
  title: { color: "var(--ink)" as string, fontSize: 14, fontWeight: "500" },
  note: { color: "var(--ink-3)" as string, fontSize: 12 },
});
