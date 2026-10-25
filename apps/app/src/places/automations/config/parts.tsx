// The grouped list of the config pane and the Journey designer (the prototype's .sg and .sr): a label above, rows in a hairline-ruled box with the label and an optional sub line at the
// left and one control at the right. A pick button opens a menu from where it is; a switch is a real switch. Colours are skin tokens, so a skin switch repaints with no re-render.
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Glyph } from "./glyphs.tsx";
import type { GlyphName } from "./glyphs.tsx";
import { pointer, webOnly } from "../canvas/parts.tsx";

/** A small section label ("Scope", "Who") above a group. */
export function Lab({ children, first = false, right }: { children: ReactNode; first?: boolean; right?: ReactNode }): ReactElement {
  return (
    <View style={[p.lab, first && { marginTop: 6 }]}>
      <Text accessibilityRole="header" style={p.labText}>{children}</Text>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

/** The rule-bordered box that holds rows. */
export function Group({ children, testID }: { children: ReactNode; testID?: string }): ReactElement {
  return <View testID={testID} style={p.group}>{children}</View>;
}

/** One row: label, an optional sub line when it adds information, a control at the right. The last row of a group draws no rule. */
export function SRow({ label, sub, lead, children, last = false, minHeight = 44, testID }: { label?: ReactNode; sub?: ReactNode; lead?: ReactNode; children?: ReactNode; last?: boolean; minHeight?: number; testID?: string }): ReactElement {
  return (
    <View testID={testID} style={[p.row, { minHeight }, !last && p.rule]}>
      {lead ? <View style={p.lead}>{lead}</View> : null}
      <View style={p.text}>
        {label !== undefined ? <Text style={p.label}>{label}</Text> : null}
        {sub !== undefined ? <Text style={p.sub}>{sub}</Text> : null}
      </View>
      {children}
    </View>
  );
}

/** A value that opens a menu: an optional leading mark, the value, a chevron. */
export function PickButton({ label, value, lead, onPress, empty = false, disabled = false, testID }: { label: string; value: string; lead?: ReactNode; onPress?: (x: number, y: number) => void; empty?: boolean; disabled?: boolean; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${label}, ${value}`} accessibilityState={{ disabled }} testID={testID} disabled={disabled}
      onPress={(e) => { const n = (e as { nativeEvent?: { clientX?: number; clientY?: number; pageX?: number; pageY?: number } }).nativeEvent ?? {}; onPress?.(n.clientX ?? n.pageX ?? 0, n.clientY ?? n.pageY ?? 0); }}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      {...webOnly({ "aria-haspopup": "menu" })}
      style={[p.pick, over && !disabled && { backgroundColor: "var(--hover)" }, disabled && { opacity: 0.5 }, pointer]}
    >
      {lead}
      <Text numberOfLines={1} style={[p.pickText, empty && { color: "var(--ink-3)" as string }]}>{value}</Text>
      {disabled ? null : <Glyph name="chevD" size={11} color="var(--ink-3)" />}
    </Pressable>
  );
}

/** An on or off switch. */
export function Switch({ on, onChange, label, disabled = false, testID }: { on: boolean; onChange(next: boolean): void; label: string; disabled?: boolean; testID?: string }): ReactElement {
  return (
    <Pressable
      accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: on, disabled }} aria-checked={on} testID={testID} disabled={disabled}
      onPress={() => onChange(!on)}
      style={[p.track, { backgroundColor: (on ? "var(--accent)" : "var(--line-2)") as string }, disabled && { opacity: 0.5 }, pointer]}
    >
      <View style={[p.knob, on && { left: 18 }]} />
    </Pressable>
  );
}

/** A quiet line of explanation below a group. */
export function Hint({ children, testID }: { children: ReactNode; testID?: string }): ReactElement {
  return <Text testID={testID} style={p.hint}>{children}</Text>;
}

/** A line with a leading icon (the Scope description and the like). */
export function IconLine({ icon, children }: { icon: GlyphName; children: ReactNode }): ReactElement {
  return <View style={p.iconLine}><Glyph name={icon} size={14} color="var(--ink-3)" /><Text style={p.iconLineText}>{children}</Text></View>;
}

export const p = StyleSheet.create({
  lab: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 20, marginBottom: 6 },
  labText: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  group: { borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 6 },
  rule: { borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  lead: { flexDirection: "row", alignItems: "center" },
  text: { flex: 1, minWidth: 0 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: "500", color: "var(--ink)" as string },
  sub: { fontSize: 12, lineHeight: 16, color: "var(--ink-3)" as string },
  pick: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 7, maxWidth: 220 },
  pickText: { fontSize: 13, color: "var(--ink)" as string, flexShrink: 1 },
  track: { width: 36, height: 20, borderRadius: 10, justifyContent: "center" },
  knob: { position: "absolute", left: 2, top: 2, width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff" as string },
  hint: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string, marginTop: 8 },
  iconLine: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  iconLineText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
});
