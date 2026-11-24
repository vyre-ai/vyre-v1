// The one record picker: search every record by name (the same source Cmd-K uses, search.query over records) or pick from the ones used lately (search.recent.list), then press one. Whatever needs "a record" (adding a
// helper's result to one) opens this and gets back the record's type and id; it writes nothing itself.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import { Dialog } from "../../../../../ui/src/Dialog/index.tsx";
import { each } from "../../shell/sidebar/model.ts";

export interface PickedRecord {
  type: string;
  id: string;
  title: string;
}
type Hit = { id: string; title: string; recordType?: string; kind?: string };

export interface RecordPickerProps {
  call(cap: string, input: unknown): Promise<unknown>;
  title?: string;
  onPick(r: PickedRecord): void;
  onClose(): void;
}

export function RecordPicker({ call, title = "Add to a record", onPick, onClose }: RecordPickerProps): ReactElement {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<readonly Hit[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    setRows(null);
    setErr(false);
    const query = q.trim();
    const read =
      query === ""
        ? call("search.recent.list", { types: ["record"], limit: 12 })
        : call("search.query", { q: query, types: ["record"], limit: 20 });
    void Promise.resolve(read).then(
      (o) => {
        if (live) setRows(((o as { hits?: Hit[] } | null)?.hits ?? []).filter((h) => h.recordType !== undefined));
      },
      () => {
        if (live) setErr(true);
      },
    );
    return () => {
      live = false;
    };
  }, [q, call]);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      testID="record-picker"
      width={460}
      actions={[{ label: "Cancel", testID: "record-picker-cancel", onPress: onClose }]}
    >
      <TextInput
        testID="record-picker-search"
        accessibilityLabel="Search records"
        placeholder="Search records"
        placeholderTextColor="var(--ink-4)"
        value={q}
        onChangeText={setQ}
        style={st.field}
      />
      <ScrollView style={st.list} testID="record-picker-list">
        {err ? (
          <Text style={st.note}>Could not read the records. Try again.</Text>
        ) : rows === null ? (
          <Text style={st.note}>Reading…</Text>
        ) : rows.length === 0 ? (
          <Text style={st.note}>
            {q.trim() === "" ? "No records used lately. Search for one." : "No record by that name."}
          </Text>
        ) : (
          each(rows, (h) => (
            <Pressable
              key={`${h.recordType}-${h.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Add to ${h.title}`}
              testID={`record-pick-${h.id}`}
              onPress={() => onPick({ type: h.recordType!, id: h.id, title: h.title })}
              style={st.row}
            >
              <Text style={st.name} numberOfLines={1}>
                {h.title}
              </Text>
              <Text style={st.type} numberOfLines={1}>
                {h.recordType}
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </Dialog>
  );
}

const st = StyleSheet.create({
  field: {
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "var(--field-line)" as string,
    backgroundColor: "var(--field)" as string,
    color: "var(--ink)" as string,
    fontSize: 14,
  },
  list: { maxHeight: 300, marginTop: 8 },
  note: { paddingVertical: 14, fontSize: 13, color: "var(--ink-3)" as string },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 38, paddingHorizontal: 8, borderRadius: 8 },
  name: { flex: 1, minWidth: 0, fontSize: 14, color: "var(--ink)" as string },
  type: { fontSize: 12, color: "var(--ink-3)" as string },
});
