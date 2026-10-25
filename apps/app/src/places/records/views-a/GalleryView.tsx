// Records > gallery (spec 3.4, 2.9): a type's records as cards with a cover. Every card has the same fixed box (a 96 px cover and a 84 px body), so the grid is the same height before the pictures
// load and after; covers load lazily, only when they near the screen. The first 60 cards are drawn, "Show more" adds 60, and the count under the grid is the cached count. A card with no picture
// gets a colour from its title and the person's face or the record's initials. Arrow keys move across the grid; Enter or a click opens the record.
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { useLive, useRecordsData } from "../sidebar/data.tsx";
import { Face } from "../sidebar/parts.tsx";
import { cellText, countSpec } from "../table/model.ts";
import { badgeFieldOf, BODY_H, CARD_GAP, cardFields, COVER_H, coverHue, coverOf, each, GALLERY_PAD, GALLERY_PAGE, galleryLayout, initialsOf, pageSpec } from "./model.ts";
import type { RecordRow } from "./model.ts";
import { LazyImage, Tag, Value, inkOf } from "./parts.tsx";
import { ViewHead, useViewState } from "./view.tsx";
import type { ViewCtx } from "./view.tsx";

const shadow = (v: string): ViewStyle => (Platform.OS === "web" ? ({ boxShadow: v } as ViewStyle) : {});

function GalleryCard({ ctx, row, width, hidden, selected, onSelect }: { ctx: ViewCtx; row: RecordRow; width: number; hidden: readonly string[]; selected: boolean; onSelect: (id: string) => void }): ReactElement {
  const data = useRecordsData();
  const menu = useMenu();
  const names = data.nameOf;
  const { def } = ctx;
  const tf = def.fields.find((f) => f.key === def.titleField);
  const title = (tf ? cellText(tf, row.fields[tf.key], names) : "") || "Untitled";
  const badge = badgeFieldOf(def);
  const badgeValue = badge ? row.fields[badge.key] : undefined;
  const cover = coverOf(def, row);
  const hue = coverHue(row, def.titleField);
  const who = def.fields.find((f) => f.type === "person");
  const person = who ? row.fields[who.key] : undefined;
  const meta = cardFields(def, hidden, badge?.key ?? null, 3);
  const trig = menuTrigger((x, y) => { onSelect(row.id); menu.show([{ label: "Open", onSelect: () => data.nav.openRecord(row.id) }], x, y); });
  return (
    <>
      <Pressable
        accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ selected }} testID={`gal-${row.id}`}
        onPress={() => { onSelect(row.id); data.nav.openRecord(row.id); }} {...trig}
        style={({ hovered }: { hovered?: boolean }) => [g.card, { width }, shadow(hovered === true ? "var(--sh-2), inset 0 0 0 1px var(--line)" : "var(--sh-1), inset 0 0 0 1px var(--line)"), selected && g.cardOn]}
      >
        <View testID={`cover-${row.id}`} style={[g.cover, { width, backgroundColor: `hsla(${hue}, 70%, 62%, 0.28)` }]}>
          {cover ? <LazyImage url={cover.url} name={cover.name} width={width} height={COVER_H} /> : typeof person === "string" && person !== "" ? <Face name={names(person)} size={56} /> : <Text style={[g.initials, { color: inkOf(hue) }]}>{initialsOf(title)}</Text>}
          {badge && typeof badgeValue === "string" && badgeValue !== "" ? <View style={g.badge}><Tag field={badge} value={badgeValue} /></View> : null}
        </View>
        <View style={g.body}>
          <Text numberOfLines={1} style={g.title}>{title}</Text>
          <View style={g.meta}>{each(meta, (f) => <Value key={f.key} field={f} row={row} names={names} />)}</View>
        </View>
      </Pressable>
      {menu.element}
    </>
  );
}

export function GalleryView({ ctx }: { ctx: ViewCtx }): ReactElement {
  const data = useRecordsData();
  const st = useViewState(ctx);
  const [limit, setLimit] = useState(GALLERY_PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const [box, setBox] = useState({ w: 1000 });
  const { def } = ctx;
  const q = useLive("records.query", pageSpec(ctx.type, st.v, def.titleField, limit));
  const n = useLive("records.counts", countSpec(ctx.type, st.v, def.titleField));
  const kept = useRef<RecordRow[]>([]);
  if (q.status === "ready") kept.current = q.data.rows;
  const rows = kept.current;
  const count = n.status === "ready" ? n.data.count : rows.length;
  const { cols, cardW } = galleryLayout(box.w);

  const onKeyDown = (ev: { key?: string; preventDefault?: () => void }): void => {
    const at = selected ? rows.findIndex((r) => r.id === selected) : -1;
    const step = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowDown" ? cols : ev.key === "ArrowUp" ? -cols : 0;
    if (step !== 0) {
      ev.preventDefault?.();
      const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + step))];
      if (next) setSelected(next.id);
    } else if (ev.key === "Enter" && selected) { ev.preventDefault?.(); data.nav.openRecord(selected); }
  };

  return (
    <View style={g.main} testID="records-gallery" accessibilityLabel={`${def.plural} gallery`}>
      <ViewHead ctx={ctx} st={st} sort />
      <View style={g.sheet} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width })} {...({ onKeyDown } as object)}>
        {count === 0 && rows.length === 0 ? (
          <States kind="empty" title={st.v.clauses.length > 0 || st.v.find ? "Nothing matches these filters." : `No ${def.plural.toLowerCase()} yet.`} icon="records" />
        ) : (
          <ScrollView style={g.scroll} contentContainerStyle={g.grid} testID="records-scroll">
            <View style={g.wrap} testID="gallery-grid" accessibilityLabel={`${count} cards`}>
              {each(rows, (r) => <GalleryCard key={r.id} ctx={ctx} row={r} width={cardW} hidden={st.v.hidden} selected={selected === r.id} onSelect={setSelected} />)}
            </View>
            {count > rows.length ? (
              <Pressable accessibilityRole="button" testID="gallery-more" onPress={() => setLimit(limit + GALLERY_PAGE)} style={({ hovered }: { hovered?: boolean }) => [g.more, hovered === true && g.moreOver]}>
                <Text style={g.moreText}>{`Show ${Math.min(GALLERY_PAGE, count - rows.length)} more`}</Text>
              </Pressable>
            ) : null}
            <Text style={g.foot} testID="records-count">{`${count.toLocaleString("en-US")} ${count === 1 ? def.title.toLowerCase() : def.plural.toLowerCase()}`}</Text>
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const g = StyleSheet.create({
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  sheet: { flex: 1, minHeight: 0 },
  scroll: { flex: 1 },
  grid: { padding: GALLERY_PAD, gap: 12 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: CARD_GAP, alignItems: "flex-start" },
  card: { borderRadius: 12, backgroundColor: "var(--raised)" as string, overflow: "hidden", height: COVER_H + BODY_H },
  cardOn: { backgroundColor: "var(--sel)" as string },
  cover: { height: COVER_H, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  initials: { fontSize: 22, fontWeight: "600", letterSpacing: 0.5 },
  badge: { position: "absolute", left: 10, top: 10 },
  body: { height: BODY_H, paddingHorizontal: 12, paddingTop: 10, gap: 6 },
  title: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, maxHeight: 40, overflow: "hidden" },
  more: { alignSelf: "center", height: 30, paddingHorizontal: 14, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  moreOver: { backgroundColor: "var(--hover)" as string },
  moreText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  foot: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"], textAlign: "center" },
});
