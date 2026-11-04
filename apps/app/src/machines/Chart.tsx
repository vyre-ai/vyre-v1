// One machine chart: a line and a soft area over the range, gridlines, time ticks, and a hover that reads the point under the pointer. The four charts of a page share one hover position (the
// page holds it), so the crosshair moves on all of them together. Drawn as SVG at its own pixel width, so the text stays at its size on a phone.
import { createElement } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { geometry, hoverAt, latestText } from "./model.ts";
import type { ChartDef, Point, Range } from "./model.ts";

export interface ChartProps {
  def: ChartDef;
  points: readonly Point[];
  range: Range;
  width: number;
  /** The hovered point as a share of the width (0 to 1), or null; shared by every chart of the page. */
  hover: number | null;
  onHover(fraction: number | null): void;
  title?: string;
}

const h = createElement;
const STROKE: Record<string, string> = { cpu: "var(--accent)", mem: "var(--beacon, var(--accent))", disk: "var(--ink-2)", net: "var(--accent)" };

export function Chart({ def, points, range, width, hover, onHover, title }: ChartProps): ReactElement {
  const g = geometry(def, points, range, width), color = STROKE[def.key] ?? "var(--accent)";
  const at = hover === null ? null : Math.max(0, Math.min(points.length - 1, Math.round(hover * (points.length - 1))));
  const read = at === null ? null : hoverAt(def, points, at, range);
  const x = at === null ? 0 : g.xOf(at);
  const p = at === null ? null : points[at];
  const v = p ? (def.key === "cpu" ? p.cpu : def.key === "mem" ? p.mem : def.key === "disk" ? p.disk : p.netIn) : null;
  const yOf = (val: number): number => g.top + (g.height - g.top - g.bottom) * (1 - Math.min(val, g.max) / g.max);
  const move = (e: { nativeEvent?: { offsetX?: number }; clientX?: number; currentTarget?: { getBoundingClientRect?: () => { left: number } } }): void => {
    const left = e.currentTarget?.getBoundingClientRect?.().left ?? 0, px = typeof e.clientX === "number" ? e.clientX - left : e.nativeEvent?.offsetX ?? 0;
    onHover(Math.max(0, Math.min(1, (px - g.left) / (g.width - g.left - g.right))));
  };
  const svg = h("svg", { width: g.width, height: g.height, viewBox: `0 0 ${g.width} ${g.height}`, role: "img", "aria-label": `${title ?? def.title} over ${range}`, style: { display: "block", overflow: "visible", cursor: "crosshair", touchAction: "pan-y" }, onPointerMove: move, onPointerDown: move, onPointerLeave: () => onHover(null) },
    ...g.rules.flatMap((r, i) => [h("line", { key: `l${i}`, x1: g.left, x2: g.width - g.right, y1: r.y, y2: r.y, stroke: "var(--line)", strokeWidth: 1 }), h("text", { key: `t${i}`, x: g.left - 6, y: r.y + 3.5, textAnchor: "end", fill: "var(--ink-3)", fontSize: 10.5 }, r.label)]),
    g.alertY !== null ? h("line", { key: "alert", x1: g.left, x2: g.width - g.right, y1: g.alertY, y2: g.alertY, stroke: "var(--warn)", strokeDasharray: "3 3", opacity: 0.75 }) : null,
    g.alertY !== null ? h("text", { key: "alertt", x: g.width - g.right, y: g.alertY - 4, textAnchor: "end", fill: "var(--warn)", fontSize: 10.5 }, "Alert at 10% free") : null,
    h("path", { key: "area", d: g.area, fill: color, opacity: def.key === "disk" ? 0.08 : 0.1, stroke: "none" }),
    h("path", { key: "line", d: g.line, fill: "none", stroke: color, strokeWidth: 1.6, strokeLinejoin: "round", strokeLinecap: "round" }),
    g.out ? h("path", { key: "out", d: g.out, fill: "none", stroke: "var(--ink-3)", strokeWidth: 1.3, strokeDasharray: "3 2" }) : null,
    ...g.ticks.map((t, i) => h("text", { key: `x${i}`, x: t.x, y: g.height - 6, textAnchor: t.anchor, fill: "var(--ink-3)", fontSize: 10.5 }, t.label)),
    at !== null ? h("line", { key: "xh", x1: x, x2: x, y1: g.top, y2: g.height - g.bottom, stroke: "var(--ink-3)", strokeDasharray: "2 2" }) : null,
    at !== null && v !== null ? h("circle", { key: "dot", cx: x, cy: yOf(v), r: 3.6, fill: "var(--raised)", stroke: color, strokeWidth: 2 }) : null,
  );
  return (
    <View style={s.card} testID={`chart-${def.key}`} accessibilityLabel={`${title ?? def.title} chart`}>
      <View style={s.head}>
        <Text style={s.title}>{title ?? def.title}{def.key === "net" ? <Text style={s.legend}>{"  in, out (dashed)"}</Text> : null}</Text>
        <Text style={s.now} testID={`chart-${def.key}-now`}>{read ? read.value : latestText(def, points)}</Text>
      </View>
      <View style={s.plot}>
        {svg}
        {read && at !== null ? (
          <View pointerEvents="none" testID={`chart-${def.key}-tip`} style={[s.tip, { left: Math.max(g.left, Math.min(g.width - 110, x - 40)) }]}>
            <Text style={s.tipValue}>{read.value}</Text>
            {read.out ? <Text style={s.tipTime}>{read.out}</Text> : null}
            <Text style={s.tipTime}>{read.time}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { borderRadius: 12, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 6, minWidth: 0 },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  title: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  legend: { fontSize: 11, fontWeight: "400", color: "var(--ink-3)" as string },
  now: { fontSize: 18, fontWeight: "600", color: "var(--ink)" as string, fontVariant: ["tabular-nums"] },
  plot: { marginTop: 4, position: "relative" },
  tip: { position: "absolute", top: -4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 7, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line-2)" as string, minWidth: 64 },
  tipValue: { fontSize: 12, fontWeight: "600", color: "var(--ink)" as string },
  tipTime: { fontSize: 11, color: "var(--ink-3)" as string },
});
