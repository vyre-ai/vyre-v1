// Shared pieces of the Inbox sidebar and list: stroke icons, faces, the section header, small buttons. Colours are skin tokens, so a skin switch repaints with no re-render.
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";

/** 16 px viewBox stroke icons, from the prototype's Inbox. */
export const ICON = {
  mail: ["M4 3.5h8a2 2 0 012 2v5a2 2 0 01-2 2H4a2 2 0 01-2-2v-5a2 2 0 012-2z", "M2.5 5l5.5 4 5.5-4"],
  sms: ["M3 4.5A1.5 1.5 0 014.5 3h7A1.5 1.5 0 0113 4.5v5a1.5 1.5 0 01-1.5 1.5H7l-3 2.5V11h-.5A1.5 1.5 0 013 9.5z"],
  call: ["M3.2 2.8h2.3l1 2.8-1.3.9a8 8 0 003.4 3.4l.9-1.3 2.8 1v2.3c0 .6-.5 1.1-1.1 1.1A9.8 9.8 0 012.1 3.9c0-.6.5-1.1 1.1-1.1z"],
  users: ["M8 5.5a2.3 2.3 0 11-4.6 0 2.3 2.3 0 014.6 0z", "M1.8 13a4.2 4.2 0 018.4 0", "M10.5 3.5a2.3 2.3 0 010 4.4", "M12 9.2a4.2 4.2 0 012.2 3.8"],
  thread: ["M3 4h10M3 8h10M3 12h6"],
  mix: ["M2.5 5h11M2.5 8h11M2.5 11h11"],
  cal: ["M4.5 3.5h7a2 2 0 012 2v6a2 2 0 01-2 2h-7a2 2 0 01-2-2v-6a2 2 0 012-2z", "M2.5 6.5h11M5.5 2v3M10.5 2v3"],
  bell: ["M4 11V7.4a4 4 0 018 0V11l1.2 1.6H2.8z", "M6.4 14a1.7 1.7 0 003.2 0"],
  flag: ["M3.5 14V2.5M3.5 3h8l-1.7 2.6L11.5 8h-8"],
  lock: ["M5 7h6a1 1 0 011 1v4.5a1 1 0 01-1 1H5a1 1 0 01-1-1V8a1 1 0 011-1z", "M5.5 7V5a2.5 2.5 0 015 0v2"],
  filter: ["M2.5 4.5h11M4.5 8h7M6.5 11.5h3"],
  chevd: ["M3.5 6l4.5 4.5L12.5 6"],
  more: ["M3.5 8h.01", "M8 8h.01", "M12.5 8h.01"],
  pen: ["M3 13h2.2L12.6 5.6a1.5 1.5 0 000-2.1l-.1-.1a1.5 1.5 0 00-2.1 0L3 10.8z", "M9.2 4.6l2.2 2.2"],
  plus: ["M8 3v10M3 8h10"],
  search: ["M11.5 7a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z", "M10.5 10.5L14 14"],
  link: ["M6.8 9.2a2.6 2.6 0 003.7 0l2-2a2.6 2.6 0 00-3.7-3.7l-.6.6", "M9.2 6.8a2.6 2.6 0 00-3.7 0l-2 2a2.6 2.6 0 003.7 3.7l.6-.6"],
  check: ["M3 8.5l3 3 7-7"],
  inbox: ["M2.5 9.5l1.6-5.2a1.5 1.5 0 011.4-1.1h5a1.5 1.5 0 011.4 1.1l1.6 5.2V12a1.5 1.5 0 01-1.5 1.5h-8A1.5 1.5 0 012.5 12z", "M2.5 9.5h3l1 1.5h3l1-1.5h3"],
} as const;
export type IconName = keyof typeof ICON;

/** One stroke icon. Web only (an SVG); other platforms draw nothing until their own icon set lands. */
export function Glyph({ name, size = 15, color = "var(--ink-3)" }: { name: IconName; size?: number; color?: string }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const paths: ReactElement[] = [];
  for (const d of ICON[name]) paths.push(createElement("path", { key: d, d, fill: "none" }));
  return createElement(
    "svg",
    { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: name === "more" ? 2.4 : 1.4, strokeLinecap: "round", strokeLinejoin: "round" } },
    ...paths,
  );
}

/** A person is a round marble seeded by the name (a square-cornered pixel face when `round` is off): the shared Avatar. */
export function Face({ name, size = 36, round = true }: { name: string; size?: number; round?: boolean }): ReactElement {
  return (
    <View aria-hidden testID={`face-${name}`} style={{ width: size, height: size, flexShrink: 0 }}>
      <Avatar name={name} kind={round ? "person" : "agent"} size={size} />
    </View>
  );
}

/** The face of a sender who is not matched to a record yet: a call glyph on a quiet disc. */
export function Ghost({ size = 36 }: { size?: number }): ReactElement {
  return (
    <View aria-hidden testID="face-ghost" style={{ width: size, height: size, borderRadius: size, backgroundColor: "var(--sunk)" as string, alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 0 1px var(--line-2)" as string }}>
      <Glyph name="call" size={Math.round(size * 0.42)} />
    </View>
  );
}

/** Where a press landed, so a menu opens under the finger or the pointer. A press without coordinates (the keyboard) opens it at the top left of the window. */
export function pointOf(e: unknown): { x: number; y: number } {
  const n = (e as { nativeEvent?: { pageX?: number; pageY?: number } }).nativeEvent;
  const ok = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { x: ok(n?.pageX), y: ok(n?.pageY) };
}

/** A small icon button of a header or the sidebar top. Hover paints the whole button. */
export function IconButton({ icon, label, onPress, on = false, testID, children }: { icon: IconName; label: string; onPress: (x: number, y: number) => void; on?: boolean; testID?: string; children?: ReactNode }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      testID={testID}
      onPress={(e) => { const p = pointOf(e); onPress(p.x, p.y); }}
      style={({ hovered }: { hovered?: boolean }) => [s.ib, (hovered === true || on) && s.ibOver]}
    >
      <Glyph name={icon} size={15} color={on ? "var(--accent)" : "var(--ink-2)"} />
      {children}
    </Pressable>
  );
}

export function Unread({ n }: { n: number }): ReactElement | null {
  if (n <= 0) return null;
  return <Text style={s.badge} testID="unread-count">{n}</Text>;
}

export const s = StyleSheet.create({
  ib: { height: 28, minWidth: 28, paddingHorizontal: 6, borderRadius: 7, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  ibOver: { backgroundColor: "var(--hover)" as string },
  badge: { fontSize: 11.5, lineHeight: 16, fontWeight: "500", color: "var(--ink-2)" as string },
});
