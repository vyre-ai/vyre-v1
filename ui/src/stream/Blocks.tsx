// The blocks of a reply beyond paragraphs and lists: code with colour, a language label, Copy and Wrap; diagrams in a sandboxed frame with a fallback to the source; math; charts drawn by our own SVG with a table
// view and Copy as CSV; callouts; collapsibles; images that enlarge; footnotes. Each is a plain component of the skin's colours (CSS variables on web). The big libraries load only when a message uses them (loaders.ts).
import { createElement, useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Block, ChartSpec } from "./markdown.ts";
import { chartGeometry, chartTable } from "./charts.ts";
import type { Geo } from "./charts.ts";
import { highlight } from "./highlight.ts";
import type { TokenKind } from "./highlight.ts";
import { hasDiagramLoader, renderDiagram, renderMath } from "./loaders.ts";
import type { DiagramTheme } from "./loaders.ts";

const web = Platform.OS === "web";
const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
type Hover = { hovered?: boolean };
const webProps = (p: Record<string, unknown>): Record<string, unknown> => (web ? p : {});

const copyText = (text: string): void => {
  const clip = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator?.clipboard;
  void clip?.writeText?.(text)?.catch(() => undefined);
};

function SmallBtn({ label, onPress, on = false, testID }: { label: string; onPress: () => void; on?: boolean; testID?: string }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} testID={testID} onPress={onPress} style={({ hovered }: Hover) => [st.small, hovered === true && st.smallOver, on && st.smallOn]}>
      <Text style={[st.smallText, on && st.smallTextOn]}>{label}</Text>
    </Pressable>
  );
}

/** The frame every block with controls wears: a quiet header with the kind and its buttons, the content below. */
function Frame({ label, controls, children, testID }: { label: string; controls?: ReactNode; children: ReactNode; testID?: string }): ReactElement {
  return (
    <View style={st.frame} testID={testID}>
      <View style={st.head}><Text style={st.headLabel}>{label}</Text><View style={st.grow} />{controls}</View>
      {children}
    </View>
  );
}

/* ---------- code ---------- */

const TOKEN_COLOR: Record<TokenKind, string> = { plain: "var(--ink)", kw: "var(--accent)", str: "var(--ok)", cm: "var(--ink-3)", num: "var(--warn)", fn: "var(--ink)", ty: "var(--ink-2)", op: "var(--ink)" };

export function CodeBlock({ lang, text, id, caret = false }: { lang: string; text: string; id: string; caret?: boolean }): ReactElement {
  const [wrap, setWrap] = useState(false);
  const [done, setDone] = useState(false);
  const tokens = caret ? [{ k: "plain" as const, v: text }] : highlight(lang, text);
  const runs: ReactNode[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t) runs.push(<Text key={i} style={{ color: TOKEN_COLOR[t.k], ...(t.k === "cm" ? { fontStyle: "italic" as const } : {}) }}>{t.v}</Text>);
  }
  const body = <Text style={st.preText} selectable>{runs}{caret ? " |" : ""}</Text>;
  return (
    <View testID={`block-${id}`} style={st.pre}>
      <View style={st.codeHead}>
        <Text style={st.lang} testID={`lang-${id}`}>{lang || "text"}</Text>
        {!caret ? <SmallBtn label={wrap ? "No wrap" : "Wrap"} on={wrap} onPress={() => setWrap(!wrap)} testID={`wrap-${id}`} /> : null}
        {!caret ? <SmallBtn label={done ? "Copied" : "Copy"} testID={`copy-${id}`} onPress={() => { copyText(text); setDone(true); setTimeout(() => setDone(false), 1500); }} /> : null}
      </View>
      {wrap ? body : <ScrollView horizontal showsHorizontalScrollIndicator={false} testID={`code-scroll-${id}`}>{body}</ScrollView>}
    </View>
  );
}

/* ---------- callouts, collapsibles, images, footnotes ---------- */

const CALLOUT: Record<string, { color: string; label: string }> = {
  note: { color: "var(--accent)", label: "Note" }, tip: { color: "var(--ok)", label: "Tip" }, important: { color: "var(--accent)", label: "Important" }, warning: { color: "var(--warn)", label: "Warning" }, caution: { color: "var(--danger)", label: "Caution" },
};
export function CalloutBlock({ variant, title, children, id }: { variant: string; title: string; children: ReactNode; id: string }): ReactElement {
  const c = CALLOUT[variant] ?? CALLOUT["note"]!;
  return (
    <View testID={`block-${id}`} accessibilityRole="note" accessibilityLabel={`${c.label}: ${title}`} style={[st.callout, { borderLeftColor: c.color }]} {...webProps({ dataSet: { callout: variant } })}>
      <Text style={[st.coTitle, { color: c.color }]}>{title}</Text>
      {children}
    </View>
  );
}

export function DetailsBlock({ summary, open, children, id }: { summary: ReactNode; open: boolean; children: ReactNode; id: string }): ReactElement {
  const [on, setOn] = useState(open);
  return (
    <View testID={`block-${id}`} style={st.details}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} testID={`details-${id}`} onPress={() => setOn(!on)} style={st.summary}>
        <Text style={st.chev}>{on ? "▾" : "▸"}</Text><Text style={st.summaryText}>{summary}</Text>
      </Pressable>
      {on ? <View style={st.detailsBody}>{children}</View> : null}
    </View>
  );
}

/** A box over the whole screen with one thing in it; a press anywhere or Escape closes it. */
export function Lightbox({ onClose, children, testID }: { onClose: () => void; children: ReactNode; testID?: string }): ReactElement {
  useEffect(() => {
    const d = (globalThis as { document?: { addEventListener(t: string, f: (e: { key: string }) => void): void; removeEventListener(t: string, f: (e: { key: string }) => void): void } }).document;
    const key = (e: { key: string }): void => { if (e.key === "Escape") onClose(); };
    d?.addEventListener("keydown", key);
    return () => d?.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Close" testID={testID ?? "lightbox"} onPress={onClose} style={st.lb} {...webProps({ role: "dialog", "aria-modal": "true" })}>
      <View style={st.lbBody}>{children}</View>
    </Pressable>
  );
}

export function ImageBlock({ src, alt, id }: { src: string; alt: string; id: string }): ReactElement {
  const [big, setBig] = useState(false);
  const img = (style: Record<string, unknown>): ReactNode => (web ? createElement("img", { src, alt, style, referrerPolicy: "no-referrer", loading: "lazy" }) : <Text style={st.alt}>{alt}</Text>);
  return (
    <View testID={`block-${id}`} style={st.imgWrap}>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={alt || "Image, press to enlarge"} testID={`img-${id}`} onPress={() => setBig(true)} {...webProps({ style: { cursor: "zoom-in" } })}>
        {img({ maxWidth: "100%", maxHeight: 360, borderRadius: 10, border: "1px solid var(--line)", display: "block" })}
      </Pressable>
      {alt ? <Text style={st.caption}>{alt}</Text> : null}
      {big ? <Lightbox onClose={() => setBig(false)} testID={`lightbox-${id}`}>{img({ maxWidth: "88vw", maxHeight: "80vh", borderRadius: 8 })}</Lightbox> : null}
    </View>
  );
}

export function FootnoteLine({ id, children, blockId }: { id: string; children: ReactNode; blockId: string }): ReactElement {
  return <View testID={`block-${blockId}`} style={st.fn} accessibilityLabel={`Footnote ${id}`}><Text style={st.fnId}>{id}</Text><Text style={st.fnText}>{children}</Text></View>;
}

/* ---------- math ---------- */

type MathState = { html: string } | { error: string } | null;
function useMath(tex: string, display: boolean): MathState {
  const [s, setS] = useState<MathState>(null);
  useEffect(() => {
    let live = true;
    setS(null);
    renderMath(tex, display).then((html) => { if (live) setS({ html }); }, (e: unknown) => { if (live) setS({ error: e instanceof Error ? e.message : "The formula did not draw." }); });
    return () => { live = false; };
  }, [tex, display]);
  return s;
}

/** A formula inline: drawn once the math renderer is in, the formula as written until then (and if it never is). */
export function MathInline({ tex }: { tex: string }): ReactElement {
  const m = useMath(tex, false);
  if (web && m && "html" in m) return createElement("span", { dangerouslySetInnerHTML: { __html: m.html }, "data-math": "inline", "aria-label": tex }) as ReactElement;
  return <Text style={st.mathFallback} testID="math-inline" accessibilityLabel={`Formula: ${tex}`}>{tex}</Text>;
}

export function MathBlock({ tex, id }: { tex: string; id: string }): ReactElement {
  const m = useMath(tex, true);
  return (
    <View testID={`block-${id}`} style={st.mathBlock}>
      {web && m && "html" in m ? createElement("div", { dangerouslySetInnerHTML: { __html: m.html }, "data-math": "display", "aria-label": tex }) : <Text style={st.mathFallbackBlock} accessibilityLabel={`Formula: ${tex}`}>{tex}</Text>}
      {m && "error" in m ? <Text style={st.note} testID={`math-note-${id}`}>{m.error}</Text> : null}
    </View>
  );
}

/* ---------- diagrams ---------- */

const rootVar = (name: string, fallback: string): string => {
  const g = globalThis as { getComputedStyle?: (e: unknown) => { getPropertyValue(n: string): string }; document?: { documentElement?: unknown } };
  const v = g.document?.documentElement && g.getComputedStyle ? g.getComputedStyle(g.document.documentElement).getPropertyValue(name).trim() : "";
  return v || fallback;
};
export function currentTheme(): DiagramTheme {
  const win = rootVar("--win", "#ffffff");
  const n = parseInt(win.replace("#", "").slice(0, 6) || "ffffff", 16);
  const lum = ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
  return { ink: rootVar("--ink", "#18181a"), sunk: rootVar("--sunk", "#f2f2f0"), line: rootVar("--line-2", "#cfcfcc"), accent: rootVar("--accent", "#5b4fd6"), win, dark: lum < 0.5 };
}

const frameDoc = (svg: string): string => `<!doctype html><html><body style="margin:0;background:transparent;display:flex;justify-content:center">${svg}</body></html>`;
const aspectOf = (svg: string): number => {
  const vb = /viewBox="[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)"/.exec(svg);
  return vb ? Number(vb[1]) / Number(vb[2]) : 2;
};

export function DiagramBlock({ source, id }: { source: string; id: string }): ReactElement {
  const [s, setS] = useState<{ svg: string } | { error: string } | null>(null);
  const [big, setBig] = useState(false);
  const [showSource, setShowSource] = useState(false);
  useEffect(() => {
    let live = true;
    setS(null);
    renderDiagram(source, currentTheme()).then((svg) => { if (live) setS({ svg }); }, (e: unknown) => { if (live) setS({ error: e instanceof Error ? e.message : "The diagram did not draw." }); });
    return () => { live = false; };
  }, [source]);
  const frame = (svg: string, big: boolean): ReactNode => createElement("iframe", { sandbox: "", srcDoc: frameDoc(svg), title: "Diagram", style: { border: 0, width: "100%", aspectRatio: String(aspectOf(svg)), maxHeight: big ? "78vh" : 420, background: "transparent", display: "block" } });
  const failed = s !== null && "error" in s;
  return (
    <Frame label="diagram" testID={`block-${id}`} controls={s && "svg" in s ? <><SmallBtn label={showSource ? "Diagram" : "Source"} onPress={() => setShowSource(!showSource)} testID={`diagram-source-${id}`} /><SmallBtn label="Enlarge" onPress={() => setBig(true)} testID={`diagram-zoom-${id}`} /></> : null}>
      {s === null ? <Text style={st.note} testID={`diagram-loading-${id}`}>{hasDiagramLoader() ? "Drawing the diagram…" : ""}</Text> : null}
      {s && "svg" in s && !showSource ? <Pressable accessibilityRole="imagebutton" accessibilityLabel="Diagram, press to enlarge" testID={`diagram-${id}`} onPress={() => setBig(true)} style={st.dg}>{web ? frame(s.svg, false) : null}</Pressable> : null}
      {failed || showSource || (s === null && !hasDiagramLoader()) ? (
        <View>
          {failed ? <Text style={st.error} testID={`diagram-error-${id}`} accessibilityRole="alert">{(s as { error: string }).error}</Text> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}><Text style={st.preText} selectable testID={`diagram-source-text-${id}`}>{source}</Text></ScrollView>
        </View>
      ) : null}
      {big && s && "svg" in s ? <Lightbox onClose={() => setBig(false)} testID={`lightbox-${id}`}>{web ? frame(s.svg, true) : null}</Lightbox> : null}
    </Frame>
  );
}

/* ---------- charts ---------- */

const SERIES_COLORS = ["var(--accent)", "color-mix(in srgb, var(--accent) 45%, var(--win))", "var(--ok)", "var(--warn)", "var(--ink-3)"];

function svgChart(g: Geo, spec: ChartSpec): ReactNode {
  const el = createElement;
  const kids: ReactNode[] = [];
  const axis = { stroke: "var(--line)", strokeWidth: 1 };
  const txt = { fill: "var(--ink-3)", fontSize: 11, fontFamily: "var(--ui, sans-serif)" };
  if (g.type !== "pie") {
    g.yTicks.forEach((t, i) => { kids.push(el("line", { key: `gy${i}`, x1: g.plot.x, x2: g.plot.x + g.plot.w, y1: t.at, y2: t.at, ...axis })); kids.push(el("text", { key: `ty${i}`, x: g.plot.x - 6, y: t.at + 4, textAnchor: "end", ...txt }, t.label)); });
    if (g.type !== "scatter") g.xTicks.forEach((t, i) => kids.push(el("text", { key: `tx${i}`, x: t.at, y: g.box.h - 10, textAnchor: "middle", ...txt }, t.label)));
    else g.xTicks.forEach((t, i) => kids.push(el("text", { key: `tx${i}`, x: t.at, y: g.box.h - 10, textAnchor: "middle", ...txt }, t.label)));
  }
  g.rects.forEach((r, i) => kids.push(el("rect", { key: `r${i}`, x: r.x, y: r.y, width: Math.max(0, r.w), height: Math.max(0, r.h), rx: 3, fill: SERIES_COLORS[r.s % SERIES_COLORS.length], "data-series": r.s, "data-v": r.v })));
  g.lines.forEach((l, i) => {
    if (g.type === "area") kids.push(el("path", { key: `a${i}`, d: l.area, fill: SERIES_COLORS[l.s % SERIES_COLORS.length], opacity: 0.18 }));
    kids.push(el("path", { key: `l${i}`, d: l.path, fill: "none", stroke: SERIES_COLORS[l.s % SERIES_COLORS.length], strokeWidth: 2, strokeLinejoin: "round" }));
    l.pts.forEach((p, k) => kids.push(el("circle", { key: `lp${i}-${k}`, cx: p[0], cy: p[1], r: 3, fill: SERIES_COLORS[l.s % SERIES_COLORS.length] })));
  });
  g.points.forEach((p, i) => kids.push(el("circle", { key: `p${i}`, cx: p.x, cy: p.y, r: 4, fill: SERIES_COLORS[p.s % SERIES_COLORS.length], opacity: 0.85 })));
  g.slices.forEach((sl, i) => { kids.push(el("path", { key: `s${i}`, d: sl.path, fill: SERIES_COLORS[sl.i % SERIES_COLORS.length], stroke: "var(--win)", strokeWidth: 2 })); if (sl.frac > 0.06) kids.push(el("text", { key: `st${i}`, x: sl.mid[0], y: sl.mid[1] + 4, textAnchor: "middle", ...txt, fill: "var(--accent-ink)" }, `${Math.round(sl.frac * 100)}%`)); });
  return el("svg", { viewBox: `0 0 ${g.box.w} ${g.box.h}`, role: "img", "aria-label": spec.title ?? `${spec.type} chart`, style: { width: "100%", height: "auto", display: "block" } }, ...kids);
}

export function ChartBlock({ spec, error, source, id }: { spec: ChartSpec | null; error: string | null; source: string; id: string }): ReactElement {
  const [table, setTable] = useState(!web);
  if (!spec) {
    return (
      <Frame label="chart" testID={`block-${id}`}>
        <Text style={st.error} accessibilityRole="alert" testID={`chart-error-${id}`}>{error ?? "The chart did not draw."}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}><Text style={st.preText} selectable>{source}</Text></ScrollView>
      </Frame>
    );
  }
  const t = chartTable(spec);
  const csv = [t.head, ...t.rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const g = chartGeometry(spec);
  const legend = g.legend.length > 1 || spec.type === "pie" ? g.legend.map((l, i) => (<View key={i} style={st.lg}><View style={[st.lgDot, { backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }]} /><Text style={st.lgText}>{l}</Text></View>)) : null;
  return (
    <Frame label={`chart · ${spec.type}${spec.title ? ` · ${spec.title}` : ""}`} testID={`block-${id}`} controls={<>{web ? <SmallBtn label="Chart" on={!table} onPress={() => setTable(false)} testID={`chart-tab-${id}`} /> : null}<SmallBtn label="Table" on={table} onPress={() => setTable(true)} testID={`table-tab-${id}`} /><SmallBtn label="Copy CSV" onPress={() => copyText(csv)} testID={`chart-csv-${id}`} /></>}>
      {!table && web ? <View style={st.chartBody} testID={`chart-${id}`}>{svgChart(g, spec)}{legend ? <View style={st.legend}>{legend}</View> : null}</View> : (
        <ScrollView horizontal showsHorizontalScrollIndicator testID={`chart-table-${id}`}>
          <View>
            <View style={st.tr}>{t.head.map((h, i) => <Text key={i} style={[st.td, st.th]}>{h}</Text>)}</View>
            {t.rows.map((r, ri) => <View key={ri} style={[st.tr, ri % 2 === 1 && st.trAlt]}>{r.map((c, ci) => <Text key={ci} style={st.td}>{c}</Text>)}</View>)}
          </View>
        </ScrollView>
      )}
    </Frame>
  );
}

export type ExtraBlock = Extract<Block, { kind: "callout" | "details" | "img" | "fn" | "math" | "mermaid" | "chart" }>;

const st = StyleSheet.create({
  grow: { flex: 1 },
  frame: { borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 10, overflow: "hidden", marginBottom: 12, backgroundColor: "var(--win)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, minHeight: 30, backgroundColor: "var(--sunk)" as string, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  headLabel: { color: "var(--ink-3)" as string, fontSize: 12 },
  small: { height: 22, paddingHorizontal: 8, borderRadius: 5, justifyContent: "center" },
  smallOver: { backgroundColor: "var(--hover)" as string },
  smallOn: { backgroundColor: "var(--accent-wash)" as string },
  smallText: { color: "var(--ink-2)" as string, fontSize: 12 },
  smallTextOn: { color: "var(--accent)" as string },
  pre: { backgroundColor: "var(--sunk)" as string, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 },
  codeHead: { flexDirection: "row", alignItems: "center", marginBottom: 6, marginHorizontal: -6 },
  lang: { flex: 1, color: "var(--ink-3)" as string, fontSize: 11.5, paddingLeft: 6 },
  preText: { color: "var(--ink)" as string, fontFamily: MONO, fontSize: 13, lineHeight: 20, padding: 10 },
  callout: { borderLeftWidth: 3, borderRadius: 6, backgroundColor: "var(--sunk)" as string, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 12 },
  coTitle: { fontSize: 12.5, fontWeight: "600", marginBottom: 2 },
  details: { borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 8, marginBottom: 12 },
  summary: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  chev: { color: "var(--ink-3)" as string, fontSize: 12, width: 12 },
  summaryText: { color: "var(--ink)" as string, fontSize: 15, fontWeight: "500", flex: 1 },
  detailsBody: { paddingHorizontal: 12, paddingTop: 2 },
  lb: { position: "fixed" as unknown as "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 300, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: 24 },
  lbBody: { backgroundColor: "var(--win)" as string, borderRadius: 12, padding: 16, maxWidth: "94%", maxHeight: "90%", overflow: "hidden" },
  imgWrap: { marginBottom: 12, alignItems: "flex-start" },
  caption: { color: "var(--ink-3)" as string, fontSize: 12.5, marginTop: 4 },
  alt: { color: "var(--ink-3)" as string },
  fn: { flexDirection: "row", gap: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: "var(--line)" as string, marginBottom: 6 },
  fnId: { color: "var(--ink-3)" as string, fontSize: 12, lineHeight: 18 },
  fnText: { flex: 1, color: "var(--ink-3)" as string, fontSize: 13, lineHeight: 18 },
  mathBlock: { alignItems: "center", paddingVertical: 8, marginBottom: 8 },
  mathFallback: { fontFamily: MONO, fontSize: 13, color: "var(--ink)" as string, fontStyle: "italic" },
  mathFallbackBlock: { fontFamily: MONO, fontSize: 15, color: "var(--ink)" as string, fontStyle: "italic", textAlign: "center" },
  dg: { padding: 12, alignItems: "center" },
  note: { color: "var(--ink-3)" as string, fontSize: 12.5, paddingHorizontal: 12, paddingVertical: 6 },
  error: { color: "var(--danger)" as string, fontSize: 12.5, paddingHorizontal: 12, paddingTop: 8 },
  chartBody: { padding: 12 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 14, paddingTop: 8 },
  lg: { flexDirection: "row", alignItems: "center", gap: 6 },
  lgDot: { width: 9, height: 9, borderRadius: 2 },
  lgText: { color: "var(--ink-3)" as string, fontSize: 12 },
  tr: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  trAlt: { backgroundColor: "var(--sunk)" as string },
  td: { minWidth: 90, paddingHorizontal: 12, paddingVertical: 6, color: "var(--ink)" as string, fontSize: 13.5 },
  th: { fontWeight: "600" },
});
