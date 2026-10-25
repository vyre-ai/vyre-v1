// Records > map (spec 3.4, 2.9): records that have a place, as pins on a plain grid of latitude and longitude, fitted to the pins with a margin, north up. A record has a place when it has number
// fields called lat and lng (or latitude and longitude) or an address with them. The list beside the map is the same records; pointing at a row or a pin lights the other; a click opens the record.
// There is no street basemap in this build: the grid and the pins are drawn locally, so the map reads the same offline.
import { createElement, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { useRecordsData } from "../sidebar/data.tsx";
import { cellText } from "../table/model.ts";
import { badgeFieldOf, each } from "../views-a/model.ts";
import { ViewHead, useViewState } from "../views-a/view.tsx";
import type { ViewCtx } from "../views-a/view.tsx";
import { useViewRows } from "./data.ts";
import { boundsOf, hueOfRow, plot, pointOf } from "./model.ts";
import type { Point } from "./model.ts";

const W = 640, H = 420;

export function MapView({ ctx }: { ctx: ViewCtx }): ReactElement {
  const data = useRecordsData();
  const st = useViewState(ctx);
  const [lit, setLit] = useState<string | null>(null);
  const { def } = ctx;
  const { rows, count } = useViewRows(ctx.type, st.v, def.titleField);
  const names = data.nameOf;
  const tf = def.fields.find((f) => f.key === def.titleField);
  const badge = badgeFieldOf(def);
  const head = <ViewHead ctx={ctx} st={st} fields={false} />;
  const points: Point[] = [];
  for (const r of rows) { const p = pointOf(def, r); if (p) points.push(p); }
  const title = (p: Point): string => (tf ? cellText(tf, p.row.fields[tf.key], names) : "") || "Untitled";

  if (points.length === 0) {
    return <View style={m.main} testID="records-map">{head}<States kind="empty" title={rows.length > 0 ? `No ${def.plural.toLowerCase()} have a place yet. Add latitude and longitude fields to see them here.` : `No ${def.plural.toLowerCase()} yet.`} icon="records" /></View>;
  }
  const b = boundsOf(points);
  const at = each(points, (p) => ({ p, ...plot(p, b, W, H) }));
  const lines: ReactElement[] = [];
  for (let i = 1; i < 4; i++) {
    lines.push(createElement("line", { key: `v${i}`, x1: (W / 4) * i, y1: 0, x2: (W / 4) * i, y2: H, style: { stroke: "var(--line)", strokeWidth: 1 } }));
    lines.push(createElement("line", { key: `h${i}`, x1: 0, y1: (H / 4) * i, x2: W, y2: (H / 4) * i, style: { stroke: "var(--line)", strokeWidth: 1 } }));
  }
  const pins = each(at, ({ p, x, y }) => {
    const hue = hueOfRow(badge, p.row);
    const on = lit === p.id;
    return createElement("circle", {
      key: p.id, cx: x, cy: y, r: on ? 9 : 6, "data-testid": `pin-${p.id}`, style: { fill: `hsl(${hue}, 60%, 52%)`, stroke: "var(--win)", strokeWidth: 2, cursor: "pointer" },
      onMouseEnter: () => setLit(p.id), onMouseLeave: () => setLit(null), onClick: () => data.nav.openRecord(p.id),
    });
  });
  const canvas = Platform.OS === "web"
    ? createElement("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", style: { display: "block", maxHeight: "100%", aspectRatio: `${W} / ${H}` }, role: "img", "aria-label": `${points.length} places` }, ...lines, ...pins)
    : null;

  return (
    <View style={m.main} testID="records-map" accessibilityLabel={`${def.plural} map`}>
      {head}
      <View style={m.body}>
        <View style={m.canvas} testID="map-canvas">{canvas}</View>
        <ScrollView style={m.list} testID="map-list">
          {each(points, (p) => (
            <Pressable
              key={p.id} accessibilityRole="button" accessibilityLabel={title(p)} testID={`place-${p.id}`} onPress={() => data.nav.openRecord(p.id)}
              onHoverIn={() => setLit(p.id)} onHoverOut={() => setLit(null)}
              style={[m.row, lit === p.id && m.rowOn]}
            >
              <View style={[m.dot, { backgroundColor: `hsl(${hueOfRow(badge, p.row)}, 60%, 52%)` }]} />
              <View style={m.rowText}>
                <Text numberOfLines={1} style={m.rowTitle}>{title(p)}</Text>
                <Text numberOfLines={1} style={m.rowNote}>{`${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <Text style={m.foot} testID="records-count">{`${points.length.toLocaleString("en-US")} of ${count.toLocaleString("en-US")} ${count === 1 ? def.title.toLowerCase() : def.plural.toLowerCase()} on the map`}</Text>
    </View>
  );
}

const m = StyleSheet.create({
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  body: { flex: 1, minHeight: 0, flexDirection: "row", flexWrap: "wrap", padding: 16, gap: 16 },
  canvas: { flexGrow: 2, flexBasis: 360, minWidth: 0, borderRadius: 12, overflow: "hidden", backgroundColor: "var(--sunk)" as string },
  list: { flexGrow: 1, flexBasis: 220, maxHeight: "100%" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 8, borderRadius: 6 },
  rowOn: { backgroundColor: "var(--hover)" as string },
  dot: { width: 10, height: 10, borderRadius: 10 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13, color: "var(--ink)" as string },
  rowNote: { fontSize: 11.5, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  foot: { fontSize: 12, color: "var(--ink-3)" as string, textAlign: "center", paddingVertical: 8, fontVariant: ["tabular-nums"] },
});
