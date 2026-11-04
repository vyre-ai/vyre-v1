// The geometry of a ```chart block, pure: the spec in, the shapes out (rects, paths, slices, points, ticks), so the drawing is a thin step and a test can check every number. Our own, because a chart here is
// five kinds of a few dozen points, and a library would cost more than it draws. The look (colours, fonts) is the skin's, read where it is drawn.
import type { ChartSpec } from "./markdown.ts";

export interface Box { w: number; h: number }
export interface Rect { x: number; y: number; w: number; h: number; s: number; i: number; v: number }
export interface Tick { at: number; label: string }
export interface Geo {
  type: ChartSpec["type"];
  box: Box;
  plot: { x: number; y: number; w: number; h: number };
  yTicks: Tick[];
  xTicks: Tick[];
  rects: Rect[];
  /** One polyline per series, as [x, y] points; an area closes down to the axis. */
  lines: { s: number; pts: [number, number][]; path: string; area: string }[];
  points: { s: number; x: number; y: number }[];
  slices: { i: number; label: string; v: number; frac: number; path: string; mid: [number, number] }[];
  legend: string[];
}

export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  const f = max / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

const fmt = (n: number): string => (Math.abs(n) >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n * 100) / 100));
const num = (d: number | [number, number]): number => (Array.isArray(d) ? d[1] : d);

/** The shapes of a chart in a `box`. Bars group per label, lines and areas run through the labels, a pie is the first series, a scatter plots [x, y] pairs. */
export function chartGeometry(spec: ChartSpec, box: Box = { w: 520, h: 260 }): Geo {
  const pad = { l: 44, r: 14, t: 14, b: 30 };
  const plot = { x: pad.l, y: pad.t, w: box.w - pad.l - pad.r, h: box.h - pad.t - pad.b };
  const geo: Geo = { type: spec.type, box, plot, yTicks: [], xTicks: [], rects: [], lines: [], points: [], slices: [], legend: spec.type === "pie" ? (spec.labels ?? spec.series[0]?.data.map((_, i) => String(i + 1)) ?? []) : spec.series.map((s) => s.name) };
  if (spec.type === "pie") {
    const data = (spec.series[0]?.data ?? []).map(num).map((v) => Math.max(0, v));
    const total = data.reduce((a, b) => a + b, 0) || 1;
    const r = Math.min(box.w, box.h) / 2 - 12;
    const cx = box.w / 2;
    const cy = box.h / 2;
    let a0 = -Math.PI / 2;
    data.forEach((v, i) => {
      const frac = v / total;
      const a1 = a0 + frac * Math.PI * 2;
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number): string => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
      const path = frac >= 0.9999 ? `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z` : `M${cx} ${cy}L${p(a0)}A${r} ${r} 0 ${big} 1 ${p(a1)}Z`;
      const am = (a0 + a1) / 2;
      geo.slices.push({ i, label: spec.labels?.[i] ?? String(i + 1), v, frac, path, mid: [cx + (r * 0.62) * Math.cos(am), cy + (r * 0.62) * Math.sin(am)] });
      a0 = a1;
    });
    return geo;
  }
  if (spec.type === "scatter") {
    const pts = spec.series.flatMap((s, si) => s.data.map((d, i) => ({ s: si, x: Array.isArray(d) ? d[0] : i, y: num(d) })));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs, 0);
    const x1 = niceMax(Math.max(...xs, 1));
    const y0 = Math.min(...ys, 0);
    const y1 = niceMax(Math.max(...ys, 1));
    const sx = (v: number): number => plot.x + ((v - x0) / (x1 - x0 || 1)) * plot.w;
    const sy = (v: number): number => plot.y + plot.h - ((v - y0) / (y1 - y0 || 1)) * plot.h;
    for (const p of pts) geo.points.push({ s: p.s, x: sx(p.x), y: sy(p.y) });
    for (let t = 0; t <= 4; t++) { const v = y0 + ((y1 - y0) * t) / 4; geo.yTicks.push({ at: sy(v), label: fmt(v) }); const u = x0 + ((x1 - x0) * t) / 4; geo.xTicks.push({ at: sx(u), label: fmt(u) }); }
    return geo;
  }
  const n = Math.max(...spec.series.map((s) => s.data.length), spec.labels?.length ?? 0, 1);
  const vals = spec.series.flatMap((s) => s.data.map(num));
  const y1 = niceMax(Math.max(...vals, 1));
  const y0 = Math.min(0, ...vals);
  const sy = (v: number): number => plot.y + plot.h - ((v - y0) / (y1 - y0 || 1)) * plot.h;
  for (let t = 0; t <= 4; t++) { const v = y0 + ((y1 - y0) * t) / 4; geo.yTicks.push({ at: sy(v), label: fmt(v) }); }
  const band = plot.w / n;
  for (let i = 0; i < n; i++) geo.xTicks.push({ at: plot.x + band * i + band / 2, label: spec.labels?.[i] ?? String(i + 1) });
  if (spec.type === "bar") {
    const k = spec.series.length;
    const bw = Math.min(40, (band * 0.7) / k);
    spec.series.forEach((s, si) => s.data.forEach((d, i) => {
      const v = num(d);
      const x = plot.x + band * i + band / 2 - (bw * k) / 2 + bw * si;
      const top = sy(Math.max(v, 0));
      geo.rects.push({ x, y: top, w: bw - 2, h: Math.abs(sy(0) - sy(v)), s: si, i, v });
    }));
    return geo;
  }
  spec.series.forEach((s, si) => {
    const pts: [number, number][] = s.data.map((d, i) => [plot.x + band * i + band / 2, sy(num(d))]);
    const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join("");
    const last = pts[pts.length - 1];
    const first = pts[0];
    geo.lines.push({ s: si, pts, path, area: last && first ? `${path}L${last[0].toFixed(2)} ${sy(0).toFixed(2)}L${first[0].toFixed(2)} ${sy(0).toFixed(2)}Z` : "" });
  });
  return geo;
}

/** The table behind a chart: a header row and one row per label, for the Table view and for Copy. */
export function chartTable(spec: ChartSpec): { head: string[]; rows: string[][] } {
  if (spec.type === "pie") {
    const data = spec.series[0]?.data ?? [];
    return { head: ["Label", spec.series[0]?.name ?? "Value"], rows: data.map((d, i) => [spec.labels?.[i] ?? String(i + 1), String(num(d))]) };
  }
  if (spec.type === "scatter") return { head: ["Series", "x", "y"], rows: spec.series.flatMap((s) => s.data.map((d, i) => [s.name, String(Array.isArray(d) ? d[0] : i), String(num(d))])) };
  const n = Math.max(...spec.series.map((s) => s.data.length), spec.labels?.length ?? 0);
  return { head: ["", ...spec.series.map((s) => s.name)], rows: Array.from({ length: n }, (_, i) => [spec.labels?.[i] ?? String(i + 1), ...spec.series.map((s) => (s.data[i] === undefined ? "" : String(num(s.data[i] as number | [number, number]))))]) };
}
