// The one frame of every way into Vyre: the rail ground, one soft sheet, the Vyre mark with its coral spark, one heading, one primary action, one field, one error line, one progress line. Install, the
// lock screen, sign-in, register, recovery, join, create a Space and the setup waits are all drawn from these blocks, so they cannot drift apart. Tokens only (palette.ts): a skin or a dark window repaints
// with nothing to re-render, and the first frame can never be the wrong theme. The one motion is a soft fade between steps while the sheet eases to its new height; nothing slides.
import { Children, createContext, createElement, isValidElement, cloneElement, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Dimensions } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import { Avatar } from "../../../../ui/src/Avatar/index.tsx";
import { injectCss } from "../../../../ui/src/theme/css.ts";
import { ENTRY, FONT, MONO } from "./palette.ts";
import type { EntryPalette } from "./palette.ts";

interface Theme { p: EntryPalette; phone: boolean }
const ThemeCtx = createContext<Theme | null>(null);
export function useJoin(): Theme {
  const t = useContext(ThemeCtx);
  if (!t) throw new Error("join blocks render inside <JoinFrame>");
  return t;
}

const web = Platform.OS === "web";
const noOutline = (web ? { outlineStyle: "none", outlineWidth: 0 } : {}) as TextStyle;
const shadow = (v: string): ViewStyle => (web ? ({ boxShadow: v } as ViewStyle) : {});
// A focus ring for the keyboard only: a click does not leave a ring behind, a Tab or an arrow key does. One listener for the page, read when an element takes focus.
let keyboardFocus = false;
if (web && typeof document !== "undefined") {
  document.addEventListener("keydown", (e) => { if (e.key === "Tab" || e.key.startsWith("Arrow") || e.key === " " || e.key === "Enter") keyboardFocus = true; }, true);
  document.addEventListener("pointerdown", () => { keyboardFocus = false; }, true);
}
/** `ring` is true while the element has focus by keyboard; spread `handlers` on the Pressable or input. */
function useRing(): { ring: boolean; handlers: { onFocus(): void; onBlur(): void } } {
  const [ring, setRing] = useState(false);
  return { ring, handlers: { onFocus: () => setRing(keyboardFocus), onBlur: () => setRing(false) } };
}
const ringShadow = (p: EntryPalette, on: boolean): ViewStyle => (on ? shadow(`0 0 0 2px ${p.sheet}, 0 0 0 4px ${p.accent}`) : {});

// The motion lives in one stylesheet, so a person who asked for less motion gets none and the static page and the first client render are the same markup.
function ensureMotion(): void {
  injectCss((globalThis as { document?: Parameters<typeof injectCss>[0] }).document, "vyre-entry-motion",
    "@keyframes vyre-entry-fade{from{opacity:0}to{opacity:1}}"
    + "@keyframes vyre-entry-spin{to{transform:rotate(360deg)}}"
    + "@keyframes vyre-entry-run{0%{left:-34%}100%{left:100%}}"
    + "@keyframes vyre-entry-breathe{0%,100%{opacity:1}50%{opacity:.35}}"
    + "[data-entry-step]{animation:vyre-entry-fade 220ms ease both}"
    + "[data-entry-spin]{animation:vyre-entry-spin 800ms linear infinite}"
    + "[data-entry-run]{animation:vyre-entry-run 1600ms ease-in-out infinite}"
    + "[data-entry-wait] circle{animation:vyre-entry-breathe 1600ms ease-in-out infinite}"
    + "[data-entry-height]{transition:height 240ms cubic-bezier(.2,.8,.2,1)}"
    + "@media (prefers-reduced-motion: reduce){[data-entry-step],[data-entry-spin],[data-entry-run],[data-entry-wait] circle{animation:none!important}[data-entry-height]{transition:none!important}}");
}

// The window size as an external store: the static export is pre-rendered with no window, and a size read during the first render would keep the pre-rendered layout (the phone
// look on a wide window). The server snapshot is a desktop window; the client snapshot is the real one, so React corrects the page right after it hydrates.
interface Viewport { width: number; height: number }
const SERVER_VIEWPORT: Viewport = { width: 1280, height: 800 };
let viewport: Viewport = SERVER_VIEWPORT;
function readViewport(): Viewport {
  const w = (globalThis as { innerWidth?: number; innerHeight?: number });
  const size = typeof w.innerWidth === "number" && typeof w.innerHeight === "number" ? { width: w.innerWidth, height: w.innerHeight } : Dimensions.get("window");
  if (size.width !== viewport.width || size.height !== viewport.height) viewport = { width: size.width, height: size.height };
  return viewport;
}
function watchViewport(onChange: () => void): () => void {
  const g = globalThis as { addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void };
  g.addEventListener?.("resize", onChange);
  return () => g.removeEventListener?.("resize", onChange);
}
const useViewport = (): Viewport => useSyncExternalStore(watchViewport, readViewport, () => SERVER_VIEWPORT);

/** Phone layout from 640 wide down. */
export const PHONE_MAX = 640;
/** How wide the sheet is, and the shortest it gets, so most steps fade in place. */
export const SHEET_WIDTH = 420;
export const SHEET_MIN = 416;

// ---- the frame: the ground, the sheet, the mark

export function JoinFrame({ children }: { children: ReactNode }): ReactElement {
  const { width } = useViewport();
  const phone = width <= PHONE_MAX;
  const theme = useMemo(() => ({ p: ENTRY, phone }), [phone]);
  useEffect(ensureMotion, []);
  return (
    <ThemeCtx.Provider value={theme}>
      <View testID="join-frame" style={{ flex: 1, minHeight: "100%" as unknown as number, backgroundColor: ENTRY.ground, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>{children}</View>
      </View>
    </ThemeCtx.Provider>
  );
}

/** The Vyre mark: the V in the ink, the spark in the beacon. While `wait` the spark breathes. */
export function Mark({ size = 40, wait }: { size?: number; wait?: boolean }): ReactElement {
  if (!web) return <Text style={{ color: ENTRY.ink, fontSize: Math.round(size * 0.6), fontWeight: "700" }}>V</Text>;
  return createElement("svg", { viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": true, "data-icon": "vyre-mark", ...(wait ? { "data-entry-wait": "" } : {}), style: { display: "block", flex: "none" } },
    createElement("path", { d: "M5.2 6.4l6.3 11.2 4.9-8.6", fill: "none", stroke: ENTRY.ink, strokeWidth: 3.1, strokeLinecap: "round", strokeLinejoin: "round" }),
    createElement("circle", { cx: 18.6, cy: 5.6, r: 2.7, fill: ENTRY.spark }));
}

/** The Space's own letter, in place of the mark, once the screen is about one Space. */
export function SpaceTile({ name }: { name: string }): ReactElement {
  const { p } = useJoin();
  return <View testID="entry-space-tile" accessible={false} style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: p.accent, alignItems: "center", justifyContent: "center" }}><Text style={{ fontFamily: FONT, color: p.accentInk, fontSize: 17, fontWeight: "600" }}>{name.slice(0, 1).toUpperCase()}</Text></View>;
}

/** The sheet follows its content's height, so a taller step eases open instead of jumping. Web only, and only once the browser can tell us the height. */
function Eased({ children }: { children: ReactNode }): ReactElement {
  const outer = useRef<HTMLElement | null>(null);
  const inner = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const Observer = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    const from = inner.current, to = outer.current;
    if (!web || !Observer || !from || !to) return undefined;
    const o = new Observer(() => { to.style.height = `${from.offsetHeight}px`; });
    o.observe(from);
    return () => o.disconnect();
  }, []);
  return (
    <View ref={outer as never} {...(web ? { dataSet: { entryHeight: "" } } : {})} style={{ overflow: "hidden", width: "100%" }}>
      <View ref={inner as never} style={{ width: "100%" }}>{children}</View>
    </View>
  );
}

export interface PanelProps {
  children: ReactNode;
  bar?: ReactElement<BarProps>;
  /** the quiet ways out under the primary: <Links> */
  below?: ReactNode;
  /** a step that is working: the top line runs and the spark breathes */
  wait?: boolean;
  /** the Space's name, when the screen is about one Space: its tile takes the mark's place */
  space?: string;
  /** kept for callers that say the sheet is centred; every sheet is */
  center?: boolean;
}

export function Panel({ children, bar, below, wait, space }: PanelProps): ReactElement {
  const { p, phone } = useJoin();
  const back = bar?.props;
  const backRing = useRing();
  const steps = back?.steps;
  const step = Math.min(steps ?? 0, (back?.step ?? 0) + 1);
  return (
    <ScrollView style={{ width: "100%", flex: 1 }} contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingVertical: phone ? 12 : 24, paddingHorizontal: phone ? 12 : 24 }} keyboardShouldPersistTaps="handled">
      <View testID="join-panel" style={{ position: "relative", width: "100%", maxWidth: SHEET_WIDTH, backgroundColor: p.sheet, borderRadius: 20, overflow: "hidden", ...shadow(p.shadow) }}>
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, overflow: "hidden", zIndex: 2 }}>
          {wait
            ? <View testID="entry-run" accessibilityRole="progressbar" {...(web ? { dataSet: { entryRun: "" } } : {})} style={{ position: "absolute", top: 0, bottom: 0, width: "34%", backgroundColor: p.accent, borderRadius: 2 }} />
            : steps ? <View testID="dots" accessibilityRole="progressbar" accessibilityLabel={`Step ${step} of ${steps}`} aria-valuemin={1} aria-valuemax={steps} aria-valuenow={step} style={{ height: 2, width: `${Math.round((step / steps) * 100)}%`, backgroundColor: p.accent, borderBottomRightRadius: 2, borderTopRightRadius: 2 }} /> : null}
        </View>
        {back?.onBack && !back.hideBack ? (
          <Pressable
            accessibilityRole="button" accessibilityLabel="Back" onPress={back.onBack} testID="back" {...backRing.handlers}
            style={({ hovered }: { hovered?: boolean }) => ({ position: "absolute", left: 6, top: 6, zIndex: 3, width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: hovered ? p.hover : "transparent", ...ringShadow(p, backRing.ring) })}
          >
            <View style={{ transform: [{ rotate: "180deg" }] }}><Chevron color={p.ink3} /></View>
          </Pressable>
        ) : null}
        <Eased>
          <View style={{ minHeight: SHEET_MIN, paddingTop: 36, paddingHorizontal: phone ? 20 : 32, paddingBottom: 28, alignItems: "stretch" }}>
            <View testID="auth-form-mark" accessible={false} style={{ alignItems: "center", marginBottom: 18 }}>{space ? <SpaceTile name={space} /> : <Mark {...(wait ? { wait: true } : {})} />}</View>
            <View style={{ flexGrow: 1, flexShrink: 0 }}>{children}</View>
            {bar && back?.cont != null ? bar : null}
            {below ?? null}
          </View>
        </Eased>
      </View>
    </ScrollView>
  );
}

/** One step's content. A new id is a new step: it fades in, and only it. */
export function Step({ children, id }: { children: ReactNode; dir?: 1 | -1; id: string }): ReactElement {
  return <View key={id} testID={`step-${id}`} {...(web ? { dataSet: { entryStep: "" } } : {})} style={{ width: "100%", flexGrow: 1 }}>{children}</View>;
}

// ---- text

const base = (p: EntryPalette): TextStyle => ({ fontFamily: FONT, fontSize: 15, lineHeight: 21, color: p.ink });

export function Title({ title, sub }: { title: string; sub?: string | undefined }): ReactElement {
  const { p } = useJoin();
  return (
    <View>
      <Text accessibilityRole="header" style={[base(p), { textAlign: "center", fontSize: 22, lineHeight: 28, fontWeight: "600", letterSpacing: -0.4 }]}>{title}</Text>
      {sub ? <Text style={[base(p), { marginTop: 6, textAlign: "center", color: p.ink3, fontSize: 14, lineHeight: 20 }]}>{sub}</Text> : null}
    </View>
  );
}
export function Foot({ children, centre, top, testID }: { children: ReactNode; centre?: boolean; top?: number; testID?: string }): ReactElement {
  const { p } = useJoin();
  return <Text testID={testID} style={[base(p), { fontSize: 13, lineHeight: 18, color: p.ink3, marginTop: top ?? 10, textAlign: "center" }, centre === false ? { textAlign: "left" } : null]}>{children}</Text>;
}
export function Caption({ children }: { children: ReactNode }): ReactElement {
  const { p } = useJoin();
  return <Text style={[base(p), { fontSize: 12.5, lineHeight: 16, color: p.ink3, fontWeight: "500", marginTop: 18, marginBottom: 6 }]}>{children}</Text>;
}

/** The one error line. Its place is held while it is empty, so a failure appears where the eye already is and the primary action does not move. */
export function ErrorLine({ children, testID }: { children?: ReactNode; testID?: string }): ReactElement {
  const { p } = useJoin();
  if (children === null || children === undefined || children === "" || children === false) return <View style={{ minHeight: 20, marginTop: 8 }} />;
  return (
    <View accessibilityRole="alert" style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, minHeight: 20, marginTop: 8 }}>
      <Glyph kind="alert" size={16} color={p.danger} />
      <Text testID={testID} style={[base(p), { flex: 1, fontSize: 13, lineHeight: 18, color: p.danger }]}>{children}</Text>
    </View>
  );
}

/** A quiet line where the error line would be: what is happening, or a calm note. */
export function QuietLine({ children, testID }: { children: ReactNode; testID?: string }): ReactElement {
  const { p } = useJoin();
  return <Text testID={testID} accessibilityLiveRegion="polite" style={[base(p), { fontSize: 13, lineHeight: 18, color: p.ink3, marginTop: 8, minHeight: 20, textAlign: "center" }]}>{children}</Text>;
}

/** A second action: a quiet word under the primary. Every one is at least 44 px to press. */
export function TextButton({ label, onPress, testID, small, disabled }: { label: string; onPress?: () => void; testID?: string; small?: boolean; disabled?: boolean }): ReactElement {
  const { p } = useJoin();
  const r = useRing();
  return (
    <Pressable
      accessibilityRole="button" disabled={disabled} onPress={onPress} testID={testID} {...r.handlers}
      style={({ pressed }: { pressed?: boolean }) => ({ minWidth: 44, minHeight: 44, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.45 : pressed ? 0.6 : 1, borderRadius: 10, ...ringShadow(p, r.ring) })}
    >
      {({ hovered }: { hovered?: boolean }) => <Text style={[base(p), { color: hovered && !disabled ? p.ink : p.ink3, fontSize: small ? 12.5 : 13, lineHeight: 18, fontWeight: "500" }]}>{label}</Text>}
    </Pressable>
  );
}

/** The quiet words under a primary, side by side. */
export function Links({ children, top }: { children: ReactNode; top?: number }): ReactElement {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 8, marginTop: top ?? 6, marginBottom: -12 }}>{children}</View>;
}

/** The primary action: the accent fill, full width, 44 px. Disabled it is a quiet neutral, so it reads as not yet available rather than as a faded accent. While `busy` a small ring turns beside the word. */
export function Button({ label, onPress, disabled, large, testID, quiet, busy }: { label: string; onPress?: (() => void) | undefined; disabled?: boolean; large?: boolean; testID?: string; quiet?: boolean; busy?: boolean }): ReactElement {
  const { p } = useJoin();
  const r = useRing();
  void large;
  const off = !!disabled || !!busy;
  return (
    <Pressable
      accessibilityRole="button" aria-disabled={off} aria-busy={!!busy} disabled={off} onPress={onPress} testID={testID} {...r.handlers}
      style={({ pressed }: { pressed?: boolean }) => ({ minHeight: 44, alignItems: "stretch", justifyContent: "center", flexShrink: 0, opacity: pressed ? 0.88 : 1, borderRadius: 10, ...ringShadow(p, r.ring) })}
    >
      {({ hovered }: { hovered?: boolean }) => (
        <View style={{ minHeight: 44, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, borderRadius: 10, backgroundColor: off && !busy ? p.field : quiet ? (hovered ? p.hover : p.field) : p.accent, opacity: hovered && !off && !quiet ? 0.92 : 1, ...(quiet ? shadow(`inset 0 0 0 1px ${p.fieldLine}`) : {}) }}>
          {busy ? <Spinner size={16} color={quiet ? p.ink3 : p.accentInk} /> : null}
          <Text numberOfLines={1} style={[base(p), { color: off && !busy ? p.ink4 : quiet ? p.ink : p.accentInk, fontSize: 15, fontWeight: "600" }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ---- icons: one line set, one stroke

export type GlyphKind = "person" | "laptop" | "clock" | "ai" | "lock" | "key" | "team" | "link" | "server" | "mail" | "download" | "alert" | "eye" | "eyeOff" | "copy" | "file";
const GLYPH: Record<GlyphKind, ReactElement[]> = {
  person: [createElement("circle", { key: "a", cx: 12, cy: 8.5, r: 4 }), createElement("path", { key: "b", d: "M4.5 20c.8-4 3.8-6 7.5-6s6.700 2 7.500 6" })],
  laptop: [createElement("rect", { key: "a", x: 5, y: 5, width: 14, height: 10, rx: 1.8 }), createElement("path", { key: "b", d: "M3 18.500h18" })],
  clock: [createElement("circle", { key: "a", cx: 12, cy: 12, r: 8.5 }), createElement("path", { key: "b", d: "M12 7.500V12l3 2" })],
  ai: [createElement("path", { key: "a", d: "M12 4l2.400 5.600L20 12l-5.600 2.400L12 20l-2.400-5.600L4 12l5.600-2.400z" })],
  lock: [createElement("rect", { key: "a", x: 5.5, y: 10.5, width: 13, height: 9, rx: 2 }), createElement("path", { key: "b", d: "M8.500 10.500V8a3.500 3.500 0 017 0v2.500" })],
  key: [createElement("circle", { key: "a", cx: 8, cy: 15, r: 4 }), createElement("path", { key: "b", d: "M11 12l8-8M16 7l3 3" })],
  team: [createElement("circle", { key: "a", cx: 9, cy: 9, r: 3.4 }), createElement("path", { key: "b", d: "M3 19.500c.5-3.500 3-5.300 6-5.300s5.500 1.800 6 5.300" }), createElement("circle", { key: "c", cx: 17, cy: 8.5, r: 2.6 }), createElement("path", { key: "d", d: "M17.500 13.500c2.300.3 3.500 1.800 3.800 4" })],
  link: [createElement("path", { key: "a", d: "M10 14a4 4 0 005.700 0l3-3A4 4 0 0013 5.300l-1 1" }), createElement("path", { key: "b", d: "M14 10a4 4 0 00-5.700 0l-3 3A4 4 0 0011 18.700l1-1" })],
  server: [createElement("rect", { key: "a", x: 4, y: 4.5, width: 16, height: 6.5, rx: 2 }), createElement("rect", { key: "b", x: 4, y: 13, width: 16, height: 6.5, rx: 2 }), createElement("path", { key: "c", d: "M8 7.750h.01M8 16.250h.01" })],
  mail: [createElement("rect", { key: "a", x: 3, y: 5.5, width: 18, height: 13, rx: 2.5 }), createElement("path", { key: "b", d: "M4 7l8 6 8-6" })],
  download: [createElement("path", { key: "a", d: "M12 4v11M7 11l5 5 5-5M5 20h14" })],
  alert: [createElement("circle", { key: "a", cx: 12, cy: 12, r: 9 }), createElement("path", { key: "b", d: "M12 8v5M12 16.500v.01" })],
  eye: [createElement("path", { key: "a", d: "M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12z" }), createElement("circle", { key: "b", cx: 12, cy: 12, r: 2.8 })],
  eyeOff: [createElement("path", { key: "a", d: "M4 4l16 16M9.900 5.800A9 9 0 0112 5.500c6 0 9.500 6.500 9.500 6.500a17 17 0 01-3 3.600M6.300 7.300A16 16 0 002.500 12S6 18.500 12 18.500a9 9 0 004-1" })],
  copy: [createElement("rect", { key: "a", x: 8.5, y: 8.5, width: 11, height: 11, rx: 2 }), createElement("path", { key: "b", d: "M15.500 8.500V6a1.500 1.500 0 00-1.500-1.500H6A1.500 1.500 0 004.500 6v8A1.500 1.500 0 006 15.500h2.500" })],
  file: [createElement("path", { key: "a", d: "M6 3.500h8l4 4v12a1 1 0 01-1 1H6a1 1 0 01-1-1v-15a1 1 0 011-1z" })],
};
const NATIVE_GLYPH: Record<GlyphKind, string> = { person: "P", laptop: "L", clock: "T", ai: "*", lock: "#", key: "K", team: "T", link: "L", server: "S", mail: "M", download: "D", alert: "!", eye: "o", eyeOff: "-", copy: "C", file: "F" };

/** A line icon from the one set. */
export function Glyph({ kind, size = 18, color }: { kind: GlyphKind; size?: number; color?: string }): ReactElement {
  const { p } = useJoin();
  const c = color ?? p.ink2;
  if (!web) return <Text style={{ color: c, fontSize: size - 4 }}>{NATIVE_GLYPH[kind]}</Text>;
  return createElement("svg", { viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": true, "data-icon": kind, fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", style: { color: c, flex: "none", display: "block" } }, ...GLYPH[kind]);
}

/** A way forward: a small tile with its icon, two or three words, a quiet hint, and the number key that picks it. Hover tints the row, the keyboard ring surrounds it. */
export function Door({ icon, title, hint, n, onPress, testID, busy, disabled }: { icon: GlyphKind; title: string; hint?: string; n?: string; onPress?: () => void; testID?: string; busy?: boolean; disabled?: boolean }): ReactElement {
  const { p } = useJoin();
  const r = useRing();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={hint ? `${title}. ${hint}` : title} accessibilityState={{ busy: !!busy, disabled: !!disabled }} disabled={disabled || busy} onPress={onPress} testID={testID} {...r.handlers}
      style={({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 60, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: pressed ? p.accentWash : hovered || r.ring ? p.hover : "transparent", opacity: disabled ? 0.5 : 1, ...ringShadow(p, r.ring) })}
    >
      {({ hovered }: { hovered?: boolean }) => (
        <>
          <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: p.field, ...shadow(`inset 0 0 0 1px ${p.fieldLine}`) }}><Glyph kind={icon} size={20} color={hovered ? p.accent : p.ink2} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[base(p), { fontSize: 15, lineHeight: 20, fontWeight: "600", letterSpacing: -0.1 }]}>{busy ? "Starting" : title}</Text>
            {hint ? <Text style={[base(p), { fontSize: 12.5, lineHeight: 16, color: p.ink3 }]}>{hint}</Text> : null}
          </View>
          {busy ? <Spinner size={16} /> : n ? <View style={{ minWidth: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center", ...shadow(`inset 0 0 0 1px ${p.line2}`) }}><Text style={[base(p), { fontSize: 11, lineHeight: 14, color: p.ink4 }]}>{n}</Text></View> : <Chevron color={p.ink4} />}
        </>
      )}
    </Pressable>
  );
}

/** A deliberate choice: the same row as a door. */
export function Choice({ title, help, icon, onPress, testID, busy, disabled }: { title: string; help: string; icon: GlyphKind; onPress?: () => void; testID?: string; busy?: boolean; disabled?: boolean }): ReactElement {
  return <Door icon={icon} title={title} hint={help} {...(onPress ? { onPress } : {})} {...(testID ? { testID } : {})} {...(busy ? { busy } : {})} {...(disabled ? { disabled } : {})} />;
}

/** A turning ring. Still when the person asks for less motion. */
export function Spinner({ size = 16, color }: { size?: number; color?: string }): ReactElement {
  const { p } = useJoin();
  const c = color ?? p.accent;
  return <View accessible={false} {...(web ? { dataSet: { entrySpin: "" } } : {})} style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: c, borderTopColor: "transparent", opacity: 0.8 }} />;
}

/** A step that takes a while: one heading and what is happening now. The sheet's own top line runs; pair with <Panel wait>. A polite live region, so a screen reader hears it. */
export function Working({ title, note, testID, line, lineTestID }: { title: string; note?: string | undefined; testID?: string; line?: string; lineTestID?: string }): ReactElement {
  return (
    <View testID={testID ?? "join-working"} style={{ flexGrow: 1 }}>
      <Title title={title} sub={note} />
      <View style={{ flexGrow: 1, minHeight: 24 }} />
      {line ? <QuietLine testID={lineTestID ?? (testID ? `${testID}-line` : "join-working-line")}>{line}</QuietLine> : <View style={{ minHeight: 28 }} />}
    </View>
  );
}

/** The one field: its label above, a filled box that shows focus, and the box turns to the error colour when `error` is set. The words of the error go on the one error line under the form. */
export function Field({
  label, value, onChange, placeholder, secure, testID, autoComplete, mono, maxLength, onSubmit, error, disabled, valid, visibilityTestID, autoFocus, keyboard, trailing,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string | undefined; secure?: boolean | undefined; testID?: string | undefined; autoComplete?: string | undefined; mono?: boolean | undefined; maxLength?: number | undefined; onSubmit?: (() => void) | undefined;
  error?: boolean | undefined; disabled?: boolean | undefined; valid?: boolean | undefined; visibilityTestID?: string | undefined; autoFocus?: boolean | undefined; keyboard?: "numeric" | undefined; trailing?: ReactNode;
}): ReactElement {
  const { p } = useJoin();
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const edge = error ? p.danger : focused ? p.accent : p.fieldLine;
  return (
    <View style={{ gap: 6 }}>
      <Text style={[base(p), { fontSize: 12.5, lineHeight: 16, fontWeight: "500", color: p.ink2 }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", height: 44, borderRadius: 10, backgroundColor: p.field, paddingLeft: 12, paddingRight: 6, opacity: disabled ? 0.6 : 1, ...shadow(`inset 0 0 0 1px ${edge}${focused && !error ? `, 0 0 0 3px ${p.accentWash}` : ""}`) }}>
        <TextInput
          testID={testID} accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={p.ink4} editable={!disabled} autoFocus={autoFocus}
          secureTextEntry={!!secure && !visible} autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={maxLength} inputMode={keyboard} aria-invalid={!!error}
          {...(autoComplete ? ({ autoComplete } as object) : {})} onSubmitEditing={onSubmit} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          style={[base(p), noOutline, { flex: 1, minWidth: 0, height: 42, color: p.ink, padding: 0 }, mono ? { fontFamily: MONO } : null]}
        />
        {trailing ?? null}
        {valid && !error ? <View accessibilityLabel="Looks good" style={{ paddingHorizontal: 6 }}><Check size={15} color={p.ok} /></View> : null}
        {secure ? (
          <Pressable accessibilityRole="button" accessibilityLabel={visible ? "Hide password" : "Show password"} onPress={() => setVisible((v) => !v)} testID={visibilityTestID} style={({ hovered }: { hovered?: boolean }) => ({ width: 44, height: 44, marginVertical: -2, marginRight: -6, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: hovered ? p.hover : "transparent" })}>
            <Glyph kind={visible ? "eyeOff" : "eye"} size={18} color={p.ink3} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** A line of text to copy, in the field's box, with a copy button that says when it has. */
export function CodeBlock({ text, testID, label = "Copy" }: { text: string; testID?: string; label?: string }): ReactElement {
  const { p } = useJoin();
  const [done, setDone] = useState(false);
  const r = useRing();
  const copy = (): void => {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator;
    void nav?.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1600); }, () => undefined);
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, backgroundColor: p.field, paddingLeft: 12, paddingRight: 4, minHeight: 44, ...shadow(`inset 0 0 0 1px ${p.fieldLine}`) }}>
      <Text selectable testID={testID} style={[base(p), { flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 12.5, lineHeight: 18, paddingVertical: 10 }]}>{text}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${text}`} onPress={copy} testID={testID ? `${testID}-copy` : undefined} {...r.handlers} style={({ hovered }: { hovered?: boolean }) => ({ minWidth: 44, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: hovered ? p.hover : "transparent", ...ringShadow(p, r.ring) })}>
        <Text accessibilityLiveRegion="polite" style={[base(p), { color: p.ink2, fontSize: 13, fontWeight: "600" }]}>{done ? "Copied" : label}</Text>
      </Pressable>
    </View>
  );
}

export function Check({ size = 17, color }: { size?: number; color: string }): ReactElement {
  if (!web) return <Text style={{ color, fontSize: size }}>{"v"}</Text>;
  return createElement("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, "data-icon": "check", fill: "none", stroke: color, strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" }, createElement("path", { d: "M3 8.5l3.2 3.2L13 4.6" }));
}
export function Chevron({ color }: { color: string }): ReactElement {
  if (!web) return <Text style={{ color }}>{">"}</Text>;
  return createElement("svg", { viewBox: "0 0 16 16", width: 14, height: 14, "aria-hidden": true, "data-icon": "chevron", fill: "none", stroke: color, strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", style: { flex: "none" } }, createElement("path", { d: "M6 3.500L10.500 8 6 12.500" }));
}

/** An agent's face in a stack: the shared pixel face, ringed so overlapping faces stay apart. */
export function AgentFace({ name, size = 24 }: { name: string; size?: number }): ReactElement {
  const { p } = useJoin();
  return (
    <View accessibilityLabel={name} style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), ...shadow(`0 0 0 2px ${p.sheet}`) }}>
      <Avatar name={name} kind="agent" size={size} />
    </View>
  );
}

// ---- forms

/** The fields or rows of a form, evenly spaced. */
export function Group({ children, top, testID }: { children: ReactNode; top?: number; testID?: string }): ReactElement {
  const kids: ReactNode[] = [];
  let i = 0;
  for (const c of Children.toArray(children)) { kids.push(isValidElement(c) ? cloneElement(c as ReactElement<{ divider?: boolean }>, { divider: i > 0 }) : c); i++; }
  return <View testID={testID} style={{ gap: 12, marginTop: top ?? 22 }}>{kids}</View>;
}

interface RowProps { divider?: boolean; children?: ReactNode; testID?: string }

function FormRow({ label, children, testID }: RowProps & { label?: string; labelWidth?: number; small?: boolean }): ReactElement {
  const { p } = useJoin();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 }}>
      {label ? <Text style={[base(p), { fontSize: 14, color: p.ink2, width: 76 }]} numberOfLines={1}>{label}</Text> : null}
      {children}
    </View>
  );
}

/** The one field, in a form that spells its parts as rows. */
export function FieldRow({
  label, value, onChange, placeholder, secure, visibilityTestID, testID, autoComplete, mono, keyboard, maxLength, onSubmit, trailing, disabled, error, valid,
}: RowProps & {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; secure?: boolean; revealable?: boolean; visibilityTestID?: string; autoComplete?: string; mono?: boolean; keyboard?: "numeric"; maxLength?: number; onSubmit?: () => void; spaced?: boolean; stacked?: boolean; trailing?: ReactNode; disabled?: boolean; error?: boolean; valid?: boolean;
}): ReactElement {
  return <Field label={label} value={value} onChange={onChange} placeholder={placeholder} secure={secure} visibilityTestID={visibilityTestID} testID={testID} autoComplete={autoComplete} mono={mono} keyboard={keyboard} maxLength={maxLength} onSubmit={onSubmit} trailing={trailing} disabled={disabled} error={error} valid={valid} />;
}

/** A row that is a button: a label, an optional quiet note and a chevron. */
function ActionView({ label, note, onPress, testID }: RowProps & { label: string; note?: string | undefined; onPress?: (() => void) | undefined }): ReactElement {
  const { p } = useJoin();
  const r = useRing();
  return (
    <Pressable
      accessibilityRole="button" onPress={onPress} testID={testID} {...r.handlers}
      style={({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, backgroundColor: pressed ? p.accentWash : hovered ? p.hover : p.field, ...shadow(`inset 0 0 0 1px ${p.fieldLine}`), ...ringShadow(p, r.ring) })}
    >
      <Text style={[base(p), { flex: 1, textAlign: "left", fontWeight: "500" }]}>{label}</Text>
      {note ? <Text style={[base(p), { fontSize: 12.5, color: p.ink3 }]}>{note}</Text> : null}
      <Chevron color={p.ink4} />
    </Pressable>
  );
}

/** A radio row: a round mark, a title and a short hint. The chosen row carries the accent tint, so the choice shows without reading the mark. */
function OptionView({ title, help, checked, onPress, testID }: RowProps & { title: string; help?: string | undefined; checked: boolean; onPress: () => void }): ReactElement {
  const { p } = useJoin();
  const r = useRing();
  return (
    <Pressable
      accessibilityRole="radio" aria-checked={checked} onPress={onPress} testID={testID} {...r.handlers}
      style={({ hovered }: { hovered?: boolean }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: checked ? p.accentWash : hovered ? p.hover : "transparent", ...ringShadow(p, r.ring) })}
    >
      <View style={[{ width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", ...shadow(`inset 0 0 0 1.5px ${p.ink4}`) }, checked ? { backgroundColor: p.accent, ...shadow("none") } : null]}>
        {checked ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: p.accentInk }} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[base(p), { fontSize: 14, lineHeight: 20, fontWeight: "600" }]}>{title}</Text>
        {help ? <Text style={[base(p), { fontSize: 12.5, lineHeight: 16, color: p.ink3 }]}>{help}</Text> : null}
      </View>
    </Pressable>
  );
}

/** One of a few short choices, side by side in the field's box: a radio group that needs no marks. */
export function Segments<T extends string>({ options, value, onChange, label }: { options: readonly { id: T; title: string; testID?: string }[]; value: T; onChange: (id: T) => void; label: string }): ReactElement {
  const { p } = useJoin();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", gap: 2, padding: 2, minHeight: 44, borderRadius: 10, backgroundColor: p.field, ...shadow(`inset 0 0 0 1px ${p.fieldLine}`) }}>
      {options.map((o) => (
        <Pressable key={o.id} accessibilityRole="radio" aria-checked={value === o.id} onPress={() => onChange(o.id)} testID={o.testID} style={{ flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: value === o.id ? p.sheet : "transparent", ...(value === o.id ? shadow(`0 0 0 1px ${p.line2}`) : {}) }}>
          <Text numberOfLines={1} style={[base(p), { fontSize: 13, lineHeight: 18, fontWeight: value === o.id ? "600" : "500", color: value === o.id ? p.ink : p.ink3 }]}>{o.title}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Switch({ on, onChange, label, testID }: { on: boolean; onChange: (v: boolean) => void; label: string; testID?: string }): ReactElement {
  const { p } = useJoin();
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} aria-checked={on} onPress={() => onChange(!on)} testID={testID} style={{ width: 44, minHeight: 44, justifyContent: "center" }}>
      <View style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: on ? p.accent : p.line2 }}>
        <View style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 20, height: 20, borderRadius: 10, backgroundColor: p.sheet }} />
      </View>
    </Pressable>
  );
}

/** A checklist row: a round mark, a title with a line under it, and one quiet action. */
function CheckView({ title, sub, done, aside, action, testID }: RowProps & { title: string; sub: string; done: boolean; aside?: string | undefined; action?: { label: string; onPress?: () => void; testID?: string } | undefined }): ReactElement {
  const { p } = useJoin();
  return (
    <View testID={testID} accessibilityRole={"listitem" as never} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52 }}>
      <View accessibilityLabel={done ? "Done" : "Not done"} style={[{ width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", ...shadow(`inset 0 0 0 1.5px ${p.ink4}`) }, done ? { backgroundColor: p.accent, ...shadow("none") } : null]}>
        {done ? <Check size={12} color={p.accentInk} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[base(p), { fontWeight: "500" }]}>{title}</Text>
        <Text style={[base(p), { fontSize: 13, lineHeight: 18, color: p.ink3 }]}>{sub}</Text>
      </View>
      {aside ? <Text style={[base(p), { fontSize: 13, color: p.ink3 }]}>{aside}</Text> : null}
      {action ? <TextButton testID={action.testID} label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}

/** The one row of the entry screens. A form row has a label and content; the other kinds are a button row, a radio row and a checklist row. */
export type RowProps2 =
  | { kind?: "form"; label?: string; labelWidth?: number; small?: boolean; children?: ReactNode }
  | { kind: "action"; label: string; note?: string; onPress?: () => void }
  | { kind: "option"; title: string; help?: string; checked: boolean; onPress: () => void }
  | { kind: "check"; title: string; sub: string; done: boolean; aside?: string; action?: { label: string; onPress?: () => void; testID?: string } };
export function Row(props: { divider?: boolean; testID?: string } & RowProps2): ReactElement {
  switch (props.kind) {
    case "action": return <ActionView label={props.label} note={props.note} onPress={props.onPress} testID={props.testID} />;
    case "option": return <OptionView title={props.title} help={props.help} checked={props.checked} onPress={props.onPress} testID={props.testID} />;
    case "check": return <CheckView title={props.title} sub={props.sub} done={props.done} aside={props.aside} action={props.action} testID={props.testID} />;
    default: return <FormRow label={props.label} testID={props.testID}>{props.children}</FormRow>;
  }
}

/** A three-segment strength meter, with the word beside the bars so the colour is not the only signal. */
export function Meter({ level }: { level: 0 | 1 | 2 | 3 }): ReactElement {
  const { p } = useJoin();
  const on = [p.danger, p.warn, p.ok][level - 1];
  const word = ["", "Weak", "Fair", "Strong"][level];
  const segments: ReactNode[] = [];
  for (let i = 1; i <= 3; i++) segments.push(<View key={i} style={{ flex: 1, height: 3, borderRadius: 3, backgroundColor: on && i <= level ? on : p.line2 }} />);
  return (
    <View testID="strength" accessibilityLabel={`Password strength ${level} of 3`} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 16 }}>
      <View style={{ flex: 1, flexDirection: "row", gap: 4 }}>{segments}</View>
      <Text style={[base(p), { fontSize: 12, lineHeight: 16, color: p.ink3, minWidth: 40, textAlign: "right" }]}>{word}</Text>
    </View>
  );
}

// ---- the bar

export interface BarProps { onBack?: (() => void) | undefined; hideBack?: boolean | undefined; step?: number | undefined; steps?: number | undefined; cont: ReactNode; centre?: boolean | undefined; testID?: string | undefined }
/** The primary action at the foot of the sheet; Back and the progress line it names are drawn by the Panel. */
export function Bar({ cont, testID }: BarProps): ReactElement {
  return <View testID={testID ?? "join-bar"} style={{ width: "100%", alignItems: "stretch", marginTop: 12 }}>{cont}</View>;
}

// ---- a sheet over the sheet

export function Sheet({ children, label, onDismiss }: { children: ReactNode; label: string; onDismiss?: () => void }): ReactElement {
  const { p } = useJoin();
  return (
    <View testID="join-sheet" accessibilityViewIsModal style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: p.ground, opacity: 0.98, alignItems: "center", justifyContent: "center", padding: 20 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onDismiss} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
      <View accessibilityRole={"dialog" as never} accessibilityLabel={label} style={{ width: "100%", maxWidth: SHEET_WIDTH, backgroundColor: p.sheet, borderRadius: 20, paddingTop: 28, paddingHorizontal: 24, paddingBottom: 20, ...shadow(p.shadow) }}>
        {children}
      </View>
    </View>
  );
}

export function CheckBox({ checked, onChange, label, testID }: { checked: boolean; onChange: (v: boolean) => void; label: string; testID?: string }): ReactElement {
  const { p } = useJoin();
  const r = useRing();
  return (
    <Pressable
      accessibilityRole="checkbox" aria-checked={checked} onPress={() => onChange(!checked)} testID={testID} {...r.handlers}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, marginTop: 4, borderRadius: 10, ...ringShadow(p, r.ring) }}
    >
      <View style={[{ width: 18, height: 18, borderRadius: 6, alignItems: "center", justifyContent: "center", ...shadow(`inset 0 0 0 1.5px ${p.ink4}`) }, checked ? { backgroundColor: p.accent, ...shadow("none") } : null]}>
        {checked ? <Check size={12} color={p.accentInk} /> : null}
      </View>
      <Text style={[base(p), { fontSize: 14 }]}>{label}</Text>
    </Pressable>
  );
}

/** The recovery code in its box, the one way it is ever shown. */
export function CodeShown({ code, testID }: { code: string; testID?: string }): ReactElement {
  const { p } = useJoin();
  return <View style={{ marginTop: 22, borderRadius: 12, backgroundColor: p.field, paddingVertical: 16, paddingHorizontal: 12, alignItems: "center", ...shadow(`inset 0 0 0 1px ${p.fieldLine}`) }}><Text selectable testID={testID} style={[base(p), { textAlign: "center", fontFamily: MONO, fontSize: 18, lineHeight: 28, fontWeight: "500", letterSpacing: 1 }]}>{code}</Text></View>;
}

/** The first frame of every path, before anything is known: the mark on the sheet. The screen that follows fades in on the same sheet. */
export function Opening({ title, line, testID }: { title?: string | undefined; line?: string | undefined; testID?: string | undefined }): ReactElement {
  return <JoinFrame><Panel wait={!!title}><Step id={title ? "opening" : "first"}>{title ? <Working title={title} {...(testID ? { testID } : {})} {...(line ? { line } : {})} /> : <View testID="entry-opening" />}</Step></Panel></JoinFrame>;
}

export const styles = StyleSheet.create({ fill: { flex: 1 } });
export { base as baseText };
