// Small pieces the memory screens share: stroke icons (16 px viewBox), a quiet header button that opens a menu under itself, and where a menu anchors.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";
import { each } from "./model.ts";

const PATHS = {
  graph: ["M3.5 4.5a1.5 1.5 0 103 0 1.5 1.5 0 10-3 0zM9.5 11.5a1.5 1.5 0 103 0 1.5 1.5 0 10-3 0zM9.5 3.5a1.5 1.5 0 103 0 1.5 1.5 0 10-3 0z", "M5.8 5.4l4 5M6.6 4.3h2.9"],
  chevd: ["M3.5 6l4.5 4.5L12.5 6"],
  find: ["M11.5 7a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z", "M10.5 10.5L14 14"],
  layers: ["M8 2.5l5.5 3L8 8.5l-5.5-3z", "M2.5 8.5L8 11.5l5.5-3M2.5 11L8 14l5.5-3"],
  filter: ["M2.5 4.5h11M4.5 8h7M6.5 11.5h3"],
  export: ["M8 2.5v8M5 5.5l3-3 3 3", "M3 10v2.5a1 1 0 001 1h8a1 1 0 001-1V10"],
  clock: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M8 4.8V8l2.2 1.4"],
  plus: ["M8 3v10M3 8h10"],
  minus: ["M3 8h10"],
  fit: ["M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"],
  check: ["M3 8.5l3 3 7-7"],
  x: ["M4 4l8 8M12 4l-8 8"],
  lock: ["M4.5 7.5h7a1 1 0 011 1v4a1 1 0 01-1 1h-7a1 1 0 01-1-1v-4a1 1 0 011-1z", "M5.5 7.5V5.5a2.5 2.5 0 015 0v2"],
  note: ["M4 2.5h5.5L12.5 5.5v8a1 1 0 01-1 1H4a1 1 0 01-1-1v-10a1 1 0 011-1z", "M9.5 2.5v3h3M5.5 8.5h5M5.5 11h3"],
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 15, color = "var(--ink-3)", width = 1.4 }: { name: IconName; size?: number; color?: string; width?: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  return createElement(
    "svg",
    { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", width: size, stroke: color, strokeWidth: width, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } },
    ...each(PATHS[name], (d) => createElement("path", { key: d, d })),
  );
}

/**
 * Where a menu opens for a press: under the pointer when the press has one, otherwise under the button that was pressed (its left edge, its bottom), so a click, the keyboard and code all
 * land in the same place.
 */
export function pointOf(e: unknown): { x: number; y: number } {
  const ev = e as { nativeEvent?: { pageX?: number; pageY?: number }; currentTarget?: Anchor; target?: Anchor };
  const ok = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const x = ok(ev.nativeEvent?.pageX), y = ok(ev.nativeEvent?.pageY);
  if (x !== 0 || y !== 0) return { x, y };
  const box = (ev.currentTarget ?? ev.target)?.getBoundingClientRect?.();
  return box ? { x: box.left, y: box.bottom } : { x, y };
}
interface Anchor { getBoundingClientRect?: () => { left: number; bottom: number } }

/** A quiet header button: an icon and a word, lit when something is applied. It hands its press point to `onPress`, so a menu can open under it. */
export function QuietButton({ icon, label, lit = false, testID, onPress }: { icon: IconName; label: string; lit?: boolean; testID: string; onPress: (x: number, y: number) => void }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: lit }} testID={testID}
      onPress={(e) => { const p = pointOf(e); onPress(p.x, p.y); }}
      style={({ hovered }: { hovered?: boolean }) => [q.btn, hovered === true && q.over]}
    >
      <Icon name={icon} size={14} color={lit ? "var(--accent)" : "var(--ink-2)"} />
      <Text style={[q.text, lit && q.lit]}>{label}</Text>
    </Pressable>
  );
}

const q = StyleSheet.create({
  btn: { height: 28, paddingHorizontal: 7, borderRadius: 7, flexDirection: "row", alignItems: "center", gap: 6 },
  over: { backgroundColor: "var(--hover)" as string },
  text: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  lit: { color: "var(--accent)" as string },
});
