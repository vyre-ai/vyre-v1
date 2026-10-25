// Small pieces of the conversation: stroke icons, the header's icon buttons (each one opens its menu under itself, never at the pointer), the faces with their mode marks, and the
// quiet pieces a message is made of. Colours are skin tokens, so a skin switch repaints with no re-render.
import { createElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Face } from "../needsyou/parts.tsx";

const PATHS = {
  pane: ["M2.500 3.500h11v9h-11z", "M10 3.500v9"],
  helper: ["M8 2.500l1.200 3 3 .4-2.300 2 .7 3.100L8 9.500 5.400 11l.7-3.100-2.300-2 3-.4z"],
  stop: ["M4.500 4.500h7v7h-7z"],
  more: ["M3.500 8h.01", "M8 8h.01", "M12.500 8h.01"],
  down: ["M8 3v9.500", "M4 8.500l4 4 4-4"],
  copy: ["M5.500 5.500h7v7h-7z", "M3.500 10.500v-7h7"],
  edit: ["M3 13h2.500L13 5.500 10.500 3 3 10.500z", "M9.500 4l2.500 2.500"],
  retry: ["M3 8a5 5 0 105-5H5.500", "M5.500 1.500L3.500 3.500 5.500 5.500"],
  reply: ["M6.500 3.500L2.500 7.500l4 4", "M2.500 7.500h7a4 4 0 014 4v1"],
  pin: ["M9.500 2.500l4 4-2 .8-2.300 2.300.3 3.100L8 11.500 4.700 14.800 4 14.100l3.300-3.300-2.700-2.700 3.100.3 2.300-2.300z"],
  trash: ["M3.500 4.500h9", "M6 4.500V3h4v1.500", "M4.500 4.500l.6 8h5.800l.6-8"],
  lock: ["M4.500 7.500h7v5.500h-7z", "M6 7.500V5.800a2 2 0 014 0v1.700"],
  chev: ["M6 4l4 4-4 4"],
  check: ["M3 8.500l3 3 7-7"],
  spark: ["M8 2.500l1.300 3.600 3.700 1.400-3.700 1.400L8 12.500 6.700 8.900 3 7.500l3.700-1.400z"],
  alert: ["M8 2.500l6 10.500H2z", "M8 6.500v3", "M8 11.200h.01"],
  plus: ["M8 3.500v9", "M3.500 8h9"],
  file: ["M4 2.500h5l3 3v7a1 1 0 01-1 1H4a1 1 0 01-1-1v-9a1 1 0 011-1z", "M9 2.500v3h3"],
  term: ["M2.500 3.500h11v9h-11z", "M5 7l2 1.500L5 10", "M8.500 10.500h2.500"],
  plan: ["M3.500 2.500h9v11h-9z", "M5.500 6h5M5.500 8.500h5M5.500 11h3"],
  x: ["M4 4l8 8M12 4l-8 8"],
  search: ["M7 11.500a4.500 4.500 0 100-9 4.500 4.500 0 000 9z", "M10.300 10.300L13.500 13.500"],
  people: ["M6 7.500a2.300 2.300 0 100-4.600 2.300 2.300 0 000 4.600z", "M1.800 13c0-2.300 1.900-4 4.200-4s4.200 1.700 4.200 4", "M10.500 3.300a2.100 2.100 0 010 4", "M11.500 9.200c1.600.4 2.700 1.700 2.700 3.800"],
  monitor: ["M2.500 3h11v7.500h-11z", "M6 13h4", "M8 10.500V13"],
  chevd: ["M4 6l4 4 4-4"],
  up: ["M8 12.500V3", "M4 7l4-4 4 4"],
} as const;
export type GlyphName = keyof typeof PATHS;

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

export function Glyph({ name, size = 15, color = "var(--ink-3)", width = 1.4 }: { name: GlyphName; size?: number; color?: string; width?: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const paths: ReactElement[] = [];
  for (const d of PATHS[name]) paths.push(createElement("path", { key: d, d, fill: name === "stop" ? "currentColor" : "none" }));
  return createElement("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, color, strokeWidth: name === "more" ? 2.4 : width, strokeLinecap: "round", strokeLinejoin: "round" } }, ...paths);
}

type Box = { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };

/** Where a menu opened from a button goes: under the button, for pointer, keyboard and programmatic opens alike (rule 26). */
export function anchorOf(e: unknown): { x: number; y: number } {
  const ev = e as Box;
  const box = ev.currentTarget?.getBoundingClientRect?.();
  return box ? { x: box.left, y: box.bottom + 4 } : { x: ev.nativeEvent?.pageX ?? 0, y: ev.nativeEvent?.pageY ?? 0 };
}

/** A quiet icon button in a header or a hover bar. `onPress` gets the point under the button. */
export function IconButton({ icon, label, onPress, active = false, danger = false, size = 28, testID, badge }: { icon: GlyphName; label: string; onPress: (x: number, y: number) => void; active?: boolean; danger?: boolean; size?: number; testID?: string; badge?: number }): ReactElement {
  const [over, setOver] = useState(false);
  const color = danger ? "var(--danger)" : over || active ? "var(--ink)" : "var(--ink-3)";
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} testID={testID}
      {...webProps({ title: label })}
      onPress={(e) => { const p = anchorOf(e); onPress(p.x, p.y); }}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[s.ib, { width: size, height: size }, (over || active) && s.ibOver]}
    >
      <Glyph name={icon} size={15} color={color} />
      {badge !== undefined && badge > 0 ? <Text style={s.badge}>{badge}</Text> : null}
    </Pressable>
  );
}

/** A face with its mode mark: a filled dot for the agent that leads, a ring for one that listens. A press opens that agent's mode menu. */
export function FaceButton({ name, mode, working, onPress, title, testID, size = 24, label }: { name: string; mode: "lead" | "listen"; working: boolean; onPress: (x: number, y: number) => void; title: string; testID: string; size?: number; label?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={`${name}, ${mode === "lead" ? "leads" : "listening"}`} testID={testID} {...webProps({ title })}
      onPress={(e) => { const p = anchorOf(e); onPress(p.x, p.y); }}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[s.faceBtn, label !== undefined && s.faceChip, over && s.ibOver]}
    >
      <View style={s.faceBox}>
        <Face name={name} size={size} />
        <View testID={`mark-${mode}`} style={[s.mark, mode === "lead" ? s.markLead : s.markListen, working && s.markWorking]} />
      </View>
      {label !== undefined ? <Text numberOfLines={1} style={s.chipText}>{label}</Text> : null}
    </Pressable>
  );
}

/** A text button; `primary` is the one filled action (the accent), `dark` the ink-filled one the cards use, `icon` a glyph before the label. */
export function TextButton({ label, onPress, primary = false, dark = false, icon, disabled = false, danger = false, testID }: { label: string; onPress: () => void; primary?: boolean; dark?: boolean; icon?: GlyphName; disabled?: boolean; danger?: boolean; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  const filled = primary || dark;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} testID={testID} onPress={onPress}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[s.btn, dark ? s.btnDark : primary ? s.btnPrimary : over && s.btnOver, dark && over && { opacity: 0.88 }, disabled && { opacity: 0.5 }]}
    >
      {icon ? <Glyph name={icon} size={13} color={dark ? "var(--win)" : primary ? "var(--accent-ink)" : "var(--ink-2)"} /> : null}
      <Text style={[s.btnText, filled && (dark ? s.btnTextDark : s.btnTextPrimary), danger && { color: "var(--danger)" as string }]}>{label}</Text>
    </Pressable>
  );
}

/** The quiet fold line: a chevron that turns, a label, and what is under it when open. */
export function Fold({ label, open, onToggle, live, testID, children }: { label: string; open: boolean; onToggle: () => void; live?: boolean; testID: string; children?: ReactNode }): ReactElement {
  return (
    <View testID={testID} style={s.fold}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={label} onPress={onToggle} style={s.foldHead}>
        {live ? <View style={s.spin} /> : <View style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}><Glyph name="chev" size={12} color="var(--ink-4)" /></View>}
        <Text style={s.foldText}>{label}</Text>
      </Pressable>
      {open ? <View style={s.foldBody}>{children}</View> : null}
    </View>
  );
}

export const s = StyleSheet.create({
  ib: { borderRadius: 7, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  ibOver: { backgroundColor: "var(--press)" as string },
  badge: { marginLeft: 3, fontSize: 11, fontWeight: "600", color: "var(--ink-2)" as string },
  faceBtn: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  faceChip: { width: undefined, flexShrink: 1, flexDirection: "row", gap: 6, paddingLeft: 2, paddingRight: 8 } as object,
  faceBox: { position: "relative" },
  chipText: { flexShrink: 1, fontSize: 13, color: "var(--ink-2)" as string },
  mark: { position: "absolute", right: 1, bottom: 1, width: 9, height: 9, borderRadius: 5, borderWidth: 2, borderColor: "var(--win)" as string },
  markLead: { backgroundColor: "var(--accent)" as string },
  markListen: { backgroundColor: "var(--win)" as string, borderColor: "var(--ink-4)" as string },
  markWorking: { backgroundColor: "var(--ok)" as string, borderColor: "var(--win)" as string },
  btn: { height: 28, paddingHorizontal: 11, borderRadius: 8, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6 },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnPrimary: { backgroundColor: "var(--accent)" as string },
  btnDark: { backgroundColor: "var(--ink)" as string },
  btnText: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  btnTextPrimary: { color: "var(--accent-ink)" as string },
  btnTextDark: { color: "var(--win)" as string },
  fold: { gap: 4 },
  foldHead: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  foldText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-3)" as string },
  foldBody: { gap: 4, paddingLeft: 18, paddingBottom: 4 },
  spin: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: "var(--ok)" as string, borderTopColor: "transparent" },
});
