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
  bulb: ["M8 2.5a3.8 3.8 0 00-2.2 6.9c.4.4.7.9.7 1.4v.2h3v-.2c0-.5.3-1 .7-1.4A3.8 3.8 0 008 2.5z", "M6.5 13h3"],
  person: ["M8 8a2.7 2.7 0 100-5.4A2.7 2.7 0 008 8z", "M2.8 13.5c.5-2.4 2.6-3.6 5.2-3.6s4.7 1.2 5.2 3.6"],
  users: ["M6 7.6a2.3 2.3 0 100-4.6 2.3 2.3 0 000 4.6z", "M1.8 13c.4-2 2-3 4.2-3s3.8 1 4.2 3", "M10.6 7.2a2 2 0 100-4M12 10.2c1.3.3 2.2 1.1 2.4 2.6"],
  folder: ["M2.5 4.5a1 1 0 011-1H6l1.4 1.6h5.1a1 1 0 011 1v6.4a1 1 0 01-1 1h-9a1 1 0 01-1-1z"],
  hash: ["M6.2 2.8L5 13.2M11 2.8L9.8 13.2M3 6h10.5M2.5 10h10.5"],
  history: ["M2.8 8a5.2 5.2 0 105.2-5.2A5.3 5.3 0 004.2 4.5L2.8 6", "M2.8 3v3h3", "M8 5.2V8l2 1.3"],
  trash: ["M3 4.5h10M6.2 4.5V3h3.6v1.5M4.2 4.5l.6 8.2a1 1 0 001 .9h4.4a1 1 0 001-.9l.6-8.2M6.6 7v4M9.4 7v4"],
  archive: ["M2.5 3.5h11v3h-11z", "M3.5 6.5v6a1 1 0 001 1h7a1 1 0 001-1v-6M6.5 9h3"],
  edit: ["M10.8 2.8l2.4 2.4-7.4 7.4-3 .6.6-3z", "M9.4 4.2l2.4 2.4"],
  more: ["M3.5 8h.01M8 8h.01M12.5 8h.01"],
  chat: ["M3 3.5h10a1 1 0 011 1v6a1 1 0 01-1 1H7.5L5 14v-2.5H3a1 1 0 01-1-1v-6a1 1 0 011-1z"],
  sheet: ["M3 3.5a1 1 0 011-1h8a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1z", "M3 6.5h10M3 9.5h10M6.5 6.5v6"],
  run: ["M13.5 8a5.5 5.5 0 11-1.6-3.9", "M13 2.5v2.6h-2.6"],
  info: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M8 7.2v3.6M8 5.2h.01"],
  jump: ["M9.5 2.5h4v4M13.5 2.5L7.5 8.5", "M11.5 9v3.5a1 1 0 01-1 1h-7a1 1 0 01-1-1v-7a1 1 0 011-1H7"],
  undo: ["M3.5 6.5h6a3 3 0 010 6H6", "M5.8 3.8L3.2 6.5l2.6 2.7"],
  bolt: ["M8.8 2L4 9h3.5L7 14l5-7.2H8.4z"],
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
