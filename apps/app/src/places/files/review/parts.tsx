// Pieces of the review surfaces: the header buttons, a text box, a two-way switch, the segmented control, the status line. Sizes and colours are the prototype's diff tab (vyre-v1.html, .dfhead, .dfnote,
// .lintbar): 30 px quiet buttons, the primary one filled with the accent, 34 px text boxes on the sunk surface. Every colour is a skin token, so a skin switch repaints with no re-render.
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { ViewStyle } from "react-native";

export const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});
const style = (s: Record<string, unknown>): ViewStyle => s as unknown as ViewStyle;

/** The anchor for a menu opened from a press: under the pressed control on web, never the pointer (rule 26), else where the press landed. */
export function anchorOf(e: unknown): { x: number; y: number } {
  const ev = e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
  const box = ev.currentTarget?.getBoundingClientRect?.();
  if (box) return { x: box.left, y: box.bottom + 4 };
  return { x: ev.nativeEvent?.pageX ?? 0, y: ev.nativeEvent?.pageY ?? 0 };
}

export interface BtnProps {
  label: string;
  onPress: (e: unknown) => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** A reason shown as the tooltip, and read out, while the button is off. */
  hint?: string;
  testID?: string;
  /** A control that opens a menu. */
  menu?: boolean;
  /** A toggle: pressed state for a screen reader. */
  pressed?: boolean;
  small?: boolean;
}

/** The quiet button. Primary is the accent; a disabled one dims to 35 percent, says aria-disabled and does nothing. */
export function Btn({ label, onPress, primary = false, danger = false, disabled = false, hint, testID, menu = false, pressed, small = false }: BtnProps): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, ...(pressed === undefined ? {} : { pressed }) }}
      accessibilityHint={disabled ? hint : undefined}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      testID={testID}
      style={[s.btn, small && s.btnSmall, primary ? s.btnPri : over && s.btnOver, primary && over && s.btnPriOver, disabled && s.dim]}
      {...webProps({ title: disabled && hint ? hint : label, ...(menu ? { "aria-haspopup": "menu" } : {}) })}
    >
      <Text style={[s.btnText, primary && s.btnTextPri, danger && s.btnDanger]}>{label}</Text>
    </Pressable>
  );
}

/** A small round-cornered icon button with a label for the screen reader and a tooltip. */
export function IconBtn({ label, onPress, children, testID, disabled = false, menu = false }: { label: string; onPress: (e: unknown) => void; children: ReactNode; testID?: string; disabled?: boolean; menu?: boolean }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      testID={testID}
      style={[s.ib, over && s.btnOver, disabled && s.dim]}
      {...webProps({ title: label, ...(menu ? { "aria-haspopup": "menu" } : {}) })}
    >
      {children}
    </Pressable>
  );
}

export function TextField({ value, onChange, label, placeholder, onSubmit, onEscape, testID, width, multiline = false, autoFocus = false, rows = 3, mono = false, compact = false, selection }: {
  value: string; onChange: (v: string) => void; label: string; placeholder?: string; onSubmit?: () => void; onEscape?: () => void; testID?: string; width?: number; multiline?: boolean; autoFocus?: boolean; rows?: number;
  /** Monospace text, for files. */
  mono?: boolean;
  /** 26 px high, for a line inside a ui/Row. */
  compact?: boolean;
  selection?: { start: number; end: number };
}): ReactElement {
  const [focus, setFocus] = useState(false);
  const onKeyPress = (e: { nativeEvent?: { key?: string } }): void => { if (e.nativeEvent?.key === "Escape") onEscape?.(); };
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      accessibilityLabel={label}
      placeholder={placeholder}
      placeholderTextColor="var(--ink-4)"
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      onSubmitEditing={onSubmit}
      onKeyPress={onKeyPress}
      autoFocus={autoFocus}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      multiline={multiline}
      numberOfLines={multiline ? rows : 1}
      {...(selection ? { selection } : {})}
      testID={testID}
      style={[s.input, compact && s.inputCompact, multiline && s.inputMulti, multiline && { minHeight: rows * 19 + 16 }, mono && s.mono, width === undefined ? s.inputFlex : { width }, focus && s.inputFocus]}
    />
  );
}

export function Switch({ on, onChange, label, testID }: { on: boolean; onChange: (v: boolean) => void; label: string; testID?: string }): ReactElement {
  return (
    <Pressable role="switch" aria-checked={on} accessibilityLabel={label} accessibilityState={{ checked: on }} onPress={() => onChange(!on)} testID={testID} style={[s.sw, on && s.swOn]} {...webProps({ title: label })}>
      <View style={[s.knob, on && s.knobOn]} />
    </Pressable>
  );
}

/** Two or three choices in one pill; the chosen one sits raised. A radio group, so arrows move and aria-checked is real. */
export function Segmented<T extends string>({ options, value, onChange, label, testID }: { options: readonly { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; testID?: string }): ReactElement {
  const buttons: ReactElement[] = [];
  for (const o of options) {
    buttons.push(
      <Pressable key={o.id} role="radio" aria-checked={o.id === value} accessibilityState={{ selected: o.id === value }} accessibilityLabel={o.label} onPress={() => onChange(o.id)} testID={`${testID ?? "seg"}-${o.id}`} style={[s.segBtn, o.id === value && s.segOn]}>
        <Text style={[s.segText, o.id === value && s.segTextOn]}>{o.label}</Text>
      </Pressable>,
    );
  }
  return <View role="radiogroup" aria-label={label} style={s.seg} testID={testID}>{buttons}</View>;
}

/** One line of status under the header: a dot, the words, and an optional action. An error reads as an alert. */
export function Note({ text, kind = "ok", testID = "review-note", children }: { text: string; kind?: "ok" | "error" | "warn"; testID?: string; children?: ReactNode }): ReactElement {
  const dot = kind === "error" ? "var(--danger)" : kind === "warn" ? "var(--warn)" : "var(--ok)";
  return (
    <View style={s.note} testID={testID} role={kind === "error" ? "alert" : "status"}>
      <View style={[s.noteDot, { backgroundColor: dot }]} />
      <Text style={s.noteText}>{text}</Text>
      {children}
    </View>
  );
}

export function Dot({ color }: { color: string }): ReactElement {
  return <View style={[s.dot, { backgroundColor: color }]} aria-hidden />;
}

/** The reserved size of something still loading, so nothing shifts when it arrives. */
export function Skeleton({ height, testID }: { height: number; testID?: string }): ReactElement {
  return <View testID={testID} aria-busy accessibilityLabel="Loading" style={[s.skeleton, { height }]} />;
}

const s = StyleSheet.create({
  btn: { height: 30, paddingHorizontal: 11, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  btnSmall: { height: 26, paddingHorizontal: 9, borderRadius: 7 },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnPri: { backgroundColor: "var(--accent)" as string, paddingHorizontal: 14 },
  btnPriOver: style({ filter: "brightness(1.08)" }),
  btnText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  btnTextPri: { color: "var(--accent-ink)" as string, fontWeight: "600" },
  btnDanger: { color: "var(--danger)" as string },
  dim: { opacity: 0.35 },
  ib: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  input: style({
    height: 32, borderRadius: 8, backgroundColor: "var(--sunk)", boxShadow: "inset 0 0 0 1px var(--line)", paddingHorizontal: 10, color: "var(--ink)", fontSize: 13, outlineStyle: "none",
  }),
  inputCompact: { height: 26, borderRadius: 7, fontSize: 12.5 },
  mono: style({ fontFamily: "var(--mono)", fontSize: 12.5 }),
  inputFlex: { flex: 1, minWidth: 0 },
  inputMulti: style({ height: "auto", minHeight: 64, paddingVertical: 8, lineHeight: 19 }),
  inputFocus: style({ boxShadow: "inset 0 0 0 1px var(--accent-line), 0 0 0 3px var(--accent-wash)" }),
  sw: { width: 34, height: 20, borderRadius: 99, padding: 2, backgroundColor: "var(--ink-4)" as string, justifyContent: "center" },
  swOn: { backgroundColor: "var(--accent)" as string },
  knob: { width: 16, height: 16, borderRadius: 99, backgroundColor: "#fff" },
  knobOn: { alignSelf: "flex-end" },
  seg: { flexDirection: "row", height: 24, padding: 2, borderRadius: 7, backgroundColor: "var(--hover)" as string, flex: 0 },
  segBtn: { paddingHorizontal: 9, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  segOn: style({ backgroundColor: "var(--raised)", boxShadow: "var(--sh-1)" }),
  segText: { fontSize: 11.5, fontWeight: "500", color: "var(--ink-3)" as string },
  segTextOn: { color: "var(--ink)" as string },
  note: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 4 },
  noteDot: { width: 6, height: 6, borderRadius: 99 },
  noteText: { flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  dot: { width: 7, height: 7, borderRadius: 99, flex: 0 },
  skeleton: { width: "100%", borderRadius: 6, backgroundColor: "var(--sunk)" as string },
});
