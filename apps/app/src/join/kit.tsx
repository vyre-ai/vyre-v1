// Join building blocks, in the pattern of a system setup assistant (spec 3.13): one centred column, an app icon, system type, grouped inset lists,
// a Back / progress / Continue bar and the system accent. Flat: no gradients, no blurs, no decorative splits. Every block paints from the join palette.
import { Children, cloneElement, createContext, createElement, isValidElement, useContext, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Dimensions } from "react-native";
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

export function Panel({ children, bar, center }: { children: ReactNode; bar?: ReactNode; center?: boolean }) {
  const { p, phone } = useJoin();
  const { height } = useViewport();
  const h = phone ? "100%" : Math.min(624, height - 48);
  return (
    <View
      testID="join-panel"
      style={[
        { width: phone ? "100%" : 620, maxWidth: "100%", height: h as number, backgroundColor: p.panel, overflow: "hidden", flexDirection: "column" },
        phone ? null : { borderRadius: 14 },
        phone ? null : shadow(`0 0 0 1px ${p.hair}, 0 24px 70px rgba(0,0,0,.18), 0 4px 14px rgba(0,0,0,.08)`),
      ]}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, paddingTop: center ? 20 : 28, paddingBottom: phone ? 16 : 24, paddingHorizontal: phone ? 20 : 40, justifyContent: center ? "center" : "flex-start" }}
      >
        {children}
      </ScrollView>
      {bar ?? null}
    </View>
  );
}

/** One step's column: at most 440 wide, centred, and it slides in from the side it came from. */
export function Step({ children, dir = 1, id }: { children: ReactNode; dir?: 1 | -1; id: string }) {
  const style: ViewStyle = { width: "100%", maxWidth: 440, alignSelf: "center" };
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
      <Text accessibilityRole="header" style={[base(p), { marginTop: 24, textAlign: "center", fontSize: 26, lineHeight: 32, fontWeight: "600", letterSpacing: -0.5 }]}>{title}</Text>
      {sub ? <Text style={[base(p), { marginTop: 6, alignSelf: "center", textAlign: "center", color: p.tx2, maxWidth: 360 }]}>{sub}</Text> : null}
    </View>
  );
}
export function Foot({ children, centre, top, testID }: { children: ReactNode; centre?: boolean; top?: number; testID?: string }) {
  const { p } = useJoin();
  return <Text testID={testID} style={[base(p), { fontSize: 13, lineHeight: 18, color: p.tx2, marginTop: top ?? 8, marginHorizontal: 16 }, centre ? { textAlign: "center" } : null]}>{children}</Text>;
}
export function Caption({ children }: { children: ReactNode }) {
  const { p } = useJoin();
  return <Text style={[base(p), { fontSize: 13, lineHeight: 18, color: p.tx2, marginTop: 24, marginBottom: 8, marginHorizontal: 16 }]}>{children}</Text>;
}
export function ErrorLine({ children, testID }: { children: ReactNode; testID?: string }) {
  const { p } = useJoin();
  return <Text testID={testID} accessibilityRole="alert" style={[base(p), { fontSize: 13, lineHeight: 18, color: p.red, marginTop: 8, marginHorizontal: 16 }]}>{children}</Text>;
}
export function TextButton({ label, onPress, testID, small, disabled }: { label: string; onPress?: () => void; testID?: string; small?: boolean; disabled?: boolean }) {
  const { p } = useJoin();
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} testID={testID} style={({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => ({ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.55 : hovered ? 0.75 : 1, borderRadius: 4 })}>
      <Text style={[base(p), { color: p.blue, fontSize: small ? 13 : 15, lineHeight: small ? 18 : 21 }]}>{label}</Text>
    </Pressable>
  );
}
export function Button({ label, onPress, disabled, large, testID }: { label: string; onPress?: () => void; disabled?: boolean; large?: boolean; testID?: string }) {
  const { p } = useJoin();
  return (
    <Pressable
      accessibilityRole="button" aria-disabled={!!disabled} disabled={disabled} onPress={onPress} testID={testID}
      style={({ hovered, pressed }: { hovered?: boolean; pressed?: boolean }) => ({
        minHeight: 44, justifyContent: "center", flexShrink: 0, opacity: disabled ? 0.4 : pressed ? 0.92 : hovered ? 0.94 : 1,
      })}
    >
      <View style={{ height: large ? 36 : 32, paddingHorizontal: large ? 22 : 18, borderRadius: 8, backgroundColor: p.blue, justifyContent: "center" }}>
        <Text numberOfLines={1} style={[base(p), { color: "#FFFFFF", fontSize: large ? 14 : 13, fontWeight: "600" }]}>{label}</Text>
      </View>
    </Pressable>
  );
}

// ---- icons

type IconKind = "space" | "person" | "laptop" | "clock" | "ai" | "lock" | "key";
const GLYPH: Record<Exclude<IconKind, "space">, ReactElement[]> = {
  person: [createElement("circle", { key: "a", cx: 16, cy: 11.5, r: 5.6, fill: "#fff" }), createElement("path", { key: "b", d: "M5.2 27.5c.9-5.8 5.3-8.9 10.8-8.9s9.9 3.1 10.8 8.9z", fill: "#fff" })],
  laptop: [createElement("rect", { key: "a", x: 7, y: 8, width: 18, height: 12.5, rx: 2, fill: "#fff" }), createElement("path", { key: "b", d: "M3.8 23.2h24.4l-1.7 2.3H5.5z", fill: "#fff" })],
  clock: [createElement("circle", { key: "a", cx: 16, cy: 16, r: 9.5 }), createElement("path", { key: "b", d: "M16 10.5V16l3.6 2.2" })],
  ai: [createElement("path", { key: "a", d: "M16 5l2.6 7.4L26 15l-7.4 2.6L16 25l-2.6-7.4L6 15l7.4-2.6z" })],
  lock: [createElement("rect", { key: "a", x: 8.5, y: 14, width: 15, height: 11, rx: 2.5, fill: "#fff", stroke: "none" }), createElement("path", { key: "b", d: "M11.5 14v-3a4.5 4.5 0 019 0v3" })],
  key: [createElement("circle", { key: "a", cx: 11, cy: 20, r: 5 }), createElement("path", { key: "b", d: "M14.6 16.4L25 6M21 10l3 3" })],
};
const FILLED = new Set<IconKind>(["person", "laptop"]);
const NATIVE_GLYPH: Record<IconKind, string> = { space: "", person: "P", laptop: "L", clock: "T", ai: "*", lock: "#", key: "K" };

/** The 72 px app icon tile: the Space's initial on its colour, or a grey system glyph. */
export function AppIcon({ kind, letter }: { kind: IconKind; letter?: string }) {
  const space = kind === "space";
  const tile: ViewStyle = {
    width: 72, height: 72, borderRadius: 16.2, alignSelf: "center", alignItems: "center", justifyContent: "center", backgroundColor: space ? "#6C57E6" : "#8E8E93",
    ...shadow(space ? "0 8px 24px rgba(0,0,0,.14)" : "0 8px 24px rgba(0,0,0,.12)"),
  };
  let inner: ReactNode;
  if (space) inner = <Text style={{ fontFamily: FONT, color: "#fff", fontSize: 36, lineHeight: 36, fontWeight: "600", letterSpacing: -0.4 }}>{(letter ?? "").slice(0, 1)}</Text>;
  else if (web) {
    inner = createElement(
      "svg",
      { viewBox: "0 0 32 32", width: 40, height: 40, "aria-hidden": true, "data-icon": kind, fill: "none", stroke: FILLED.has(kind) ? "none" : "#fff", strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" },
      ...GLYPH[kind as Exclude<IconKind, "space">],
    );
  } else inner = <Text style={{ color: "#fff", fontSize: 28 }}>{NATIVE_GLYPH[kind]}</Text>;
  return <View testID={`icon-${kind}`} accessible={false} style={tile}>{inner}</View>;
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
  return <View testID={testID} style={{ backgroundColor: p.grp, borderRadius: 10, marginTop: top ?? 24 }}>{kids}</View>;
}

function Hairline() {
  const { p } = useJoin();
  return <View pointerEvents="none" style={{ position: "absolute", left: 16, right: 0, top: 0, height: 1, backgroundColor: p.hair }} />;
}

interface RowProps { divider?: boolean; children?: ReactNode; testID?: string }

function FormRow({ label, children, divider, testID, labelWidth = 112, small }: RowProps & { label?: string; labelWidth?: number; small?: boolean }) {
  const { p } = useJoin();
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 12, height: 44, paddingHorizontal: 16 }}>
      {divider ? <Hairline /> : null}
      {label ? <Text style={[base(p), { width: small ? 76 : labelWidth }]} numberOfLines={1}>{label}</Text> : null}
      {children}
    </View>
  );
}

export function FieldRow({
  label, value, onChange, placeholder, secure, revealable, visibilityTestID, testID, autoComplete, mono, keyboard, maxLength, divider, onSubmit, spaced,
}: RowProps & {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; secure?: boolean; revealable?: boolean; visibilityTestID?: string; autoComplete?: string; mono?: boolean; keyboard?: "numeric"; maxLength?: number; onSubmit?: () => void; spaced?: boolean;
}) {
  const { p } = useJoin();
  const [visible, setVisible] = useState(false);
  return (
    <FormRow label={label} divider={divider}>
      <TextInput
        testID={testID} accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={p.tx2}
        secureTextEntry={secure && !visible} autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={maxLength} inputMode={keyboard}
        {...(autoComplete ? ({ autoComplete } as object) : {})} onSubmitEditing={onSubmit}
        style={[base(p), noOutline, { flex: 1, minWidth: 0, height: "100%" as unknown as number, textAlign: "right", color: p.tx, padding: 0 }, mono ? { fontFamily: MONO } : null, spaced ? { letterSpacing: 3 } : null]}
      />
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

/** A row that is a button: label on the left, an optional quiet note and a chevron. */
function ActionView({ label, note, onPress, divider, testID }: RowProps & { label: string; note?: string; onPress?: () => void }) {
  const { p } = useJoin();
  return (
    <Pressable
      accessibilityRole="button" onPress={onPress} testID={testID}
      style={({ hovered }: { hovered?: boolean }) => ({ flexDirection: "row", alignItems: "center", gap: 12, height: 44, paddingHorizontal: 16, backgroundColor: hovered ? `${p.tx}0D` : "transparent", borderRadius: 10 })}
    >
      {divider ? <Hairline /> : null}
      <Text style={[base(p), { flex: 1, textAlign: "left" }]}>{label}</Text>
      {note ? <Text style={[base(p), { fontSize: 13, color: p.tx2 }]}>{note}</Text> : null}
      <Chevron color={p.tx2} />
    </Pressable>
  );
}

/** A radio row: a title, a line of help and a round mark. */
function OptionView({ title, help, checked, onPress, divider, testID }: RowProps & { title: string; help: string; checked: boolean; onPress: () => void }) {
  const { p } = useJoin();
  return (
    <Pressable
      accessibilityRole="radio" aria-checked={checked} onPress={onPress} testID={testID}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10 }}
    >
      {divider ? <Hairline /> : null}
      <View
        style={[{ width: 18, height: 18, marginTop: 2, borderRadius: 9, borderWidth: 1.5, borderColor: p.tx2 }, checked ? { borderColor: p.blue, backgroundColor: p.blue, ...shadow(`inset 0 0 0 3px ${p.blue}, inset 0 0 0 9px #fff`) } : null]}
      >
        {checked && !web ? <View style={{ flex: 1, margin: 3, borderRadius: 9, backgroundColor: "#fff" }} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[base(p), { fontWeight: "500" }]}>{title}</Text>
        <Text style={[base(p), { fontSize: 13, lineHeight: 18, color: p.tx2 }]}>{help}</Text>
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
        {done ? <Check size={12} color="#fff" /> : null}
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

/** A three-segment strength meter. */
export function Meter({ level }: { level: 0 | 1 | 2 | 3 }) {
  const { p } = useJoin();
  const on = [p.red, p.warn, p.green][level - 1];
  const segments: ReactNode[] = [];
  for (let i = 1; i <= 3; i++) segments.push(<View key={i} style={{ flex: 1, height: 3, borderRadius: 3, backgroundColor: on && i <= level ? on : p.hair }} />);
  return (
    <View testID="strength" accessibilityLabel={`Password strength ${level} of 3`} style={{ flexDirection: "row", gap: 4, marginTop: 14, marginHorizontal: 16 }}>
      {segments}
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

export function Bar({ onBack, hideBack, step, steps, cont, centre, testID }: { onBack?: () => void; hideBack?: boolean; step?: number; steps?: number; cont: ReactNode; /** the action sits in the middle of the bar, the dots at the left (the finish page) */ centre?: boolean; testID?: string }) {
  const { p, phone } = useJoin();
  const dots = steps ? (
    <View accessibilityRole="progressbar" accessibilityLabel={`Step ${Math.min(steps, (step ?? 0) + 1)} of ${steps}`} aria-valuemin={1} aria-valuemax={steps} aria-valuenow={Math.min(steps, (step ?? 0) + 1)} testID="dots" style={{ flexDirection: "row", gap: 7 }}>
      {Array.from({ length: steps }, (_, i) => <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i === step ? p.tx : i < (step ?? 0) ? p.tx2 : p.hair }} />)}
    </View>
  ) : <View />;
  return (
    <View
      testID={testID ?? "join-bar"}
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 64, paddingHorizontal: 20, paddingVertical: phone ? 10 : 0, borderTopWidth: 1, borderTopColor: p.hair }}
    >
      {centre ? (
        <>
          <View style={{ flex: 1, alignItems: "flex-start" }}>{dots}</View>
          <View style={{ flexShrink: 0, alignItems: "center" }}>{cont}</View>
          <View style={{ flex: 1 }} />
        </>
      ) : (
        <>
          {hideBack ? null : (
            <View style={{ flex: 1, alignItems: "flex-start" }}>
              <Pressable accessibilityRole="button" onPress={onBack} testID="back" style={({ hovered }: { hovered?: boolean }) => ({ paddingVertical: 6, paddingHorizontal: 4, borderRadius: 6, opacity: hovered ? 0.75 : 1 })}>
                <Text style={[base(p), { color: p.blue, fontSize: 13, fontWeight: "500" }]}>Back</Text>
              </Pressable>
            </View>
          )}
          {dots}
          <View style={{ flex: hideBack ? 0 : 1, flexShrink: 0, alignItems: "flex-end" }}>{cont}</View>
        </>
      )}
    </View>
  );
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
  return (
    <Pressable accessibilityRole="checkbox" aria-checked={checked} onPress={() => onChange(!checked)} testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, marginTop: 18 }}>
      <View style={[{ width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: p.tx2 }, checked ? { backgroundColor: p.blue, borderColor: p.blue } : null]}>
        {checked ? <Check size={11} color="#fff" /> : null}
      </View>
      <Text style={[base(p), { fontSize: 13 }]}>{label}</Text>
    </Pressable>
  );
}

export const styles = StyleSheet.create({ fill: { flex: 1 } });
export { base as baseText };
