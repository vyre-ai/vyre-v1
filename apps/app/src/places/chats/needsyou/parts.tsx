// Small pieces shared by Needs you and the helper chat: stroke icons, the agent's face, a quiet icon button, text buttons and the key hint. Colours are skin tokens, so a skin
// switch repaints with no re-render.
import { createElement, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";

const PATHS = {
  check: ["M3 8.500l3 3 7-7"],
  x: ["M4 4l8 8M12 4l-8 8"],
  more: ["M3.500 8h.01", "M8 8h.01", "M12.500 8h.01"],
  filter: ["M2.500 4h11M4.500 8h7M6.500 12h3"],
  lock: ["M4.500 7.500h7v5.500h-7z", "M6 7.500V5.800a2 2 0 014 0v1.700"],
  helper: ["M8 2.500l1.200 3 3 .4-2.300 2 .7 3.100L8 9.500 5.400 11l.7-3.100-2.300-2 3-.4z"],
  chev: ["M6 4l4 4-4 4"],
  back: ["M9.500 3.500L5 8l4.500 4.500"],
  inbox: ["M2.500 9l1.800-5.500h7.400L13.500 9v3.500h-11z", "M2.500 9h3.200l.8 1.600h3l.8-1.600h3.200"],
  clock: ["M8 13.500a5.500 5.500 0 100-11 5.500 5.500 0 000 11z", "M8 5v3.200l2 1.300"],
  key: ["M10.500 6.500a3 3 0 10-2.800 2.900L8.200 10H9.500v1.300h1.300V12.600H12V10.300z"],
  people: ["M5.500 7a2 2 0 100-4 2 2 0 000 4z", "M1.800 13c0-2.200 1.700-3.800 3.700-3.800S9.200 10.800 9.200 13", "M11 7.500a1.700 1.700 0 100-3.400", "M11.200 9.400c1.800.1 3 1.400 3 3.600"],
  file: ["M4 2.500h5l3 3v7a1 1 0 01-1 1H4a1 1 0 01-1-1v-9a1 1 0 011-1z", "M9 2.500v3h3"],
} as const;
export type IconName = keyof typeof PATHS;

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

export function Icon({ name, size = 15, color = "var(--ink-3)", width = 1.4 }: { name: IconName; size?: number; color?: string; width?: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const paths: ReactElement[] = [];
  for (const d of PATHS[name]) paths.push(createElement("path", { key: d, d, fill: "none" }));
  return createElement("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: name === "more" ? 2.4 : width, strokeLinecap: "round", strokeLinejoin: "round" } }, ...paths);
}

/** An agent is a pixel face on a soft tint, a person a round marble: the shared Avatar. */
export function Face({ name, kind = "agent", size = 18 }: { name: string; kind?: "agent" | "person"; size?: number }): ReactElement {
  return (
    <View aria-hidden testID={`face-${name}`} style={{ width: size, height: size, flexShrink: 0, flexGrow: 0 }}>
      <Avatar name={name} kind={kind} size={size} />
    </View>
  );
}

export function LeadIcon({ name, color, size = 14 }: { name: IconName; color?: string; size?: number }): ReactElement {
  return <View style={s.lead}><Icon name={name} size={size} {...(color ? { color } : {})} /></View>;
}

/** A small icon button, in a header or a row's trailing slot. */
export function Tool({ icon, label, onPress, active = false, testID }: { icon: IconName; label: string; onPress: (x: number, y: number) => void; active?: boolean; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} testID={testID}
      {...webProps({ title: label })}
      onPress={(e) => {
        const ev = e as unknown as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
        const box = ev.currentTarget?.getBoundingClientRect?.();
        onPress(box ? box.left : ev.nativeEvent?.pageX ?? 0, box ? box.bottom + 4 : ev.nativeEvent?.pageY ?? 0);
      }}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[s.tool, (over || active) && s.toolOver]}
    >
      <Icon name={icon} size={14} color={over || active ? "var(--ink)" : "var(--ink-3)"} />
    </Pressable>
  );
}

/** A text button: `primary` is the one filled action; `quiet` has no fill. `hint` is the key that does the same (A, B). */
export function Button({ label, onPress, primary = false, disabled = false, hint, testID }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; hint?: string; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} testID={testID} onPress={onPress}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[s.btn, primary ? s.btnPrimary : over && s.btnOver, disabled && { opacity: 0.5 }]}
    >
      <Text style={[s.btnText, primary && s.btnTextPrimary]}>{label}</Text>
      {hint ? <Text style={[s.hint, primary && s.hintPrimary]}>{hint}</Text> : null}
    </Pressable>
  );
}

export const s = StyleSheet.create({
  lead: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  tool: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  toolOver: { backgroundColor: "var(--press)" as string },
  btn: { height: 30, paddingHorizontal: 12, borderRadius: 8, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnPrimary: { backgroundColor: "var(--ink)" as string },
  btnText: { fontSize: 13, fontWeight: "500", color: "var(--ink)" as string },
  btnTextPrimary: { color: "var(--win)" as string },
  hint: { fontSize: 11, color: "var(--ink-4)" as string },
  hintPrimary: { color: "var(--win)" as string, opacity: 0.6 },
});
