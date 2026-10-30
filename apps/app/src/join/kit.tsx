// Auth building blocks follow the reference FlowStep: content-height reading surface, small brand, top Back,
// progress before the fields and the primary below them. Flat: no gradients, blurs or decorative splits.
import { Children, cloneElement, createContext, createElement, isValidElement, useContext, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Dimensions } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import { Avatar } from "../../../../ui/src/Avatar/index.tsx";
import { HalftoneField } from "./HalftoneField.tsx";
import type { HalftoneIntensity } from "./HalftoneField.tsx";
import { FONT, MONO, paletteOf, useJoinMode } from "./palette.ts";
import type { JoinMode, JoinPalette } from "./palette.ts";

interface Theme { p: JoinPalette; mode: JoinMode; phone: boolean }
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
const ringShadow = (p: JoinPalette, on: boolean, inner = p.panel): ViewStyle => (on ? shadow(`0 0 0 2px ${inner}, 0 0 0 4px ${p.blue}`) : {});

const reduceMotion = (): boolean => {
  const mm = (globalThis as { matchMedia?: (q: string) => { matches: boolean } }).matchMedia;
  return !web || !mm || mm("(prefers-reduced-motion: reduce)").matches;
};

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

/** Phone layout from 640 wide down, as in the prototype. */
export const PHONE_MAX = 640;

// ---- the frame: wash, panel, body, bar

export function JoinFrame({ children, mode, halftoneIntensity = "calm" }: { children: ReactNode; mode?: JoinMode; halftoneIntensity?: HalftoneIntensity }) {
  const detected = useJoinMode();
  const m = mode ?? detected;
  const { width } = useViewport();
  const phone = width <= PHONE_MAX;
  const theme = useMemo(() => ({ p: paletteOf(m), mode: m, phone }), [m, phone]);
  return (
    <ThemeCtx.Provider value={theme}>
      <View
        testID="join-frame"
        style={{ flex: 1, minHeight: "100%" as unknown as number, position: "relative", overflow: "hidden", backgroundColor: phone ? theme.p.panel : theme.p.back, alignItems: "center", justifyContent: "center", padding: phone ? 0 : 24 }}
      >
        <HalftoneField intensity={halftoneIntensity} palette={theme.p} />
        <View style={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center", zIndex: 1 }}>{children}</View>
      </View>
    </ThemeCtx.Provider>
  );
}

export function Panel({ children, bar, center }: { children: ReactNode; bar?: ReactElement<BarProps>; center?: boolean }) {
  const { p, phone, mode } = useJoin();
  void center;
  const back = bar?.props;
  const backRing = useRing();
  return (
    <ScrollView style={{ width: "100%", flex: 1 }} contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingVertical: phone ? 24 : 40, paddingHorizontal: phone ? 16 : 24 }} keyboardShouldPersistTaps="handled">
      <View
        testID="join-panel"
        style={{ width: "100%", maxWidth: 600, backgroundColor: p.panel, borderWidth: 1, borderColor: p.hair, borderRadius: phone ? 16 : 20, padding: phone ? 20 : 32, gap: 28, ...shadow(mode === "light" ? "0 1px 2px rgba(24,24,26,.05), 0 12px 40px rgba(24,24,26,.08)" : "0 12px 48px rgba(0,0,0,.45)") }}
      >
        <View testID="auth-form-header" style={{ minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}><Image testID="auth-form-mark" source={{ uri: "/vyre-mark.png" }} accessible={false} style={{ width: 32, height: 32, borderRadius: 8 }} /><Text style={[base(p), { fontSize: 15, fontWeight: "600", letterSpacing: -0.1 }]}>Vyre</Text></View>
          {back?.onBack && !back.hideBack ? (
            <Pressable
              accessibilityRole="button" accessibilityLabel="Back" onPress={back.onBack} testID="back" {...backRing.handlers}
              style={({ hovered }: { hovered?: boolean }) => ({ minHeight: 44, minWidth: 44, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 10, backgroundColor: hovered ? p.hover : "transparent", ...ringShadow(p, backRing.ring) })}
            >
              <View style={{ transform: [{ rotate: "180deg" }] }}><Chevron color={p.tx2} /></View>
              <Text style={[base(p), { color: p.tx2, fontSize: 14 }]}>Back</Text>
            </Pressable>
          ) : null}
        </View>
        {back?.steps ? <FormProgress step={back.step} steps={back.steps} /> : null}
        {children}
        {bar && back?.cont != null ? bar : null}
      </View>
    </ScrollView>
  );
}

/** The first screens' stage: no card, the content sits on the window itself (the wash and the dot field behind it), centred, as wide as its doors need. */
export function Stage({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { phone } = useJoin();
  return (
    <ScrollView style={{ width: "100%", flex: 1 }} contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingVertical: phone ? 24 : 40, paddingHorizontal: phone ? 16 : 24 }} keyboardShouldPersistTaps="handled">
      <View testID="join-stage" style={{ width: "100%", maxWidth: wide ? 860 : 600, alignItems: "center" }}>{children}</View>
    </ScrollView>
  );
}

const lift = (on: boolean): ViewStyle => (web ? ({ transform: [{ translateY: on ? -6 : 0 }], transitionProperty: "transform, box-shadow, border-color", transitionDuration: "240ms", transitionTimingFunction: "cubic-bezier(.2,.8,.2,1)" } as ViewStyle) : {});

/** A big visual choice: a picture, two or three words, a number key. The hint shows on hover or keyboard focus only. On a phone it is a row. */
export function Door({ art, title, hint, n, onPress, testID, busy, disabled }: { art: ReactNode; title: string; hint?: string; n?: string; onPress?: () => void; testID?: string; busy?: boolean; disabled?: boolean }) {
  const { p, phone, mode } = useJoin();
  const r = useRing();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={hint ? `${title}. ${hint}` : title} accessibilityState={{ busy: !!busy, disabled: !!disabled }} disabled={disabled || busy} onPress={onPress} testID={testID} {...r.handlers}
      style={({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => {
        const on = hovered === true || r.ring;
        const base: ViewStyle = phone
          ? { flexDirection: "row", alignItems: "center", gap: 16, height: 76, width: "100%", paddingHorizontal: 16, borderRadius: 20 }
          : { width: 224, height: 236, alignItems: "center", justifyContent: "space-between", paddingTop: 22, paddingBottom: 20, paddingHorizontal: 18, borderRadius: 24, overflow: "hidden" };
        return { ...base, ...lift(on && !phone), backgroundColor: pressed ? p.accentWash : p.panel, borderWidth: on ? 1.5 : 1, borderColor: on ? p.accentLine : p.hair, opacity: disabled ? 0.5 : 1,
          ...shadow(on ? (mode === "light" ? "0 6px 16px -6px rgba(24,24,26,.14), 0 24px 48px -24px rgba(24,24,26,.18)" : "0 6px 16px -6px rgba(0,0,0,.5), 0 24px 48px -24px rgba(0,0,0,.6)") : (mode === "light" ? "0 1px 1px rgba(24,24,26,.04), 0 2px 6px -2px rgba(24,24,26,.06)" : "0 1px 1px rgba(0,0,0,.3)")) };
      }}
    >
      {({ hovered }: { hovered?: boolean }) => (
        <>
          {n && !phone ? <View style={{ position: "absolute", top: 14, right: 14, minWidth: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center", ...shadow(`inset 0 0 0 1px ${p.hair}`) }}><Text style={[base(p), { fontSize: 11, color: p.tx3 }]}>{n}</Text></View> : null}
          <View style={{ marginTop: phone ? 0 : 8, ...(phone ? { width: 56, height: 56, alignItems: "center", justifyContent: "center" } : { height: 112, alignItems: "center", justifyContent: "center" }) }}>{art}</View>
          <View style={{ alignItems: phone ? "flex-start" : "center", flex: phone ? 1 : undefined }}>
            <Text style={[base(p), { fontSize: phone ? 18 : 20, lineHeight: 26, fontWeight: "650" as never, letterSpacing: -0.3 }]}>{busy ? "Starting…" : title}</Text>
            {!phone ? <Text style={[base(p), { fontSize: 12.5, lineHeight: 18, height: 18, color: p.tx3, opacity: hovered === true || r.ring ? 1 : 0 }]}>{hint ?? ""}</Text> : null}
          </View>
          {busy ? <Spinner size={20} /> : null}
        </>
      )}
    </Pressable>
  );
}

/** The reference reading column fills its content-height form surface. */
export function Step({ children, dir = 1, id }: { children: ReactNode; dir?: 1 | -1; id: string }) {
  const style: ViewStyle = { width: "100%", alignSelf: "center" };
  if (!reduceMotion()) {
    const from = dir > 0 ? 12 : -12;
    Object.assign(style, {
      animationKeyframes: [{ from: { opacity: 0, transform: [{ translateX: from }] }, to: { opacity: 1, transform: [{ translateX: 0 }] } }],
      animationDuration: "240ms", animationTimingFunction: "cubic-bezier(.2,.8,.2,1)", animationFillMode: "both",
    });
  }
  return <View testID={`step-${id}`} style={style}>{children}</View>;
}

// ---- text

const base = (p: JoinPalette): TextStyle => ({ fontFamily: FONT, fontSize: 15, lineHeight: 21, color: p.tx });

export function Title({ title, sub }: { title: string; sub?: string }) {
  const { p } = useJoin();
  return (
    <View>
      <Text accessibilityRole="header" style={[base(p), { marginTop: 0, textAlign: "left", fontSize: 30, lineHeight: 36, fontWeight: "650" as never, letterSpacing: -0.7 }]}>{title}</Text>
      {sub ? <Text style={[base(p), { marginTop: 10, alignSelf: "stretch", textAlign: "left", color: p.tx2, fontSize: 16, lineHeight: 24 }]}>{sub}</Text> : null}
    </View>
  );
}
export function Foot({ children, centre, top, testID }: { children: ReactNode; centre?: boolean; top?: number; testID?: string }) {
  const { p } = useJoin();
  return <Text testID={testID} style={[base(p), { fontSize: 13, lineHeight: 18, color: p.tx2, marginTop: top ?? 10 }, centre ? { textAlign: "center" } : null]}>{children}</Text>;
}
export function Caption({ children }: { children: ReactNode }) {
  const { p } = useJoin();
  return <Text style={[base(p), { fontSize: 13, lineHeight: 18, color: p.tx2, fontWeight: "600", marginTop: 24, marginBottom: 8 }]}>{children}</Text>;
}
export function ErrorLine({ children, testID }: { children: ReactNode; testID?: string }) {
  const { p } = useJoin();
  return <Text testID={testID} accessibilityRole="alert" style={[base(p), { fontSize: 13, lineHeight: 18, color: p.red, marginTop: 10 }]}>{children}</Text>;
}
export function TextButton({ label, onPress, testID, small, disabled }: { label: string; onPress?: () => void; testID?: string; small?: boolean; disabled?: boolean }) {
  const { p } = useJoin();
  const r = useRing();
  return (
    <Pressable
      accessibilityRole="button" disabled={disabled} onPress={onPress} testID={testID} {...r.handlers}
      style={({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => ({ minWidth: 44, minHeight: 44, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.45 : pressed ? 0.6 : 1, borderRadius: 10, backgroundColor: hovered && !disabled ? p.accentWash : "transparent", ...ringShadow(p, r.ring) })}
    >
      <Text style={[base(p), { color: p.blue, fontSize: small ? 13 : 15, lineHeight: small ? 18 : 21, fontWeight: "500" }]}>{label}</Text>
    </Pressable>
  );
}

/** The primary action: the accent fill, full width, 48 px. Disabled it is a quiet neutral, so it reads as not yet available rather than as a faded accent. */
export function Button({ label, onPress, disabled, large, testID, quiet }: { label: string; onPress?: () => void; disabled?: boolean; large?: boolean; testID?: string; quiet?: boolean }) {
  const { p } = useJoin();
  const r = useRing();
  return (
    <Pressable
      accessibilityRole="button" aria-disabled={!!disabled} disabled={disabled} onPress={onPress} testID={testID} {...r.handlers}
      style={({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => ({ minHeight: 44, alignItems: "stretch", justifyContent: "center", flexShrink: 0, opacity: pressed ? 0.88 : 1, borderRadius: 12, ...ringShadow(p, r.ring), ...(hovered && !disabled ? {} : {}) })}
    >
      {({ hovered }: { hovered?: boolean }) => (
        <View style={{ minHeight: large ? 52 : 48, alignItems: "center", paddingHorizontal: 22, borderRadius: 12, backgroundColor: disabled ? p.sw : quiet ? (hovered ? p.hover : p.grp) : hovered ? `${p.blue}E6` : p.blue, borderWidth: quiet ? 1 : 0, borderColor: p.hair, justifyContent: "center" }}>
          <Text numberOfLines={1} style={[base(p), { color: disabled ? p.tx3 : quiet ? p.tx : p.accentInk, fontSize: 15, fontWeight: "600", letterSpacing: -0.1 }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

// ---- icons

type IconKind = "space" | "person" | "laptop" | "clock" | "ai" | "lock" | "key" | "team" | "link" | "server";
const GLYPH: Record<Exclude<IconKind, "space">, ReactElement[]> = {
  person: [createElement("circle", { key: "a", cx: 16, cy: 11.5, r: 5.6, fill: "currentColor" }), createElement("path", { key: "b", d: "M5.2 27.5c.9-5.8 5.3-8.9 10.8-8.9s9.9 3.1 10.8 8.9z", fill: "currentColor" })],
  laptop: [createElement("rect", { key: "a", x: 7, y: 8, width: 18, height: 12.5, rx: 2, fill: "currentColor" }), createElement("path", { key: "b", d: "M3.8 23.2h24.4l-1.7 2.3H5.5z", fill: "currentColor" })],
  clock: [createElement("circle", { key: "a", cx: 16, cy: 16, r: 9.5 }), createElement("path", { key: "b", d: "M16 10.5V16l3.6 2.2" })],
  ai: [createElement("path", { key: "a", d: "M16 5l2.6 7.4L26 15l-7.4 2.6L16 25l-2.6-7.4L6 15l7.4-2.6z" })],
  lock: [createElement("rect", { key: "a", x: 8.5, y: 14, width: 15, height: 11, rx: 2.5, fill: "currentColor", stroke: "none" }), createElement("path", { key: "b", d: "M11.5 14v-3a4.5 4.5 0 019 0v3" })],
  key: [createElement("circle", { key: "a", cx: 11, cy: 20, r: 5 }), createElement("path", { key: "b", d: "M14.6 16.4L25 6M21 10l3 3" })],
  team: [createElement("circle", { key: "a", cx: 12, cy: 12, r: 4.2 }), createElement("path", { key: "b", d: "M4.5 25c.6-4.6 3.8-7 7.5-7s6.9 2.4 7.5 7" }), createElement("circle", { key: "c", cx: 22, cy: 11, r: 3.2 }), createElement("path", { key: "d", d: "M22.5 17.6c3 .3 4.6 2.4 5 5.4" })],
  link: [createElement("path", { key: "a", d: "M13.5 18.5a4.6 4.6 0 006.5 0l3.5-3.5a4.6 4.6 0 00-6.5-6.5l-1 1" }), createElement("path", { key: "b", d: "M18.5 13.5a4.6 4.6 0 00-6.5 0L8.5 17a4.6 4.6 0 006.5 6.5l1-1" })],
  server: [createElement("rect", { key: "a", x: 5.5, y: 6.5, width: 21, height: 8, rx: 2.2 }), createElement("rect", { key: "b", x: 5.5, y: 17.5, width: 21, height: 8, rx: 2.2 }), createElement("path", { key: "c", d: "M10 10.5h.01M10 21.5h.01" })],
};
const FILLED = new Set<IconKind>(["person", "laptop"]);
const NATIVE_GLYPH: Record<IconKind, string> = { space: "", person: "P", laptop: "L", clock: "T", ai: "*", lock: "#", key: "K", team: "T", link: "L", server: "S" };

/** The app icon tile: the Space's initial on the accent, or a glyph in the accent on its tint. Left-aligned over the title, with room under it. */
export function AppIcon({ kind, letter }: { kind: IconKind; letter?: string }) {
  const { p } = useJoin();
  const space = kind === "space";
  const tile: ViewStyle = {
    width: 56, height: 56, borderRadius: 14, alignSelf: "flex-start", alignItems: "center", justifyContent: "center", marginBottom: 20,
    backgroundColor: space ? p.blue : p.accentWash, ...(space ? {} : { borderWidth: 1, borderColor: p.accentLine }),
  };
  let inner: ReactNode;
  if (space) inner = <Text style={{ fontFamily: FONT, color: p.accentInk, fontSize: 28, lineHeight: 28, fontWeight: "600", letterSpacing: -0.4 }}>{(letter ?? "").slice(0, 1).toUpperCase()}</Text>;
  else if (web) {
    inner = createElement(
      "svg",
      { viewBox: "0 0 32 32", width: 32, height: 32, "aria-hidden": true, "data-icon": kind, fill: "none", stroke: FILLED.has(kind) ? "none" : "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", style: { color: p.blue } },
      ...GLYPH[kind as Exclude<IconKind, "space">],
    );
  } else inner = <Text style={{ color: p.blue, fontSize: 24 }}>{NATIVE_GLYPH[kind]}</Text>;
  return <View testID={`icon-${kind}`} accessible={false} style={tile}>{inner}</View>;
}

/** A glyph in the accent, small, for rows and cards. */
export function Glyph({ kind, size = 22, color }: { kind: Exclude<IconKind, "space">; size?: number; color?: string }) {
  const { p } = useJoin();
  const c = color ?? p.blue;
  if (!web) return <Text style={{ color: c, fontSize: size - 4 }}>{NATIVE_GLYPH[kind]}</Text>;
  return createElement("svg", { viewBox: "0 0 32 32", width: size, height: size, "aria-hidden": true, "data-icon": kind, fill: "none", stroke: FILLED.has(kind) ? "none" : "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", style: { color: c, flex: "none" } }, ...GLYPH[kind]);
}

/** A deliberate choice: an icon tile, a title and one line of what happens, with a chevron. Hover lifts it with the accent line, a press tints it, the keyboard ring surrounds it. While `busy` it shows a spinner and cannot be pressed again. */
export function Choice({ title, help, icon, onPress, testID, busy, disabled }: { title: string; help: string; icon: Exclude<IconKind, "space">; onPress?: () => void; testID?: string; busy?: boolean; disabled?: boolean }) {
  const { p } = useJoin();
  const r = useRing();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${title}. ${help}`} accessibilityState={{ busy: !!busy, disabled: !!disabled }} disabled={disabled || busy} onPress={onPress} testID={testID} {...r.handlers}
      style={({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => ({
        flexDirection: "row", alignItems: "center", gap: 16, minHeight: 80, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 16, borderWidth: 1,
        borderColor: hovered || r.ring ? p.accentLine : p.hair, backgroundColor: pressed ? p.accentWash : hovered ? p.hover : p.panel, opacity: disabled ? 0.5 : 1, ...ringShadow(p, r.ring),
      })}
    >
      <View style={{ width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: p.accentWash }}><Glyph kind={icon} size={26} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[base(p), { fontSize: 17, lineHeight: 23, fontWeight: "600", letterSpacing: -0.2 }]}>{busy ? "Starting…" : title}</Text>
        <Text style={[base(p), { fontSize: 14, lineHeight: 20, color: p.tx2, marginTop: 2 }]}>{help}</Text>
      </View>
      {busy ? <Spinner size={20} /> : <Chevron color={p.tx3} />}
    </Pressable>
  );
}

/** A turning ring: the accent over the hairline. Still when the person asks for reduced motion. */
export function Spinner({ size = 28 }: { size?: number }) {
  const { p } = useJoin();
  const style: ViewStyle = { width: size, height: size, borderRadius: size / 2, borderWidth: Math.max(2, Math.round(size / 9)), borderColor: p.hair, borderTopColor: p.blue };
  if (!reduceMotion()) Object.assign(style, { animationKeyframes: [{ from: { transform: [{ rotate: "0deg" }] }, to: { transform: [{ rotate: "360deg" }] } }], animationDuration: "900ms", animationIterationCount: "infinite", animationTimingFunction: "linear" });
  return <View accessible={false} style={style} />;
}

/** The waiting state of a step that takes a while: a spinner, what is happening, and why it can take a moment. A polite live region, so a screen reader hears it. */
export function Working({ title, note, testID, line, lineTestID }: { title: string; note?: string; testID?: string; line?: string; lineTestID?: string }) {
  const { p } = useJoin();
  return (
    <View testID={testID ?? "join-working"} style={{ alignItems: "flex-start", gap: 20, paddingVertical: 8 }}>
      <View style={{ width: 56, height: 56, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: p.accentWash, borderWidth: 1, borderColor: p.accentLine }}><Spinner size={26} /></View>
      <Title title={title} {...(note ? { sub: note } : {})} />
      {line ? <Text accessibilityLiveRegion="polite" testID={lineTestID ?? (testID ? `${testID}-line` : "join-working-line")} style={[base(p), { color: p.tx2, fontSize: 14 }]}>{line}</Text> : null}
    </View>
  );
}

/** A field with its label above it, a box that shows focus, an inline error under it and an optional hint. The error replaces the hint and tints the box; `valid` adds a quiet check. */
export function Field({
  label, value, onChange, placeholder, secure, testID, autoComplete, mono, maxLength, onSubmit, error, hint, disabled, valid, visibilityTestID, autoFocus, keyboard, noteTestID,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; secure?: boolean; testID?: string; autoComplete?: string; mono?: boolean; maxLength?: number; onSubmit?: () => void;
  error?: string; hint?: string; disabled?: boolean; valid?: boolean; visibilityTestID?: string; autoFocus?: boolean; keyboard?: "numeric"; noteTestID?: string;
}) {
  const { p } = useJoin();
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const note = error || hint;
  const border = error ? p.red : focused ? p.blue : p.hair;
  return (
    <View style={{ gap: 6 }}>
      <Text style={[base(p), { fontSize: 13, lineHeight: 18, fontWeight: "600" }]}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: border, backgroundColor: disabled ? p.grp : p.panel, paddingLeft: 14, paddingRight: 6, ...(focused ? shadow(`0 0 0 3px ${error ? "rgba(198,47,47,.18)" : p.accentWash}`) : {}) }}>
        <TextInput
          testID={testID} accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={p.tx3} editable={!disabled} autoFocus={autoFocus}
          secureTextEntry={secure && !visible} autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={maxLength} inputMode={keyboard} aria-invalid={!!error}
          {...(autoComplete ? ({ autoComplete } as object) : {})} onSubmitEditing={onSubmit} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          style={[base(p), noOutline, { flex: 1, minWidth: 0, height: 46, color: p.tx, padding: 0 }, mono ? { fontFamily: MONO } : null]}
        />
        {valid && !error ? <View accessibilityLabel="Looks good" style={{ paddingHorizontal: 10 }}><Check size={16} color={p.green} /></View> : null}
        {secure ? (
          <Pressable accessibilityRole="button" accessibilityLabel={visible ? "Hide password" : "Show password"} onPress={() => setVisible((v) => !v)} testID={visibilityTestID} style={({ hovered }: { hovered?: boolean }) => ({ minWidth: 52, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: hovered ? p.hover : "transparent" })}>
            <Text style={[base(p), { color: p.blue, fontSize: 13, fontWeight: "600" }]}>{visible ? "Hide" : "Show"}</Text>
          </Pressable>
        ) : null}
      </View>
      {note ? <Text accessibilityRole={error ? "alert" : undefined} testID={noteTestID ?? (testID ? `${testID}-note` : undefined)} style={[base(p), { fontSize: 13, lineHeight: 18, color: error ? p.red : p.tx2 }]}>{note}</Text> : null}
    </View>
  );
}

/** A line of text to copy, in a box, with a Copy button that says Copied for a moment. */
export function CodeBlock({ text, testID, label = "Copy" }: { text: string; testID?: string; label?: string }) {
  const { p } = useJoin();
  const [done, setDone] = useState(false);
  const r = useRing();
  const copy = (): void => {
    const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator;
    void nav?.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1600); }, () => undefined);
  };
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, borderColor: p.hair, backgroundColor: p.grp, paddingLeft: 14, paddingRight: 6, minHeight: 52 }}>
      <Text selectable testID={testID} style={[base(p), { flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 13, lineHeight: 20, paddingVertical: 12 }]}>{text}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${text}`} onPress={copy} testID={testID ? `${testID}-copy` : undefined} {...r.handlers} style={({ hovered }: { hovered?: boolean }) => ({ minWidth: 64, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: hovered ? p.accentWash : "transparent", ...ringShadow(p, r.ring, p.grp) })}>
        <Text accessibilityLiveRegion="polite" style={[base(p), { color: p.blue, fontSize: 13, fontWeight: "600" }]}>{done ? "Copied" : label}</Text>
      </Pressable>
    </View>
  );
}

export function Check({ size = 17, color }: { size?: number; color: string }) {
  if (!web) return <Text style={{ color, fontSize: size }}>{"v"}</Text>;
  return createElement("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, "data-icon": "check", fill: "none", stroke: color, strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" }, createElement("path", { d: "M3 8.5l3.2 3.2L13 4.6" }));
}
export function Chevron({ color }: { color: string }) {
  if (!web) return <Text style={{ color }}>{">"}</Text>;
  return createElement("svg", { viewBox: "0 0 16 16", width: 14, height: 14, "aria-hidden": true, "data-icon": "chevron", fill: "none", stroke: color, strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", style: { flex: "none" } }, createElement("path", { d: "M6 3.5L10.5 8 6 12.5" }));
}

/** An agent's face in a stack: the shared pixel face, ringed in the group colour so overlapping faces stay apart. */
export function AgentFace({ name, size = 24 }: { name: string; size?: number }) {
  const { p } = useJoin();
  return (
    <View accessibilityLabel={name} style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), ...shadow(`0 0 0 2px ${p.grp}`) }}>
      <Avatar name={name} kind="agent" size={size} />
    </View>
  );
}

// ---- grouped inset list

export function Group({ children, top, testID }: { children: ReactNode; top?: number; testID?: string }) {
  const { p } = useJoin();
  const kids: ReactNode[] = [];
  let i = 0;
  for (const c of Children.toArray(children)) {
    kids.push(isValidElement(c) ? cloneElement(c as ReactElement<{ divider?: boolean }>, { divider: i > 0 }) : c);
    i++;
  }
  return <View testID={testID} style={{ backgroundColor: p.grp, borderRadius: 14, borderWidth: 1, borderColor: p.hair, overflow: "hidden", marginTop: top ?? 24 }}>{kids}</View>;
}

function Hairline() {
  const { p } = useJoin();
  return <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 1, backgroundColor: p.hair }} />;
}

interface RowProps { divider?: boolean; children?: ReactNode; testID?: string }

function FormRow({ label, children, divider, testID, labelWidth = 112, small, stacked }: RowProps & { label?: string; labelWidth?: number; small?: boolean; stacked?: boolean }) {
  const { p } = useJoin();
  return (
    <View testID={testID} style={stacked ? { gap: 8, paddingHorizontal: 16, paddingVertical: 12 } : { flexDirection: "row", alignItems: "center", gap: 12, height: 44, paddingHorizontal: 16 }}>
      {divider ? <Hairline /> : null}
      {label ? <Text style={[base(p), { width: stacked ? undefined : small ? 76 : labelWidth }]} numberOfLines={1}>{label}</Text> : null}
      {stacked ? <View style={{ flexDirection: "row", alignItems: "center", minHeight: 44, gap: 8 }}>{children}</View> : children}
    </View>
  );
}

export function FieldRow({
  label, value, onChange, placeholder, secure, revealable, visibilityTestID, testID, autoComplete, mono, keyboard, maxLength, divider, onSubmit, spaced, stacked, trailing, disabled,
}: RowProps & {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; secure?: boolean; revealable?: boolean; visibilityTestID?: string; autoComplete?: string; mono?: boolean; keyboard?: "numeric"; maxLength?: number; onSubmit?: () => void; spaced?: boolean; stacked?: boolean; trailing?: ReactNode; disabled?:boolean;
}) {
  const { p } = useJoin();
  const [visible, setVisible] = useState(false);
  return (
    <FormRow label={label} divider={divider} stacked={stacked}>
      <TextInput
        testID={testID} accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={p.tx2}
        editable={!disabled}
        secureTextEntry={secure && !visible} autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={maxLength} inputMode={keyboard}
        {...(autoComplete ? ({ autoComplete } as object) : {})} onSubmitEditing={onSubmit}
        style={[base(p), noOutline, { flex: 1, minWidth: 0, height: stacked ? 44 : "100%" as unknown as number, textAlign: stacked ? "left" : "right", color: p.tx, padding: 0 }, mono ? { fontFamily: MONO } : null, spaced ? { letterSpacing: 3 } : null]}
      />
      {trailing ?? null}
      {secure && revealable ? (
        <Pressable
          accessibilityRole="button" accessibilityLabel={visible ? "Hide password" : "Show password"} onPress={() => setVisible((current) => !current)} testID={visibilityTestID}
          style={({ pressed }: { pressed?: boolean }) => ({ minWidth: 44, height: 44, marginRight: -12, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.55 : 1 })}
        >
          <Text style={[base(p), { color: p.blue, fontSize: 13, fontWeight: "500" }]}>{visible ? "Hide" : "Show"}</Text>
        </Pressable>
      ) : null}
    </FormRow>
  );
}

/** A row that is a button: label on the left, an optional quiet note and a chevron. Hover tints it, the keyboard ring sits inside it. */
function ActionView({ label, note, onPress, divider, testID }: RowProps & { label: string; note?: string; onPress?: () => void }) {
  const { p } = useJoin();
  const r = useRing();
  return (
    <Pressable
      accessibilityRole="button" onPress={onPress} testID={testID} {...r.handlers}
      style={({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 16, backgroundColor: pressed ? p.accentWash : hovered ? p.hover : "transparent", ...(r.ring ? shadow(`inset 0 0 0 2px ${p.blue}`) : {}) })}
    >
      {divider ? <Hairline /> : null}
      <Text style={[base(p), { flex: 1, textAlign: "left", fontWeight: "500" }]}>{label}</Text>
      {note ? <Text style={[base(p), { fontSize: 13, color: p.tx2 }]}>{note}</Text> : null}
      <Chevron color={p.tx2} />
    </Pressable>
  );
}

/** A radio row: a round mark, a title and a line of help. The chosen row carries the accent tint, so the choice shows without reading the mark. */
function OptionView({ title, help, checked, onPress, divider, testID }: RowProps & { title: string; help: string; checked: boolean; onPress: () => void }) {
  const { p } = useJoin();
  const r = useRing();
  return (
    <Pressable
      accessibilityRole="radio" aria-checked={checked} onPress={onPress} testID={testID} {...r.handlers}
      style={({ hovered }: { hovered?: boolean }) => ({ flexDirection: "row", alignItems: "flex-start", gap: 14, minHeight: 56, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: checked ? p.accentWash : hovered ? p.hover : "transparent", ...(r.ring ? shadow(`inset 0 0 0 2px ${p.blue}`) : {}) })}
    >
      {divider ? <Hairline /> : null}
      <View style={[{ width: 20, height: 20, marginTop: 1, borderRadius: 10, borderWidth: 1.5, borderColor: p.tx3, alignItems: "center", justifyContent: "center" }, checked ? { borderColor: p.blue, backgroundColor: p.blue } : null]}>
        {checked ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.accentInk }} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[base(p), { fontWeight: "600" }]}>{title}</Text>
        <Text style={[base(p), { fontSize: 13, lineHeight: 19, color: p.tx2, marginTop: 2 }]}>{help}</Text>
      </View>
    </Pressable>
  );
}

export function Switch({ on, onChange, label, testID }: { on: boolean; onChange: (v: boolean) => void; label: string; testID?: string }) {
  const { p } = useJoin();
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} aria-checked={on} onPress={() => onChange(!on)} testID={testID} style={{ width: 51, minHeight: 44, justifyContent: "center" }}>
      <View style={{ width: 51, height: 31, borderRadius: 16, backgroundColor: on ? p.green : p.sw }}>
        <View style={{ position: "absolute", top: 2, left: on ? 22 : 2, width: 27, height: 27, borderRadius: 14, backgroundColor: "#fff", ...shadow("0 3px 8px rgba(0,0,0,.15), 0 1px 1px rgba(0,0,0,.16), 0 3px 1px rgba(0,0,0,.1)") }} />
      </View>
    </Pressable>
  );
}


/** A checklist row: a round mark, a title with a line under it, and one quiet action. */
function CheckView({ title, sub, done, aside, action, divider, testID }: RowProps & { title: string; sub: string; done: boolean; aside?: string; action?: { label: string; onPress?: () => void; testID?: string } }) {
  const { p } = useJoin();
  return (
    <View testID={testID} accessibilityRole={"listitem" as never} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10 }}>
      {divider ? <Hairline /> : null}
      <View accessibilityLabel={done ? "Done" : "Not done"} style={[{ width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: p.tx2 }, done ? { backgroundColor: p.blue, borderColor: p.blue } : null]}>
        {done ? <Check size={12} color={p.accentInk} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[base(p), { fontWeight: "500" }]}>{title}</Text>
        <Text style={[base(p), { fontSize: 13, lineHeight: 18, color: p.tx2 }]}>{sub}</Text>
      </View>
      {aside ? <Text style={[base(p), { fontSize: 13, color: p.tx2 }]}>{aside}</Text> : null}
      {action ? <TextButton testID={action.testID} label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}

/** The one row of the join pattern. A form row has a label and content; the other kinds are a button row, a radio row and a checklist row. */
export type RowProps2 =
  | { kind?: "form"; label?: string; labelWidth?: number; small?: boolean; children?: ReactNode }
  | { kind: "action"; label: string; note?: string; onPress?: () => void }
  | { kind: "option"; title: string; help: string; checked: boolean; onPress: () => void }
  | { kind: "check"; title: string; sub: string; done: boolean; aside?: string; action?: { label: string; onPress?: () => void; testID?: string } };
export function Row(props: { divider?: boolean; testID?: string } & RowProps2) {
  switch (props.kind) {
    case "action": return <ActionView label={props.label} note={props.note} onPress={props.onPress} divider={props.divider} testID={props.testID} />;
    case "option": return <OptionView title={props.title} help={props.help} checked={props.checked} onPress={props.onPress} divider={props.divider} testID={props.testID} />;
    case "check": return <CheckView title={props.title} sub={props.sub} done={props.done} aside={props.aside} action={props.action} divider={props.divider} testID={props.testID} />;
    default: return <FormRow label={props.label} labelWidth={props.labelWidth} small={props.small} divider={props.divider} testID={props.testID}>{props.children}</FormRow>;
  }
}

/** A three-segment strength meter, with the word for it beside the bars so the colour is not the only signal. */
export function Meter({ level }: { level: 0 | 1 | 2 | 3 }) {
  const { p } = useJoin();
  const on = [p.red, p.warn, p.green][level - 1];
  const word = ["", "Weak", "Fair", "Strong"][level];
  const segments: ReactNode[] = [];
  for (let i = 1; i <= 3; i++) segments.push(<View key={i} style={{ flex: 1, height: 4, borderRadius: 4, backgroundColor: on && i <= level ? on : p.hair }} />);
  return (
    <View testID="strength" accessibilityLabel={`Password strength ${level} of 3`} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ flex: 1, flexDirection: "row", gap: 4 }}>{segments}</View>
      <Text style={[base(p), { fontSize: 12, lineHeight: 16, color: p.tx2, minWidth: 40, textAlign: "right" }]}>{word}</Text>
    </View>
  );
}

export function Progress({ pct }: { pct: number }) {
  const { p } = useJoin();
  return (
    <View accessibilityRole="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} testID="progress" style={{ height: 4, borderRadius: 4, backgroundColor: p.hair, marginTop: 28, marginHorizontal: 24, overflow: "hidden" }}>
      <View style={{ height: 4, width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: p.blue, borderRadius: 4 }} />
    </View>
  );
}

// ---- the bar

export interface BarProps { onBack?: () => void; hideBack?: boolean; step?: number; steps?: number; cont: ReactNode; centre?: boolean; testID?: string }
function FormProgress({ step = 0, steps }: { step?: number; steps: number }) {
  const { p } = useJoin();
  const current = Math.min(steps, step + 1);
  return <View style={{ gap: 8 }}><Text style={[base(p), { fontSize: 12, fontWeight: "600", color: p.tx2, letterSpacing: 0.2 }]}>Step {current} of {steps}</Text><View accessibilityRole="progressbar" accessibilityLabel={`Step ${current} of ${steps}`} aria-valuemin={1} aria-valuemax={steps} aria-valuenow={current} testID="dots" style={{ flexDirection: "row", gap: 6 }}>{Array.from({ length: steps }, (_, i) => <View key={i} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i <= step ? p.blue : p.hair }} />)}</View></View>;
}
export function Bar({ cont, testID }: BarProps) {
  return <View testID={testID ?? "join-bar"} style={{ width: "100%", alignItems: "stretch" }}>{cont}</View>;
}

// ---- the sheet

export function Sheet({ children, label, onDismiss }: { children: ReactNode; label: string; onDismiss?: () => void }) {
  const { p } = useJoin();
  return (
    <View testID="join-sheet" accessibilityViewIsModal style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,.28)", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onDismiss} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
      <View accessibilityRole={"dialog" as never} accessibilityLabel={label} style={{ width: "100%", maxWidth: 360, backgroundColor: p.sheet, borderRadius: 14, paddingTop: 24, paddingHorizontal: 20, paddingBottom: 20, ...shadow(`0 20px 60px rgba(0,0,0,.3), 0 0 0 1px ${p.hair}`) }}>
        {children}
      </View>
    </View>
  );
}

export function CheckBox({ checked, onChange, label, testID }: { checked: boolean; onChange: (v: boolean) => void; label: string; testID?: string }) {
  const { p } = useJoin();
  const r = useRing();
  return (
    <Pressable
      accessibilityRole="checkbox" aria-checked={checked} onPress={() => onChange(!checked)} testID={testID} {...r.handlers}
      style={({ hovered }: { hovered?: boolean }) => ({ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingHorizontal: 12, marginHorizontal: -12, borderRadius: 12, backgroundColor: hovered ? p.hover : "transparent", ...ringShadow(p, r.ring) })}
    >
      <View style={[{ width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: p.tx3 }, checked ? { backgroundColor: p.blue, borderColor: p.blue } : null]}>
        {checked ? <Check size={12} color={p.accentInk} /> : null}
      </View>
      <Text style={[base(p), { fontSize: 14 }]}>{label}</Text>
    </Pressable>
  );
}

export const styles = StyleSheet.create({ fill: { flex: 1 } });
export { base as baseText };
