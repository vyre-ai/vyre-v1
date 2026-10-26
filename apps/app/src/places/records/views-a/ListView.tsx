// Records > list (spec 3.4, 2.9): a type's records as plain rows, the way a mailbox reads: a face or an icon, the title, one line of the fields that matter, and the tag at the right. Every row is
// the shared ui/Row with its leading and trailing slots, drawn by ui/VirtualList, so 100,000 records scroll like ten. The list asks the local copy for 200 at a time and for more at the end;
// the cached count sits under it.
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
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
function Row({ r, title, note, selected, person, badge, names, onOpen, onMenu }: {
  r: RecordRow; title: string; note: string; selected: boolean; person: unknown; badge: FieldDef | undefined; names: (id: string) => string; onOpen: () => void; onMenu: (x: number, y: number) => void;
}): ReactElement {
  const bv = badge ? r.fields[badge.key] : undefined;
  const trig = menuTrigger(onMenu);
  return (
    <View testID={`list-${r.id}`} style={l.cell} {...(trig as object)}>
      <UiRow
        id={`rec-${r.id}`} title={title} note={note} selected={selected}
        leading={<View style={l.face}>{typeof person === "string" && person !== "" ? <Avatar name={names(person)} seedId={person} kind="person" size={24} testID={`face-${names(person)}`} /> : <Avatar name={title} seedId={r.id} kind="person" size={24} testID={`face-${title}`} />}</View>}
        {...(badge && typeof bv === "string" && bv !== "" ? { trailing: <Tag field={badge} value={bv} /> } : {})}
        onPress={onOpen}
      />
    </View>
  );
}

export function ListView({ ctx }: { ctx: ViewCtx }): ReactElement {
  const data = useRecordsData();
  const st = useViewState(ctx);
  const menu = useMenu();
  const [limit, setLimit] = useState(LIST_PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const { def } = ctx;
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
      <View style={l.sheet}>
        {count === 0 && rows.length === 0 ? (
          <States kind="empty" title={st.v.clauses.length > 0 || st.v.find ? "Nothing matches these filters." : `No ${def.plural.toLowerCase()} yet.`} icon="records" />
        ) : (
          <VirtualList<RecordRow>
            data={rows} rowHeight={44} keyOf={(r) => r.id} renderItem={(r) => (
              <Row
                r={r} title={(tf ? cellText(tf, r.fields[tf.key], names) : "") || "Untitled"} note={noteOf(each(note, (f) => valueText(f, r, names))) || def.title} selected={selected === r.id}
                person={who ? r.fields[who.key] : undefined} badge={badge} names={names}
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
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  sheet: { flex: 1, minHeight: 0, paddingHorizontal: 10, paddingTop: 6 },
  face: { marginRight: 8, marginLeft: 2 },
  cell: { height: 44, justifyContent: "center" },
  foot: { height: 32, justifyContent: "center", paddingHorizontal: 18, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  footText: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
});
