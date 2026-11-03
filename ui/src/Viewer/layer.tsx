// ui/Viewer, the Redaction for AI layer (owner 3 Nov, rc.20): how redactions, highlights and comment anchors look to people, the selection bar (Highlight, Redact, Comment, Ask), the hover card,
// and Preview as agent. People see the original: a redaction is a fine diagonal hatch with a dashed underline and an eye-slash glyph (warm graphite in Light, a soft light grey in Black, never
// white); a highlight is the Space accent at 20% (Light) or 28% (Black); a comment anchor is a dotted accent underline. Preview as agent shows what agents read: [REDACTED] chips and solid boxes.
// The look is CSS on web (a hatch is a background image, which a React Native style cannot say), put in once through injectCss; elsewhere a redaction falls back to a quiet tint.

import { useEffect } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { injectCss } from "../theme/css.ts";
import { MenuIcon } from "../Menu/index.tsx";

/** One mark of the layer as the viewer draws it. `by` and `when` are already words ("Irfad Imtiaz (Agent)", "9:41 today"). */
export interface ViewerMark {
  id: string;
  kind: "redact" | "highlight";
  shape: "span" | "box" | "range" | "name";
  text?: string;
  occurrence?: number;
  box?: { x: number; y: number; w: number; h: number };
  label?: string;
  by: string;
  /** Who else highlighted the same words: one tint, a small stack of faces in the card. */
  people?: readonly string[];
  when: string;
}
export interface ViewerLayer {
  marks: readonly ViewerMark[];
  /** Preview as agent: the blocks are the agent's text, with [REDACTED] and ==highlight== marks in it. */
  preview?: boolean;
  /** Anyone who can open the file may highlight and redact; only a person may un-redact. */
  canMark?: boolean;
}
export type LayerAct = { kind: "highlight" | "redact"; shape: "span"; text: string; occurrence: number } | { kind: "redact"; shape: "box"; box: { x: number; y: number; w: number; h: number } };

export const REDACTED = "[REDACTED]";
const EYE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.7' stroke-linecap='round'%3E%3Cpath d='M1.8 8s2.4-4.2 6.2-4.2c1.2 0 2.3.4 3.2.9M14.2 8s-2.4 4.2-6.2 4.2c-1.2 0-2.3-.4-3.2-.9M6.5 9.5a2 2 0 012.9-2.9M2.5 13.5l11-11'/%3E%3C/svg%3E";
const EYE_B = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%234D4236' stroke-width='1.7' stroke-linecap='round'%3E%3Cpath d='M1.8 8s2.4-4.2 6.2-4.2c1.2 0 2.3.4 3.2.9M14.2 8s-2.4 4.2-6.2 4.2c-1.2 0-2.3-.4-3.2-.9M6.5 9.5a2 2 0 012.9-2.9M2.5 13.5l11-11'/%3E%3C/svg%3E";
export const LAYER_CSS = `
:root{--rx-h:rgba(77,66,54,.30);--rx-u:rgba(77,66,54,.70);--rx-w:rgba(77,66,54,.04);--rx-hl:color-mix(in srgb,var(--accent) 20%,transparent);--rx-ai:#17141F;--rx-ai-ink:#FFFFFF}
:root[data-theme="dark"],:root[data-mode="dark"]{--rx-h:rgba(205,200,220,.20);--rx-u:rgba(205,200,220,.62);--rx-w:rgba(205,200,220,.04);--rx-hl:color-mix(in srgb,var(--accent) 28%,transparent);--rx-ai:#000000;--rx-ai-ink:#F2F0F7}
[data-rdx="1"]{background-color:var(--rx-w);background-image:repeating-linear-gradient(135deg,var(--rx-h) 0 1px,transparent 1px 5px);text-decoration:underline dashed var(--rx-u) 1px;text-underline-offset:3px;text-decoration-skip-ink:none;border-radius:2px;padding:0 1px;-webkit-box-decoration-break:clone;box-decoration-break:clone;cursor:default}
[data-rdx="1"]::before{content:"";display:inline-block;width:10px;height:10px;margin:0 3px 0 0;vertical-align:-1px;background:var(--rx-u);-webkit-mask:url("${EYE}") center/contain no-repeat;mask:url("${EYE}") center/contain no-repeat}
[data-rdx="1"] [data-rdx="1"]::before{display:none}
[data-hlt="1"]{background-color:var(--rx-hl);border-radius:2px;padding:0 1px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
[data-cmk="1"]{text-decoration:underline dotted var(--accent) 1.5px;text-underline-offset:4px}
[data-cmk="1"] [data-rdx="1"]{text-decoration:underline dashed var(--rx-u) 1px}
[data-rxtok="1"]{background:var(--rx-ai);color:var(--rx-ai-ink);font:600 10.5px/16px var(--mono,ui-monospace,monospace);letter-spacing:.02em;padding:1px 4px;border-radius:3px;white-space:nowrap}
[data-rxbox="1"]{background-color:rgba(244,240,232,.12);background-image:repeating-linear-gradient(135deg,rgba(77,66,54,.34) 0 1.5px,transparent 1.5px 7px);outline:1px dashed rgba(77,66,54,.75);outline-offset:-1px;border-radius:3px}
[data-rxbox="1"]::after{content:"";position:absolute;top:3px;right:3px;width:14px;height:14px;border-radius:4px;background:rgba(255,255,255,.92) url("${EYE_B}") center/10px no-repeat;box-shadow:0 0 0 1px rgba(77,66,54,.25)}
[data-rxbox="ai"]{background:#000;outline:0;border-radius:3px}
[data-rdx="1"]:focus-visible,[data-hlt="1"]:focus-visible{outline:2px solid var(--accent-line);outline-offset:1px}
`;

/** Put the layer's look in once (web). */
export function useLayerCss(): void {
  useEffect(() => { if (Platform.OS === "web" && typeof document !== "undefined") injectCss(document as never, "vy-viewer-layer", LAYER_CSS); }, []);
}

/** Starts of every match of `needle` in `text`, not overlapping. */
export function occurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let from = 0; ;) { const i = text.indexOf(needle, from); if (i < 0) return out; out.push(i); from = i + needle.length; }
}

export interface Span { s: number; e: number; mark: ViewerMark }
/**
 * Where each span mark sits, block by block. `occurrence` counts matches across the whole file in block order (as the server counts them in the file's text); a mark with none covers every match.
 */
export function layerSpans(texts: readonly string[], marks: readonly ViewerMark[]): Span[][] {
  const out: Span[][] = texts.map(() => []);
  for (const m of marks) {
    if (m.shape === "box" || m.shape === "name" || !m.text) continue;
    let seen = 0;
    texts.forEach((t, bi) => {
      for (const at of occurrences(t, m.text!)) {
        if (m.occurrence === undefined || m.occurrence === seen) out[bi]!.push({ s: at, e: at + m.text!.length, mark: m });
        seen++;
      }
    });
  }
  return out;
}

/** The runs of one block's words: each piece with the marks over it, outermost (longest) first, so a redaction inside a highlight draws its hatch over the tint. */
export function layerRuns(text: string, spans: readonly Span[]): { text: string; marks: ViewerMark[] }[] {
  if (!spans.length) return [{ text, marks: [] }];
  const cuts = new Set<number>([0, text.length]);
  for (const sp of spans) { cuts.add(sp.s); cuts.add(sp.e); }
  const pts = [...cuts].sort((a, b) => a - b);
  const out: { text: string; marks: ViewerMark[] }[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    if (a === b) continue;
    const over = spans.filter((sp) => sp.s <= a && b <= sp.e).sort((x, y) => (y.e - y.s) - (x.e - x.s)).map((sp) => sp.mark);
    out.push({ text: text.slice(a, b), marks: over });
  }
  return out;
}

/** The text an agent reads, as it is shown in Preview as agent: [REDACTED] chips and ==highlight== tints. */
export function previewRuns(text: string): { text: string; tok?: boolean; hl?: boolean }[] {
  const out: { text: string; tok?: boolean; hl?: boolean }[] = [];
  const re = /\[REDACTED\]|==([^=]+?)==/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[0] === REDACTED) out.push({ text: REDACTED, tok: true });
    else out.push(...previewRuns(m[1] ?? "").map((r) => ({ ...r, hl: true })));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const webAttr = (p: Record<string, string>): Record<string, unknown> => (Platform.OS === "web" ? { dataSet: p } : {});

/** One block's words with the layer drawn on them. Comments come in as spans too (`comment` ids), drawn as the dotted underline. */
export function LayerText({ runs, comments, onHover }: { runs: readonly { text: string; marks: readonly ViewerMark[]; comment?: string }[]; comments?: boolean; onHover?: (id: string | null) => void }): ReactElement {
  void comments;
  const out: ReactNode[] = [];
  runs.forEach((r, i) => {
    let node: ReactNode = r.text;
    if (r.comment !== undefined) node = <Text key={`c${i}`} {...webAttr({ cmk: "1", comment: r.comment })}>{node}</Text>;
    // innermost first, so the outermost wraps it
    for (const m of [...r.marks].reverse()) {
      const attr = m.kind === "redact" ? { rdx: "1", mark: m.id } : { hlt: "1", mark: m.id };
      node = <Text key={`${m.id}-${i}`} accessibilityLabel={m.kind === "redact" ? `Hidden from AI: ${r.text}` : `Highlighted: ${r.text}`} style={Platform.OS === "web" ? undefined : m.kind === "redact" ? s.rdxNative : s.hltNative}
        {...webAttr(attr)} {...(onHover ? { onHoverIn: () => onHover(m.id), onHoverOut: () => onHover(null) } : {})}>{node}</Text>;
    }
    out.push(<Text key={i}>{node}</Text>);
  });
  return <>{out}</>;
}

/** Preview as agent: the agent's words with its chips. */
export function PreviewText({ text }: { text: string }): ReactElement {
  return <>{previewRuns(text).map((r, i) => (r.tok ? <Text key={i} style={Platform.OS === "web" ? undefined : s.tokNative} {...webAttr({ rxtok: "1" })}>{r.text}</Text> : r.hl ? <Text key={i} {...webAttr({ hlt: "1" })} style={Platform.OS === "web" ? undefined : s.hltNative}>{r.text}</Text> : <Text key={i}>{r.text}</Text>))}</>;
}

const SVG = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">`;
export const LAYER_ICON = {
  eyeoff: `${SVG}<path d="M1.8 8s2.4-4.2 6.2-4.2c1.2 0 2.3.4 3.2.9M14.2 8s-2.4 4.2-6.2 4.2c-1.2 0-2.3-.4-3.2-.9"/><path d="M6.5 9.5a2 2 0 012.9-2.9M2.5 13.5l11-11"/></svg>`,
  marker: `${SVG}<path d="M10 2.8l3.2 3.2-5.6 5.6H4.4V8.4z"/><path d="M8.6 4.2l3.2 3.2M2.5 13.5h11"/></svg>`,
  reply: `${SVG}<path d="M6 4L2.5 7.5 6 11"/><path d="M2.5 7.5H9a4.5 4.5 0 014.5 4.5v1"/></svg>`,
  pulse: `${SVG}<path d="M1.8 8.5h2.7l1.8-4.5 3 8.5 1.9-4h3"/></svg>`,
  restore: `${SVG}<path d="M3 8a5 5 0 105-5H5.5M5.5 3L3.2 5.3 5.5 7.6"/></svg>`,
  x: `${SVG}<path d="M4 4l8 8M12 4l-8 8"/></svg>`,
} as const;

function Icon({ svg }: { svg: string }): ReactElement { return <MenuIcon icon={svg} />; }

/** The bar over a selection: Highlight (the team sees it), Redact (AI only ever sees [REDACTED]), Comment, and Ask. */
export function SelectionBar(p: { at: { x: number; y: number }; agentName: string; onHighlight(): void; onRedact(): void; onComment(): void; onAsk?: () => void }): ReactElement {
  const b = (label: string, icon: string, testID: string, onPress: () => void, hint?: string): ReactElement => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} {...(hint ? { accessibilityHint: hint } : {})} testID={testID} onPress={onPress}
      style={({ hovered }: { hovered?: boolean }) => [s.selBtn, hovered === true && s.selOver]}><Icon svg={icon} /><Text style={s.selText}>{label}</Text></Pressable>
  );
  return (
    <View style={[s.selBar, { left: p.at.x, top: p.at.y }]} testID="vw-selbar" accessibilityRole="toolbar" accessibilityLabel="Selection">
      {b("Highlight", LAYER_ICON.marker, "vw-sel-highlight", p.onHighlight, "Everyone on the team sees it")}
      {b("Redact", LAYER_ICON.eyeoff, "vw-sel-redact", p.onRedact, "AI only ever sees [REDACTED]")}
      {b("Comment", LAYER_ICON.reply, "vw-sel-comment", p.onComment)}
      {p.onAsk ? <><View style={s.selSep} />{b("Ask", LAYER_ICON.pulse, "vw-sel-ask", p.onAsk, `Ask ${p.agentName} about this`)}</> : null}
    </View>
  );
}

/** The card a redaction or a highlight shows on hover or focus: who and when, and Un-redact or Remove highlight, Comment, Activity. */
export function MarkCard(p: { mark: ViewerMark; at: { x: number; y: number }; canUnmark: boolean; onUnmark(): void; onComment(): void; onActivity(): void; onEnter?(): void; onLeave?(): void }): ReactElement {
  const m = p.mark, red = m.kind === "redact";
  const act = (label: string, icon: string, testID: string, onPress: () => void): ReactElement => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} testID={testID} onPress={onPress} style={({ hovered }: { hovered?: boolean }) => [s.cardAct, hovered === true && s.selOver]}><Icon svg={icon} /><Text style={s.cardActText}>{label}</Text></Pressable>
  );
  return (
    <View style={[s.card, { left: p.at.x, top: p.at.y }]} testID={`vw-markcard-${m.id}`} accessibilityRole="summary" {...({ onMouseEnter: p.onEnter, onMouseLeave: p.onLeave } as object)}>
      <View style={s.cardHead}><Icon svg={red ? LAYER_ICON.eyeoff : LAYER_ICON.marker} /><Text style={s.cardTitle}>{red ? "Hidden from AI" : "Highlight"}</Text><View style={s.grow} /><Text style={s.cardKind}>{red ? m.label ?? "Text" : "Everyone on the team"}</Text></View>
      <Text style={s.cardWho}>{`${red ? "Redacted by " : ""}${m.by} · ${m.when}`}</Text>
      <View style={s.cardActs}>
        {p.canUnmark ? act(red ? "Un-redact" : "Remove highlight", red ? LAYER_ICON.restore : LAYER_ICON.x, "vw-card-unmark", p.onUnmark) : null}
        {act("Comment", LAYER_ICON.reply, "vw-card-comment", p.onComment)}
        <View style={s.grow} />
        {act("Activity", LAYER_ICON.pulse, "vw-card-activity", p.onActivity)}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  grow: { flex: 1 },
  rdxNative: { backgroundColor: "rgba(77,66,54,0.10)", textDecorationLine: "underline", textDecorationStyle: "dashed" },
  hltNative: { backgroundColor: "var(--accent-wash)" as string },
  tokNative: { backgroundColor: "#17141F", color: "#FFFFFF", fontSize: 11, fontWeight: "600" },
  selBar: { position: "absolute", zIndex: 20, flexDirection: "row", alignItems: "center", gap: 2, padding: 3, borderRadius: 9, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" } as never,
  selBtn: { height: 28, paddingHorizontal: 9, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 6 },
  selOver: { backgroundColor: "var(--hover)" as string },
  selText: { color: "var(--ink)" as string, fontSize: 12.5, fontWeight: "500" },
  selSep: { width: 1, alignSelf: "stretch", marginVertical: 4, marginHorizontal: 2, backgroundColor: "var(--line-2)" as string },
  card: { position: "absolute", zIndex: 21, width: 272, paddingTop: 10, paddingHorizontal: 12, paddingBottom: 8, borderRadius: 11, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" } as never,
  cardHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  cardTitle: { color: "var(--ink)" as string, fontSize: 12.5, fontWeight: "600" },
  cardKind: { color: "var(--ink-3)" as string, fontSize: 11.5 },
  cardWho: { marginTop: 6, color: "var(--ink-2)" as string, fontSize: 12.5, lineHeight: 18 },
  cardActs: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 8, marginHorizontal: -6, paddingTop: 6, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  cardAct: { height: 26, paddingHorizontal: 7, borderRadius: 6, flexDirection: "row", alignItems: "center", gap: 5 },
  cardActText: { color: "var(--ink-2)" as string, fontSize: 12, fontWeight: "500" },
});
