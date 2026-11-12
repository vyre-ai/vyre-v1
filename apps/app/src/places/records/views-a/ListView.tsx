// Records > list (spec 3.4, 2.9): a type's records as plain rows, the way a mailbox reads: a face or an icon, the title, one line of the fields that matter, and the tag at the right. Every row is
// the shared ui/Row with its leading and trailing slots, drawn by ui/VirtualList, so 100,000 records scroll like ten. The list asks the local copy for 200 at a time and for more at the end;
// the cached count sits under it.
import { useRecordAccess } from "../sharing/useRecordAccess.ts";
import { Glyph } from "../sidebar/parts.tsx";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { makeRecord } from "../table/make.ts";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { Row as UiRow } from "../../../../../../ui/src/Row/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import { useLive, useRecordsData } from "../sidebar/data.tsx";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { cellText, countSpec } from "../table/model.ts";
import { badgeFieldOf, cardFields, each, LIST_PAGE, noteOf, pageSpec } from "./model.ts";
import type { FieldDef, RecordRow } from "./model.ts";
import { Tag, valueText } from "./parts.tsx";
import { ViewHead, useViewState } from "./view.tsx";
import type { ViewCtx } from "./view.tsx";

/** One record as the shared ui/Row: a face leading (the lead's, else the record's own seeded by its id), the status tag trailing, a menu on right-click. It is named Row because the rows lint reads a list item by that name. */
function Row({ r, title, note, selected, person, badge, names, mark, onOpen, onMenu }: {
  r: RecordRow; title: string; note: string; selected: boolean; person: unknown; badge: FieldDef | undefined; names: (id: string) => string; mark: "private" | "shared" | null; onOpen: () => void; onMenu: (x: number, y: number) => void;
}): ReactElement {
  const bv = badge ? r.fields[badge.key] : undefined;
  const trig = menuTrigger(onMenu);
  return (
    <View testID={`list-${r.id}`} style={l.cell} {...(trig as object)}>
      <UiRow
        id={`rec-${r.id}`} title={title} note={note} selected={selected}
        leading={<View style={l.face}>{typeof person === "string" && person !== "" ? <Avatar name={names(person)} seedId={person} kind="person" size={24} testID={`face-${names(person)}`} /> : <Avatar name={title} seedId={r.id} kind="person" size={24} testID={`face-${title}`} />}</View>}
        {...((badge && typeof bv === "string" && bv !== "") || mark ? { trailing: <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>{badge && typeof bv === "string" && bv !== "" ? <Tag field={badge} value={bv} /> : null}{mark ? <View testID={`mark-${r.id}`} accessibilityLabel={mark === "private" ? "Set apart from its type" : "Shared with people"}><Glyph name={mark === "private" ? "lock" : "people"} size={13} color="var(--ink-3)" /></View> : null}</View> } : {})}
        onPress={onOpen}
      />
    </View>
  );
}

/** New on the phone (New project from Search or the Projects +): a name row on top of the list, Enter makes it with the table's own makeRecord and opens it. */
function AddingRow({ ctx, onDone }: { ctx: ViewCtx; onDone: () => void }): ReactElement {
  const data = useRecordsData();
  const [name, setName] = useState(`New ${ctx.def.title.toLowerCase()}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const make = (): void => {
    const n = name.trim();
    if (n === "" || busy) return;
    setBusy(true);
    makeRecord(data.call, ctx.def, n, `new-${ctx.type}-${Date.now()}`).then((id) => { onDone(); if (id) data.nav.openRecord(id); }, (e: unknown) => { setBusy(false); setError(e instanceof Error ? e.message : `Could not make the ${ctx.def.title.toLowerCase()}.`); });
  };
  return (
    <View style={l.adding} testID="records-adding">
      <TextInput value={name} onChangeText={setName} autoFocus selectTextOnFocus editable={!busy} onSubmitEditing={make} accessibilityLabel={`New ${ctx.def.title.toLowerCase()}`} testID="records-adding-input" style={l.addingInput} />
      <Pressable accessibilityRole="button" testID="records-adding-create" onPress={make}><Text style={l.addingLink}>Create</Text></Pressable>
      <Pressable accessibilityRole="button" testID="records-adding-cancel" onPress={onDone}><Text style={l.addingCancel}>Cancel</Text></Pressable>
      {error ? <Text style={l.addingError}>{error}</Text> : null}
    </View>
  );
}

export function ListView({ ctx, startNew = false, onStarted }: { ctx: ViewCtx; startNew?: boolean; onStarted?: () => void }): ReactElement {
  const [adding, setAdding] = useState(false);
  // on the phone a change of address redraws the place, so the request is spent when the row is done (made or cancelled), not when it is shown
  useEffect(() => { if (startNew) setAdding(true); }, [startNew]);
  const data = useRecordsData();
  const st = useViewState(ctx);
  const menu = useMenu();
  const [limit, setLimit] = useState(LIST_PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const { def } = ctx;
  const access = useRecordAccess(ctx.type);
  const q = useLive("records.query", pageSpec(ctx.type, st.v, def.titleField, limit));
  const n = useLive("records.counts", countSpec(ctx.type, st.v, def.titleField));
  const kept = useRef<RecordRow[]>([]);
  if (q.status === "ready") kept.current = q.data.rows;
  const rows = kept.current;
  const count = n.status === "ready" ? n.data.count : rows.length;
  const names = data.nameOf;
  const tf = def.fields.find((f) => f.key === def.titleField);
  const badge = badgeFieldOf(def);
  const who = def.fields.find((f) => f.type === "person");
  const note = cardFields(def, st.v.hidden, badge?.key ?? null, 3);

  return (
    <View style={l.main} testID="records-list" accessibilityLabel={`${def.plural} list`}>
      <ViewHead ctx={ctx} st={st} sort />
      {adding ? <AddingRow ctx={ctx} onDone={() => { setAdding(false); onStarted?.(); }} /> : null}
      <View style={l.sheet}>
        {count === 0 && rows.length === 0 ? (
          <States kind="empty" title={st.v.clauses.length > 0 || st.v.find ? "Nothing matches these filters." : `No ${def.plural.toLowerCase()} yet.`} icon="records" />
        ) : (
          <VirtualList<RecordRow>
            data={rows} rowHeight={44} keyOf={(r) => r.id} renderItem={(r) => (
              <Row
                r={r} title={(tf ? cellText(tf, r.fields[tf.key], names) : "") || "Untitled"} note={noteOf(each(note, (f) => valueText(f, r, names))) || def.title} selected={selected === r.id}
                person={who ? r.fields[who.key] : undefined} badge={badge} names={names} mark={access.marks.get(r.id) ?? null}
                onOpen={() => { setSelected(r.id); data.nav.openRecord(r.id); }}
                onMenu={(x, y) => { setSelected(r.id); menu.show([{ label: "Open", onSelect: () => data.nav.openRecord(r.id) }], x, y); }}
              />
            )}
            onEndReached={() => { if (rows.length < count) setLimit((x) => x + LIST_PAGE); }}
          />
        )}
      </View>
      <View style={l.foot}><Text style={l.footText} testID="records-count">{`${count.toLocaleString("en-US")} ${count === 1 ? def.title.toLowerCase() : def.plural.toLowerCase()}`}</Text></View>
      {menu.element}
    </View>
  );
}

const l = StyleSheet.create({
  adding: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, backgroundColor: "var(--sel)" as string },
  addingInput: { flex: 1, minWidth: 140, height: 34, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: "var(--accent)" as string, backgroundColor: "var(--win)" as string, color: "var(--ink)" as string, fontSize: 15 },
  addingLink: { fontSize: 14, fontWeight: "600", color: "var(--accent)" as string },
  addingCancel: { fontSize: 14, color: "var(--ink-2)" as string },
  addingError: { width: "100%", fontSize: 12.5, color: "var(--danger)" as string },
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  sheet: { flex: 1, minHeight: 0, paddingHorizontal: 10, paddingTop: 6 },
  face: { marginRight: 8, marginLeft: 2 },
  cell: { height: 44, justifyContent: "center" },
  foot: { height: 32, justifyContent: "center", paddingHorizontal: 18, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  footText: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
});
