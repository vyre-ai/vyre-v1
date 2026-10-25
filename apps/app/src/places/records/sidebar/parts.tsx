// Shared pieces of the Records sidebar and table: stroke icons, faces, small buttons. Colours are skin tokens, so a skin switch repaints with no re-render.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

/** 16 px viewBox stroke icons, from the prototype's Records. */
export const ICON = {
  table: ["M3.5 2.5h9a1 1 0 011 1v9a1 1 0 01-1 1h-9a1 1 0 01-1-1v-9a1 1 0 011-1z", "M2.5 6h11M2.5 9.5h11M6.5 6v7.5"],
  people: ["M8 5.5a2.3 2.3 0 11-4.6 0 2.3 2.3 0 014.6 0z", "M1.8 13a4.2 4.2 0 018.4 0", "M10.5 3.5a2.3 2.3 0 010 4.4", "M12 9.2a4.2 4.2 0 012.2 3.8"],
  building: ["M3.5 13.5v-10a1 1 0 011-1h5a1 1 0 011 1v10", "M9.5 7h2a1 1 0 011 1v5.5", "M2.5 13.5h11", "M6 5h1M6 7.5h1M6 10h1"],
  folder: ["M2.5 4.5a1 1 0 011-1h3l1.5 1.5h4.5a1 1 0 011 1v6.5a1 1 0 01-1 1h-9a1 1 0 01-1-1z"],
  project: ["M5 2.5h6A2.5 2.5 0 0113.5 5v6a2.5 2.5 0 01-2.5 2.5H5A2.5 2.5 0 012.5 11V5A2.5 2.5 0 015 2.5z", "M5.5 6h5M5.5 8.5h5M5.5 11h2.5"],
  calendar: ["M4.5 3.5h7a2 2 0 012 2v6a2 2 0 01-2 2h-7a2 2 0 01-2-2v-6a2 2 0 012-2z", "M2.5 6.5h11M5.5 2v3M10.5 2v3"],
  agent: ["M5 4.5h6a2 2 0 012 2v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3a2 2 0 012-2z", "M8 2.5v2M6 8h.01M10 8h.01M6 13.5h4"],
  globe: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M2.5 8h11M8 2.5c1.6 1.6 2.4 3.4 2.4 5.5S9.6 11.9 8 13.5C6.4 11.9 5.6 10.1 5.6 8S6.4 4.1 8 2.5z"],
  sync: ["M13 6A5 5 0 004.2 4.2L3 5.5M3 2.5v3h3", "M3 10a5 5 0 008.8 1.8L13 10.5M13 13.5v-3h-3"],
  map: ["M2.5 4l3.5-1.5 4 1.5 3.5-1.5v9.5L10 13.5 6 12l-3.5 1.5z", "M6 2.5V12M10 4v9.5"],
  schema: ["M8 2.5v3M4 9.5V8h8v1.5M8 5.5V8M4 9.5h.01M12 9.5h.01M3 9.5h2v3H3zM11 9.5h2v3h-2zM7 2.5h2v3H7z"],
  users: ["M8 5.5a2.3 2.3 0 11-4.6 0 2.3 2.3 0 014.6 0z", "M1.8 13a4.2 4.2 0 018.4 0"],
  chevd: ["M3.5 6l4.5 4.5L12.5 6"],
  chevr: ["M6 3.5l4.5 4.5L6 12.5"],
  plus: ["M8 3v10M3 8h10"],
  filter: ["M2.5 4.5h11M4.5 8h7M6.5 11.5h3"],
  sort: ["M5 3v10M2.5 10.5L5 13l2.5-2.5", "M11 13V3M8.5 5.5L11 3l2.5 2.5"],
  group: ["M3 4h10M5.5 8h7.5M5.5 12h7.5M3 8h.01M3 12h.01"],
  eye: ["M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8z", "M9.8 8a1.8 1.8 0 11-3.6 0 1.8 1.8 0 013.6 0z"],
  colour: ["M8 2.5c3 0 5.5 2.2 5.5 4.8 0 1.6-1.2 2.4-2.6 2.4H9.6a1 1 0 00-.8 1.6c.5.8.1 2.2-1 2.2-3 0-5.8-2.2-5.8-5.6S5 2.5 8 2.5z", "M5.5 7h.01M8 5.2h.01M10.5 7h.01"],
  find: ["M11.5 7a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z", "M10.5 10.5L14 14"],
  link: ["M6.8 9.2a2.6 2.6 0 003.7 0l2-2a2.6 2.6 0 00-3.7-3.7l-.6.6", "M9.2 6.8a2.6 2.6 0 00-3.7 0l-2 2a2.6 2.6 0 003.7 3.7l.6-.6"],
  asc: ["M8 3.5v9M4.5 7L8 3.5 11.5 7"],
  desc: ["M8 12.5v-9M4.5 9L8 12.5 11.5 9"],
  check: ["M3 8.5l3 3 7-7"],
  expand: ["M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9"],
} as const;
export type IconName = keyof typeof ICON;

/** The glyph a record type's `icon` names; an icon this set does not draw falls back to the table. */
export function typeIcon(icon: string): IconName {
  const known: Record<string, IconName> = {
    table: "table", users: "people", people: "people", person: "people", contact: "people", contacts: "people", building: "building", company: "building", companies: "building",
    folder: "folder", project: "project", projects: "project", calendar: "calendar", meeting: "calendar", meetings: "calendar", agent: "agent", agents: "agent", globe: "globe", site: "globe",
  };
  return known[icon] ?? "table";
}

/** One stroke icon. Web only (an SVG); other platforms draw nothing until their own icon set lands. */
export function Glyph({ name, size = 15, color = "var(--ink-3)", width }: { name: IconName; size?: number; color?: string; width?: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const paths: ReactElement[] = [];
  for (const d of ICON[name]) paths.push(createElement("path", { key: d, d, fill: "none" }));
  return createElement(
    "svg",
    { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: width ?? 1.4, strokeLinecap: "round", strokeLinejoin: "round" } },
    ...paths,
  );
}

export function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** A person is a circle; the colour comes from the name, mixed into the surface so it reads in every skin. */
export function Face({ name, size = 20 }: { name: string; size?: number }): ReactElement {
  const hue = (hash(name) % 12) * 30;
  const words = name.trim().split(/\s+/).filter(Boolean);
  let text = (words[0]?.[0] ?? "?").toUpperCase();
  if (size >= 24) {
    text = "";
    for (const w of words.slice(0, 2)) text += (w[0] ?? "").toUpperCase();
  }
  return (
    <View aria-hidden testID={`face-${name}`} style={{ width: size, height: size, borderRadius: size, backgroundColor: `hsla(${hue}, 65%, 52%, 0.22)` as string, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: `hsl(${hue}, 55%, 46%)` as string, fontSize: Math.max(9, Math.round(size * 0.48)), fontWeight: "600" }}>{text}</Text>
    </View>
  );
}

/** Where a press landed, so a menu opens under the pointer. A press without coordinates (the keyboard) opens at the top left of the window. */
export function pointOf(e: unknown): { x: number; y: number } {
  const n = (e as { nativeEvent?: { pageX?: number; pageY?: number } }).nativeEvent;
  const ok = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { x: ok(n?.pageX), y: ok(n?.pageY) };
}

/** Where a menu opened from a button goes: under the button's left edge, whether it was pressed, clicked from code or opened by the keyboard (rule 26). Falls back to the press point. */
export function anchorOf(e: unknown): { x: number; y: number } {
  const box = (e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget?.getBoundingClientRect?.();
  if (box && Number.isFinite(box.left) && Number.isFinite(box.bottom)) return { x: box.left, y: box.bottom + 4 };
  return pointOf(e);
}

/** A quiet header button: an icon, a label that drops away on a phone, and what it applies ("Sort", "Name"). Lit when something is applied. */
export function HeadButton({ icon, label, detail, on = false, testID, onPress, bare = false }: {
  icon: IconName; label: string; detail?: string | undefined; on?: boolean; testID?: string; onPress: (x: number, y: number) => void; bare?: boolean;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ selected: on }}
      testID={testID}
      onPress={(e) => { const p = anchorOf(e); onPress(p.x, p.y); }}
      style={({ hovered }: { hovered?: boolean }) => [s.hb, hovered === true && s.hbOver]}
    >
      <Glyph name={icon} size={14} color={on ? "var(--accent)" : "var(--ink-2)"} />
      {bare ? null : <Text style={[s.hbText, on && s.hbOn]}>{label}</Text>}
      {detail && !bare ? <Text style={s.hbDetail}>{detail}</Text> : null}
    </Pressable>
  );
}

export const s = StyleSheet.create({
  hb: { height: 28, paddingHorizontal: 7, borderRadius: 7, flexDirection: "row", alignItems: "center", gap: 6 },
  hbOver: { backgroundColor: "var(--hover)" as string },
  hbText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  hbOn: { color: "var(--accent)" as string },
  hbDetail: { fontSize: 12, color: "var(--ink-3)" as string },
});
