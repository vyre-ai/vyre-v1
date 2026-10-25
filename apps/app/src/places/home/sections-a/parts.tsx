// Shared pieces of the Home sections: the section header, the row with its hover tools, faces, small buttons, icons, the empty and loading lines.
// Sizes and colours are the prototype's Home (vyre-v1.html, Home): rows are 44 high with the hover and selection paint running 10 px past the text column, the
// ... button appears on hover, selection or keyboard focus, and every colour is a skin token so a skin switch repaints with no re-render.
import { createElement, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { useSelection } from "./data.tsx";

export const DOUBLE_MS = 450;

/** Phone widths drop the secondary columns (record chip) and keep the title, the face and the date. */
export function useNarrow(): boolean {
  return useWindowDimensions().width < 560;
}

// ---------------------------------------------------------------- icons

/** 16 px viewBox stroke icons, from the prototype's Home. */
export const ICON = {
  more: ["M3.5 8h.01", "M8 8h.01", "M12.5 8h.01"],
  check: ["M3 8.5l3 3 7-7"],
  done: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M5.6 8.1l1.7 1.7 3.1-3.4"],
  x: ["M4 4l8 8M12 4l-8 8"],
  project: ["M5 2.5h6A2.5 2.5 0 0113.5 5v6a2.5 2.5 0 01-2.5 2.5H5A2.5 2.5 0 012.5 11V5A2.5 2.5 0 015 2.5z", "M5.5 6h5M5.5 8.5h5M5.5 11h2.5"],
  record: ["M3.2 4.5v7c0 1.1 2.1 2 4.8 2s4.8-.9 4.8-2v-7", "M3.2 8c0 1.1 2.1 2 4.8 2s4.8-.9 4.8-2", "M12.8 4.5c0 1.1-2.1 2-4.8 2s-4.8-.9-4.8-2 2.1-2 4.8-2 4.8.9 4.8 2z"],
  person: ["M10.5 5.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z", "M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"],
  run: ["M3 8a5 5 0 109.5-2.2M13 2.5v3h-3"],
  chat: ["M3 4.5A2 2 0 015 2.5h6a2 2 0 012 2v4.5a2 2 0 01-2 2H7l-3 2.5V11a2 2 0 01-1-1.7z"],
  clock: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M8 5v3l2 1.5"],
  decision: ["M8 2l5 1.8v4c0 3-2.2 5-5 6.2C5.2 12.8 3 10.8 3 7.8v-4z", "M5.6 8.1l1.7 1.7 3.1-3.4"],
  change: ["M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z"],
  waiting: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M8 5v3.4M8 10.8h.01"],
  list: ["M5.5 4.5h8M5.5 8h8M5.5 11.5h8M2.5 4.5h.01M2.5 8h.01M2.5 11.5h.01"],
} as const;
export type IconName = keyof typeof ICON;

/** One stroke icon. Web only (an SVG); other platforms draw nothing until their own icon set lands. */
export function Glyph({ name, size = 15, color = "var(--ink-3)", fill }: { name: IconName; size?: number; color?: string; fill?: string }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const paths: ReactElement[] = [];
  for (const d of ICON[name]) paths.push(createElement("path", { key: d, d, fill: fill ?? "none" }));
  return createElement(
    "svg",
    { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: name === "more" ? 2.4 : 1.4, strokeLinecap: "round", strokeLinejoin: "round" } },
    ...paths,
  );
}

/** The task status circle: to do (empty, tick on hover), doing, review, blocked, done. */
export function StatusCircle({ status, size = 15, hovered = false }: { status: "todo" | "doing" | "review" | "blocked" | "done"; size?: number; hovered?: boolean }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const base = { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, "data-status": status, style: { display: "block", flex: "none" } };
  const c = (a: Record<string, unknown>) => createElement("circle", { cx: 8, cy: 8, ...a });
  const p = (a: Record<string, unknown>) => createElement("path", { fill: "none", strokeLinecap: "round", strokeLinejoin: "round", ...a });
  if (status === "done") return createElement("svg", base, c({ r: 7, fill: "var(--ok)" }), p({ d: "M5 8.2l2.2 2.2L11 6", stroke: "#fff", strokeWidth: 1.7 }));
  if (status === "doing") return createElement("svg", base, c({ r: 6.2, fill: "none", stroke: "var(--accent)", strokeWidth: 1.6 }), createElement("path", { d: "M8 4.6a3.4 3.4 0 010 6.8z", fill: "var(--accent)" }));
  if (status === "review") return createElement("svg", base, c({ r: 6.2, fill: "none", stroke: "var(--accent)", strokeWidth: 1.6 }), c({ r: 2.3, fill: "var(--accent)" }));
  if (status === "blocked") return createElement("svg", base, c({ r: 6.2, fill: "none", stroke: "var(--warn)", strokeWidth: 1.6 }), p({ d: "M5.2 8h5.6", stroke: "var(--warn)", strokeWidth: 1.8 }));
  return createElement("svg", base, c({ r: 6.2, fill: "none", stroke: "var(--ink-4)", strokeWidth: 1.6 }), p({ d: "M5.2 8.2l1.9 1.9L10.9 6", stroke: "var(--ink-3)", strokeWidth: 1.6, opacity: hovered ? 1 : 0 }));
}

// ---------------------------------------------------------------- faces

export function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

function initialsOf(words: readonly string[]): string {
  let out = "";
  for (const w of words.slice(0, 2)) out += w[0]!.toUpperCase();
  return out;
}

export function initials(name: string, size: number, kind: "person" | "agent" | string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (kind === "person" && size >= 24) return initialsOf(words);
  return (words[0]?.[0] ?? "?").toUpperCase();
}

/** A person is a circle, an agent a rounded square; the colour comes from the name, mixed into the surface so it reads in every skin. */
export function Face({ name, kind = "person", size = 20 }: { name: string; kind?: string; size?: number }): ReactElement {
  const hue = (hash(name) % 12) * 30;
  const tb = `hsla(${hue}, 65%, 52%, 0.22)`;   // translucent, so it reads on any skin's surface
  const tk = `hsl(${hue}, 55%, 46%)`;
  return (
    <View
      aria-hidden
      testID={`face-${name}`}
      style={{ width: size, height: size, borderRadius: kind === "person" ? size : Math.round(size * 0.3), backgroundColor: tb as string, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ color: tk as string, fontSize: Math.max(9, Math.round(size * 0.48)), fontWeight: "600", letterSpacing: -0.1 }}>{initials(name, size, kind)}</Text>
    </View>
  );
}

// ---------------------------------------------------------------- section header, empty and loading

export function SectionHeader({ id, title, count, children }: { id: string; title: string; count?: string | number | undefined; children?: ReactNode }): ReactElement {
  return (
    <View style={s.head} testID={`${id}-head`}>
      <Text accessibilityRole="header" style={s.h2}>
        {title}
        {count !== undefined && count !== "" ? <Text style={s.count}>{`  ${count}`}</Text> : null}
      </Text>
      <View style={s.grow} />
      {children}
    </View>
  );
}

export function Section({ id, children, first = false }: { id: string; children: ReactNode; first?: boolean }): ReactElement {
  return <View testID={id} accessibilityLabel={id} style={first ? s.sectionFirst : s.section}>{children}</View>;
}

export function EmptyLine({ text, id }: { text: string; id: string }): ReactElement {
  return (
    <View style={s.empty} testID={`${id}-empty`} accessibilityRole="summary">
      <Glyph name="done" size={16} color="var(--ok)" />
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}

/** Rows the size of the real ones, so nothing moves when the data arrives. */
export function Skeleton({ rows, id }: { rows: number; id: string }): ReactElement {
  const bars: ReactElement[] = [];
  for (let i = 0; i < rows; i++) {
    bars.push(
      <View key={i} style={s.skRow}>
        <View style={s.skFace} />
        <View style={s.skLines}><View style={[s.skBar, { width: `${48 + ((i * 13) % 30)}%` }]} /><View style={[s.skBar, s.skSmall, { width: `${30 + ((i * 7) % 20)}%` }]} /></View>
      </View>,
    );
  }
  return <View testID={`${id}-loading`} accessibilityLabel="Loading" style={{ minHeight: rows * 44 }}>{bars}</View>;
}

export function LinkButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} testID={testID} style={[s.link, over && s.linkOver]}>
      <Text style={[s.linkText, over && s.linkTextOver]}>{label}</Text>
    </Pressable>
  );
}

export function PrimaryButton({ label, onPress, tone = "accent", testID }: { label: string; onPress: () => void; tone?: "accent" | "warn"; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  const warn = tone === "warn";
  // a wash of the tone over the surface: a translucent layer, so it follows every skin (the accent also has its own wash token)
  const layer = warn ? (over ? 0.24 : 0.14) : over ? 0.14 : 0;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} testID={testID}
      style={[s.pbtn, warn ? null : s.pbtnAccent]}
    >
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.pbtnLayer, { backgroundColor: (warn ? "var(--warn)" : "var(--accent)") as string, opacity: layer }]} />
      <Text style={[s.pbtnText, { color: (warn ? "var(--warn)" : "var(--accent)") as string }]}>{label}</Text>
    </Pressable>
  );
}

function rectOf(e: unknown): { x: number; y: number } {
  const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
  const box = ev.currentTarget?.getBoundingClientRect?.();
  if (box) return { x: box.left, y: box.bottom };
  return { x: ev.nativeEvent?.pageX ?? 0, y: ev.nativeEvent?.pageY ?? 0 };
}

/** The ... button of a row. It shows on hover, selection and keyboard focus and opens the same menu as a right-click. */
export function MoreButton({ visible, label, onOpen, inline = false }: { visible: boolean; label: string; onOpen: (x: number, y: number) => void; inline?: boolean }): ReactElement {
  const [focus, setFocus] = useState(false);
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} testID="row-more"
      onPress={(e) => { const p = rectOf(e); onOpen(p.x, p.y); }}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
      style={[inline ? s.moreInline : s.more, { opacity: visible || focus ? 1 : 0 }, over && s.moreOver]}
    >
      <Glyph name="more" size={16} color={over ? "var(--ink)" : "var(--ink-3)"} />
    </Pressable>
  );
}

// ---------------------------------------------------------------- the row

export interface HRowProps {
  /** unique across the page: "need:tsk_1" */
  rowKey: string;
  label: string;
  /** Enter, or a second click inside 450 ms */
  onOpen?: (() => void) | undefined;
  /** right-click, the Menu key, long press and the ... button */
  onMenu?: ((x: number, y: number) => void) | undefined;
  /** space on the right kept free for the ... button (default true) */
  tools?: boolean;
  children: ReactNode;
}

/** Hover and selection paint the row's whole width. A second click inside 450 ms opens; Enter opens; arrows move; the Menu key and right-click open the row menu. */
export function HRow({ rowKey, label, onOpen, onMenu, tools = true, children }: HRowProps): ReactElement {
  const sel = useSelection();
  const [over, setOver] = useState(false);
  const last = useRef(0);
  const selected = sel.selected === rowKey;
  const trig = onMenu ? menuTrigger(onMenu) : {};
  const trigKey = (trig as { onKeyDown?: (e: unknown) => void }).onKeyDown;
  const keys = (e: { key?: string; preventDefault?: () => void }): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault?.(); sel.move(e.key === "ArrowDown" ? 1 : -1, rowKey); return; }
    if (e.key === "Enter" && onOpen) { e.preventDefault?.(); onOpen(); return; }
    trigKey?.(e);
  };
  return (
    <Pressable
      ref={(el) => sel.focusRef(rowKey, el as unknown as { focus?: () => void } | null)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      testID={`row-${rowKey}`}
      onPress={() => {
        sel.select(rowKey);
        const now = Date.now();
        if (onOpen && now - last.current < DOUBLE_MS) { last.current = 0; onOpen(); } else last.current = now;
      }}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      {...trig}
      {...{ onKeyDown: keys }}
      style={[s.row, over && s.rowOver, selected && s.rowSel, tools && s.rowTools]}
    >
      {children}
      {onMenu ? <MoreButton visible={over || selected} label={`More for ${label}`} onOpen={onMenu} /> : null}
    </Pressable>
  );
}

export function RowText({ title, sub, trailingTitle }: { title: string; sub?: ReactNode; trailingTitle?: ReactNode }): ReactElement {
  return (
    <View style={s.text}>
      <Text numberOfLines={1} style={s.title}>{title}{trailingTitle}</Text>
      {sub ? <Text numberOfLines={1} style={s.sub}>{sub}</Text> : null}
    </View>
  );
}

export const tone = {
  accent: { color: "var(--accent)" as string, fontWeight: "600" as const },
  warn: { color: "var(--warn)" as string, fontWeight: "600" as const },
  danger: { color: "var(--danger)" as string },
};

export const s = StyleSheet.create({
  section: { marginTop: 26, paddingTop: 14, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  sectionFirst: { marginTop: 0, paddingTop: 14, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28, marginBottom: 4 },
  grow: { flex: 1, minWidth: 0 },
  h2: { margin: 0, fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  count: { color: "var(--ink-3)" as string, fontWeight: "500", fontSize: 12 },
  empty: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  emptyText: { color: "var(--ink-3)" as string, fontSize: 13.5 },
  skRow: { flexDirection: "row", alignItems: "center", gap: 12, height: 44 },
  skFace: { width: 26, height: 26, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  skLines: { flex: 1, gap: 6 },
  skBar: { height: 10, borderRadius: 5, backgroundColor: "var(--sunk)" as string },
  skSmall: { height: 8 },
  link: { height: 24, paddingHorizontal: 8, borderRadius: 6, justifyContent: "center" },
  linkOver: { backgroundColor: "var(--hover)" as string },
  linkText: { color: "var(--ink-2)" as string, fontSize: 12.5, fontWeight: "500" },
  linkTextOver: { color: "var(--ink)" as string },
  pbtn: { height: 28, paddingHorizontal: 13, borderRadius: 7, justifyContent: "center" },
  pbtnAccent: { backgroundColor: "var(--accent-wash)" as string },
  pbtnLayer: { borderRadius: 7 },
  pbtnText: { position: "relative", fontSize: 12.5, fontWeight: "600" },
  more: { position: "absolute", right: 8, top: "50%", marginTop: -12, width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  moreInline: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  moreOver: { backgroundColor: "var(--press)" as string },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingVertical: 5, paddingLeft: 10, paddingRight: 10, marginHorizontal: -10, borderRadius: 9 },
  rowTools: { paddingRight: 40 },
  rowOver: { backgroundColor: "var(--hover)" as string },
  rowSel: { backgroundColor: "var(--sel)" as string },
  text: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, lineHeight: 20, fontWeight: "500", color: "var(--ink)" as string },
  sub: { fontSize: 12.5, lineHeight: 17, color: "var(--ink-3)" as string },
});
