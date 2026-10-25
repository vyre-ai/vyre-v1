// Small pieces of the computer popup: stroke icons, the side-rail button, the faux desktop the screen draws until the stream's own pictures arrive, and the buttons on the sheet.
// The screen is the agent's remote display, so it is dark in every skin; the rail and the sheet use the skin's tokens.
import { createElement, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

const PATHS = {
  hand: ["M5.500 8V3.800a1 1 0 012 0V7M7.500 7V2.800a1 1 0 012 0V7M9.500 7V3.800a1 1 0 012 0v4.400c0 2.600-1.400 4.300-3.600 4.300-1.500 0-2.400-.6-3.300-1.800L3.100 8.400a1 1 0 011.500-1.300z"],
  giveback: ["M3 9.500l3.500-3.500 2 2L13 3.500", "M13 3.500v3.500M13 3.500H9.500", "M3 13h10"],
  recdot: ["M8 12a4 4 0 100-8 4 4 0 000 8z"],
  recstop: ["M4.500 4.500h7v7h-7z"],
  bubble: ["M3 4.500A2 2 0 015 2.500h6a2 2 0 012 2v4.500a2 2 0 01-2 2H7l-3 2.500V11a2 2 0 01-1-1.700z"],
  x: ["M4 4l8 8M12 4l-8 8"],
  moon: ["M12.500 9.200A5.200 5.200 0 016.800 3.500a5.200 5.200 0 105.700 5.700z"],
  lock: ["M4.500 7.500h7v5.500h-7z", "M6 7.500V5.800a2 2 0 014 0v1.700"],
  shield: ["M8 2.500l4.500 1.600v3.600c0 2.800-1.900 4.700-4.500 5.800-2.600-1.100-4.500-3-4.500-5.800V4.100z", "M6 8l1.500 1.500L10.300 6.600"],
  play: ["M6 4.500l5 3.500-5 3.500z"],
  check: ["M3 8.500l3 3 7-7"],
} as const;
export type IconName = keyof typeof PATHS;

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

export function Icon({ name, size = 18, color = "#fff", width = 1.4, fill }: { name: IconName; size?: number; color?: string; width?: number; fill?: string }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const paths: ReactElement[] = [];
  for (const d of PATHS[name]) paths.push(createElement("path", { key: d, d, fill: fill ?? "none" }));
  return createElement("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: width, strokeLinecap: "round", strokeLinejoin: "round" } }, ...paths);
}

/** A round icon on the side rail. `on` fills it with the accent; a recording shows its time under the icon; the tip appears beside it on hover or focus. */
export function RailButton({ label, tip, icon, on, disabled, timer, danger, onPress, testID }: { label: string; tip: string; icon: IconName; on: boolean; disabled: boolean; timer?: string; danger?: boolean; onPress: () => void; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <View style={s.railItem}>
      <Pressable
        role="button" aria-label={label} aria-pressed={on} aria-disabled={disabled} disabled={disabled} testID={testID} onPress={onPress}
        onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} onFocus={() => setOver(true)} onBlur={() => setOver(false)}
        {...webProps({ title: tip })}
        style={[s.rb, on && (danger ? s.rbRec : s.rbOn), over && !disabled && s.rbOver, disabled && { opacity: 0.45 }]}
      >
        <Icon name={icon} size={20} {...(icon === "recdot" || icon === "recstop" ? { fill: "#fff" } : {})} />
        {timer ? <Text testID="rail-timer" style={s.timer}>{timer}</Text> : null}
      </Pressable>
      {over && !disabled ? <View testID="rail-tip" style={s.tip}><Text style={s.tipText}>{tip}</Text></View> : null}
    </View>
  );
}

/** The agent's desktop as a quiet drawing: a window with an address bar and a form, a typing line, the dock with Chrome, Terminal and Files. Asleep it is a moon. */
export function Desk({ kind, caption }: { kind: "asleep" | "live" | "mine" | "busy" | "error"; caption: string }): ReactElement {
  if (kind === "asleep") {
    return <View testID="desk-asleep" style={s.sleep}><Icon name="moon" size={64} color="#5b5f6a" width={1.1} /><Text style={s.zzz}>z z z</Text></View>;
  }
  return (
    <View testID={`desk-${kind}`} style={s.desk}>
      <View style={s.menubar}><View style={s.menuDot} /><View style={s.menuBar} /></View>
      <View style={s.win}>
        <View style={s.tb}><View style={s.tbDot} /><View style={s.tbDot} /><View style={s.tbDot} /><View style={s.tbUrl}><Text numberOfLines={1} style={s.tbUrlText}>forms.northwind.example/intake/rivera</Text></View></View>
        <View style={s.pg}>
          <View style={[s.ln, { width: "38%" }]} />
          <View style={[s.fld, kind === "live" && { borderColor: "#6c6cf0" }]}><Text numberOfLines={1} style={s.fldText}>{caption}</Text></View>
          <View style={s.fld}><Text style={s.fldText}>elena@riveraholdings.example</Text></View>
          <View style={s.fld}><Text style={s.fldText}>•••••••• #Northwind_Forms</Text></View>
          <View style={[s.ln, { width: "70%" }]} />
          <View style={[s.ln, { width: "52%" }]} />
        </View>
      </View>
      <View style={s.dock}><View style={[s.dockIcon, { backgroundColor: "#3b7ddd" }]} /><View style={[s.dockIcon, { backgroundColor: "#2b2d33" }]} /><View style={[s.dockIcon, { backgroundColor: "#d9a441" }]} /></View>
    </View>
  );
}

/** A text button on the sheet; `primary` is the one filled action. */
export function SheetButton({ label, onPress, primary = false, disabled = false, testID }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} testID={testID} onPress={onPress}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[s.btn, primary ? s.btnPrimary : over && s.btnOver, disabled && { opacity: 0.5 }]}
    >
      <Text style={[s.btnText, primary && s.btnTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

export const s = StyleSheet.create({
  railItem: { alignItems: "center", justifyContent: "center" },
  rb: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(30,30,34,0.85)" as string },
  rbOn: { backgroundColor: "var(--accent)" as string },
  rbRec: { backgroundColor: "#d0453b" as string },
  rbOver: { transform: [{ scale: 1.06 }] },
  timer: { position: "absolute", bottom: -16, fontSize: 11, color: "#fff", fontVariant: ["tabular-nums"] },
  tip: { position: "absolute", right: 54, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "rgba(0,0,0,0.8)" as string },
  tipText: { fontSize: 12, color: "#fff" },
  sleep: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#0f1012" as string },
  zzz: { fontSize: 14, letterSpacing: 6, color: "#5b5f6a" },
  desk: { flex: 1, backgroundColor: "#1a1c22" as string },
  menubar: { height: 22, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, backgroundColor: "rgba(0,0,0,0.35)" as string },
  menuDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#8a8f9c" },
  menuBar: { width: 120, height: 6, borderRadius: 3, backgroundColor: "#3b3f49" },
  win: { alignSelf: "center", marginTop: 56, width: "62%", maxWidth: 760, borderRadius: 10, backgroundColor: "#f6f6f4" as string, overflow: "hidden" },
  tb: { height: 30, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, backgroundColor: "#e4e4e1" as string },
  tbDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#bdbdb8" as string },
  tbUrl: { flex: 1, height: 18, marginLeft: 10, borderRadius: 9, justifyContent: "center", paddingHorizontal: 10, backgroundColor: "#fff" as string },
  tbUrlText: { fontSize: 11, color: "#6b6b70" },
  pg: { padding: 20, gap: 12 },
  ln: { height: 9, borderRadius: 5, backgroundColor: "#dcdcd8" as string },
  fld: { height: 30, borderRadius: 7, borderWidth: 1, borderColor: "#cfcfca" as string, justifyContent: "center", paddingHorizontal: 10 },
  fldText: { fontSize: 12.5, color: "#2a2a2e" },
  dock: { position: "absolute", bottom: 14, alignSelf: "center", flexDirection: "row", gap: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.12)" as string },
  dockIcon: { width: 34, height: 34, borderRadius: 9 },
  btn: { height: 30, paddingHorizontal: 12, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnPrimary: { backgroundColor: "var(--accent)" as string },
  btnText: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  btnTextPrimary: { color: "var(--accent-ink)" as string },
});
