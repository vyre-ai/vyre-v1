// Right pane > Everything: the feed built in everything.ts, one quiet row each: what kind, one line, how long ago. A row with somewhere to go is a link; the others are plain.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { usePageData } from "../recordpage/data.tsx";
import { ago } from "../recordpage/model.ts";
import type { TypeDef } from "../recordpage/model.ts";
import { PaneEmpty } from "./Empty.tsx";
import { KIND_LABEL, loadEverything } from "./everything.ts";
import type { Item } from "./everything.ts";

export function EverythingTab({ type, recordId, def, onComments }: { type: string; recordId: string; def: TypeDef; onComments?: () => void }): ReactElement {
  const data = usePageData();
  const [items, setItems] = useState<readonly Item[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadEverything({ call: data.call, type, recordId, def, names: data.nameOf, folderOf: () => data.files?.folderOf({ type, recordId, title: "" }) ?? Promise.resolve(null) }).then((r) => { if (live) setItems(r); });
    return () => { live = false; };
  }, [data, type, recordId, def]);
  if (items === null) return <Text style={s.quiet} testID="pane-everything-loading">Loading</Text>;
  if (items.length === 0) return <PaneEmpty icon="activity" text="Nothing yet" testID="pane-everything-empty" />;
  const now = data.now();
  const open = (it: Item): (() => void) | undefined => {
    if (it.subject && data.nav.openSubject) { const sub = it.subject; return () => data.nav.openSubject!(sub); }
    if (it.kind === "comment" && onComments) return onComments;
    return undefined;
  };
  // ui-rows-lint: not a list (a capped feed of at most a hundred lines inside the record pane)
  const rows: ReactElement[] = items.map((it) => (
    <View key={it.id} style={s.row}>
      <Row
        id={`ev:${it.id}`} title={it.title} {...(it.note ? { note: it.note } : {})} leading={<Text style={s.kind}>{KIND_LABEL[it.kind]}</Text>}
        trailing={<Text style={s.when}>{ago(it.at, now)}</Text>} {...(open(it) ? { onPress: open(it)! } : {})}
      />
    </View>
  ));
  return <View testID="pane-everything">{rows}</View>;
}

const s = StyleSheet.create({
  row: { minHeight: 44, paddingHorizontal: 6 },
  kind: { width: 78, fontSize: 11, fontWeight: "600", color: "var(--ink-3)" as string, textTransform: "uppercase", letterSpacing: 0.3 },
  when: { fontSize: 11.5, color: "var(--ink-3)" as string },
  quiet: { fontSize: 13, color: "var(--ink-3)" as string, padding: 16 },
});
