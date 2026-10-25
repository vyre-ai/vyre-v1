// Records > charts (spec 3.4, 2.9): the records of the view counted, or a number or money field summed, under each value of a choice, status, person, checkbox or date field (dates by month).
// One bar per value in the order of the field's options, longest bar full width, the value at its end, the total under the chart. Bars are drawn from the first thousand records that match the
// view's filter, so a filter in the header charts just those. Group by and Measure are quiet header buttons that open the one menu; the pick is kept in the saved view's config.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import { useRecordsData } from "../sidebar/data.tsx";
import { HeadButton } from "../sidebar/parts.tsx";
import { ViewHead, useViewState } from "../views-a/view.tsx";
import type { ViewCtx } from "../views-a/view.tsx";
import { useViewRows } from "./data.ts";
import { isGroupField, isMeasureField, measureText, tally, total, valueText, widths } from "./model.ts";
import type { FieldDef, Measure } from "./model.ts";

export function chartDefaults(ctx: ViewCtx): { group: FieldDef | undefined; measure: Measure } {
  const cfg = ctx.saved?.config ?? {};
  const groups = ctx.def.fields.filter(isGroupField);
  const group = groups.find((f) => f.key === cfg["group"]) ?? groups.find((f) => f.type === "status") ?? groups[0];
  const m = cfg["measure"];
  const measure: Measure = typeof m === "string" && ctx.def.fields.some((f) => f.key === m && isMeasureField(f)) ? { kind: "sum", field: m } : { kind: "count" };
  return { group, measure };
}

export function ChartsView({ ctx }: { ctx: ViewCtx }): ReactElement {
  const data = useRecordsData();
  const st = useViewState(ctx);
  const menu = useMenu();
  const init = chartDefaults(ctx);
  const [groupKey, setGroupKey] = useState<string | null>(init.group?.key ?? null);
  const [measure, setMeasure] = useState<Measure>(init.measure);
  const { def } = ctx;
  const { rows, count } = useViewRows(ctx.type, st.v, def.titleField);
  const group = def.fields.find((f) => f.key === groupKey && isGroupField(f));
  const groups = def.fields.filter(isGroupField);
  const measures = def.fields.filter(isMeasureField);

  const buttons = (
    <>
      <HeadButton icon="group" label="Group by" detail={group?.title} testID="records-chart-group" onPress={(x, y) => menu.show([
        { head: "Group by" }, ...groups.map((f) => ({ label: f.title, checked: f.key === group?.key, onSelect: () => setGroupKey(f.key) })),
      ], x, y)} />
      <HeadButton icon="sort" label="Measure" detail={measure.kind === "count" ? "Count" : (def.fields.find((f) => f.key === measure.field)?.title ?? "")} testID="records-chart-measure" onPress={(x, y) => menu.show([
        { head: "Measure" }, { label: "Count", checked: measure.kind === "count", onSelect: () => setMeasure({ kind: "count" }) },
        ...measures.map((f) => ({ label: `Sum of ${f.title.toLowerCase()}`, checked: measure.kind === "sum" && measure.field === f.key, onSelect: () => setMeasure({ kind: "sum", field: f.key }) })),
      ], x, y)} />
    </>
  );
  const head = <ViewHead ctx={ctx} st={st} fields={false} extra={buttons} />;
  if (!group) return <View style={k.main} testID="records-charts">{head}<States kind="empty" title={`${def.plural} have no field to group a chart by.`} icon="records" />{menu.element}</View>;

  const slices = tally(rows, group, measure, data.nameOf);
  const w = widths(slices);
  const sum = total(slices);
  return (
    <View style={k.main} testID="records-charts" accessibilityLabel={`${def.plural} chart`}>
      {head}
      <View style={k.body}>
        <Text accessibilityRole="header" aria-level={2} style={k.h2} testID="chart-title">{`${measureText(measure, def)} by ${group.title.toLowerCase()}`}</Text>
        {slices.length === 0 ? (
          <States kind="empty" title={st.v.clauses.length > 0 || st.v.find ? "Nothing matches these filters." : `No ${def.plural.toLowerCase()} yet.`} icon="records" />
        ) : (
          <View style={k.chart} accessibilityRole="list" testID="chart-bars">
            {slices.map((s, i) => (
              <View key={s.key || "none"} style={k.row} testID={`slice-${s.key || "none"}`} accessibilityLabel={`${s.label}, ${valueText(s.value, measure, def)}`}>
                <Text numberOfLines={1} style={k.label}>{s.label}</Text>
                <View style={k.track}>
                  <View style={[k.fill, { width: `${w[i] ?? 0}%`, backgroundColor: s.hue < 0 ? "var(--ink-4)" : `hsl(${s.hue}, 55%, 52%)` }]} testID={`bar-${s.key || "none"}`} />
                </View>
                <Text style={k.value}>{valueText(s.value, measure, def)}</Text>
              </View>
            ))}
          </View>
        )}
        <View style={k.totalRow}><Text style={k.total} testID="chart-total">{`${valueText(sum, measure, def)} in total, from ${rows.length.toLocaleString("en-US")} of ${count.toLocaleString("en-US")} ${count === 1 ? def.title.toLowerCase() : def.plural.toLowerCase()}`}</Text></View>
      </View>
      <Text style={k.foot} testID="records-count">{`${count.toLocaleString("en-US")} ${count === 1 ? def.title.toLowerCase() : def.plural.toLowerCase()}`}</Text>
      {menu.element}
    </View>
  );
}

const k = StyleSheet.create({
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  body: { flex: 1, minHeight: 0, paddingHorizontal: 28, paddingTop: 22, gap: 16, maxWidth: 880 },
  h2: { margin: 0, fontSize: 15, fontWeight: "600", letterSpacing: -0.1, color: "var(--ink)" as string },
  chart: { gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 28 },
  label: { width: 120, fontSize: 13, color: "var(--ink-2)" as string },
  track: { flex: 1, height: 18, borderRadius: 5, backgroundColor: "var(--sunk)" as string, overflow: "hidden" },
  fill: { height: 18, borderRadius: 5 },
  value: { width: 72, textAlign: "right", fontSize: 13, color: "var(--ink)" as string, fontVariant: ["tabular-nums"] },
  totalRow: { paddingTop: 4 },
  total: { fontSize: 12.5, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  foot: { fontSize: 12, color: "var(--ink-3)" as string, textAlign: "center", paddingVertical: 8, fontVariant: ["tabular-nums"] },
});
