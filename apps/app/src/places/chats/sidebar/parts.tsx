// Small pieces of the Chats sidebar: stroke icons, the face tile, the working pulse, the unread dot, the section header. Sizes and colours follow the prototype's
// sidebar (rows 28 high, faces 18 px) and every colour is a skin token, so a skin switch repaints with no re-render.
import { createElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";

export const ICON = {
  chev: ["M4 6l4 4 4-4"],
  plus: ["M8 3.5v9M3.5 8h9"],
  filter: ["M2.5 4h11M4.5 8h7M6.5 12h3"],
  search: ["M7 11.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9z", "M10.5 10.5l3 3"],
  compose: ["M3 13h10", "M10.8 2.7l2.5 2.5L6.5 12 3.5 12.5 4 9.5z"],
  hash: ["M6.2 2.5l-1 11M10.8 2.5l-1 11M3 6h10.2M2.8 10h10.2"],
  lock: ["M4.5 7.5h7v5.5h-7z", "M6 7.5V5.8a2 2 0 014 0v1.7"],
  star: ["M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4 4.4 13.3l.7-4L2.2 6.5l4-.6z"],
  check: ["M3 8.5l3 3 7-7"],
  inbox: ["M2.5 9l1.8-5.5h7.4L13.5 9v3.5h-11z", "M2.5 9h3.2l.8 1.6h3l.8-1.6h3.2"],
  project: ["M5 2.5h6A2.5 2.5 0 0113.5 5v6a2.5 2.5 0 01-2.5 2.5H5A2.5 2.5 0 012.5 11V5A2.5 2.5 0 015 2.5z", "M5.5 6h5M5.5 8.5h5M5.5 11h2.5"],
  more: ["M3.5 8h.01", "M8 8h.01", "M12.5 8h.01"],
  arrow: ["M3 8h10M9 4l4 4-4 4"],
} as const;
export type IconName = keyof typeof ICON;

export function Glyph({ name, size = 15, color = "var(--ink-3)", fill }: { name: IconName; size?: number; color?: string; fill?: string }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const paths: ReactElement[] = [];
  for (const d of ICON[name]) paths.push(createElement("path", { key: d, d, fill: fill ?? "none" }));
  return createElement(
    "svg",
    { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: name === "more" ? 2.4 : 1.4, strokeLinecap: "round", strokeLinejoin: "round" } },
    ...paths,
  );
}

/** A person is a round marble, an agent a pixel face on a soft tint: the shared Avatar. `pulse` rings it while an agent works; `online` adds the presence dot. */
export function Face({ name, kind, size = 18, pulse = false, online = false }: { name: string; kind: "person" | "agent"; size?: number; pulse?: boolean; online?: boolean }): ReactElement {
  return (
    <View aria-hidden testID={`face-${name}`} style={{ width: size, height: size, flexShrink: 0, flexGrow: 0 }}>
      <Avatar name={name} kind={kind} size={size} />
      {pulse ? <View testID="pulse" style={[s.pulse, { width: size + 6, height: size + 6, borderRadius: kind === "person" ? size : Math.round(size * 0.4) }]} /> : null}
      {online ? <View testID="presence" style={s.presence} /> : null}
    </View>
  );
}

/** A glyph in the leading slot of a channel or Needs row, the width of a face so titles line up. */
export function LeadGlyph({ name, color }: { name: IconName; color?: string }): ReactElement {
  return <View style={s.lead}><Glyph name={name} size={14} {...(color ? { color } : {})} /></View>;
}

export function UnreadDot(): ReactElement {
  return <View testID="unread-dot" accessibilityLabel="Unread" style={s.dot} />;
}

export function Badge({ n, testID }: { n: number; testID?: string }): ReactElement {
  return <View testID={testID} style={s.badge}><Text style={s.badgeText}>{n > 99 ? "99+" : n}</Text></View>;
}

/** A small icon button in a section header or a row's trailing slot. */
export function Tool({ icon, label, onPress, active = false, testID }: { icon: IconName; label: string; onPress: (x: number, y: number) => void; active?: boolean; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} testID={testID}
      onPress={(e) => {
        const ev = e as unknown as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
        const box = ev.currentTarget?.getBoundingClientRect?.();
        onPress(box ? box.left : ev.nativeEvent?.pageX ?? 0, box ? box.bottom + 4 : ev.nativeEvent?.pageY ?? 0);
      }}
      onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[s.tool, (over || active) && s.toolOver]}
    >
      <Glyph name={icon} size={14} color={over || active ? "var(--ink)" : "var(--ink-3)"} />
    </Pressable>
  );
}

/** A section header: the label with its chevron toggles the section; tools sit at the right and show while the pointer is on the header, or the section is filtered. */
export function SectionHead({ id, label, count, open, onToggle, keep = false, children }: { id: string; label: string; count?: number | undefined; open: boolean; onToggle: () => void; keep?: boolean; children?: ReactNode }): ReactElement {
  const [over, setOver] = useState(false);
  const hover = { onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false) };
  return (
    <View testID={`head-${id}`} style={s.head} {...hover}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}${count ? `, ${count}` : ""}`} accessibilityState={{ expanded: open }} onPress={onToggle} testID={`toggle-${id}`} style={s.headLabel}>
        <Text style={s.headText}>{label}</Text>
        <View style={{ transform: [{ rotate: open ? "0deg" : "-90deg" }] }}><Glyph name="chev" size={11} color="var(--ink-4)" /></View>
        {count ? <Badge n={count} testID={`count-${id}`} /> : null}
      </Pressable>
      <View style={s.grow} />
      <View style={[s.tools, { opacity: over || keep ? 1 : 0 }]} pointerEvents={over || keep ? "auto" : "none"}>{children}</View>
    </View>
  );
}

export function GroupLabel({ label }: { label: string }): ReactElement {
  return <View testID={`group-${label}`} style={s.group}><Text accessibilityRole="header" style={s.groupText}>{label}</Text></View>;
}

export function EmptyLine({ text }: { text: string }): ReactElement {
  return <View testID="recent-empty" style={s.empty}><Text style={s.emptyText}>{text}</Text></View>;
}

export const s = StyleSheet.create({
  pulse: { position: "absolute", left: -3, top: -3, borderWidth: 1.5, borderColor: "var(--accent)" as string, opacity: 0.55 },
  presence: { position: "absolute", right: -2, bottom: -2, width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--ok)" as string, borderWidth: 1.5, borderColor: "var(--side)" as string },
  lead: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--accent)" as string },
  badge: { minWidth: 17, height: 17, paddingHorizontal: 5, borderRadius: 9, backgroundColor: "var(--accent-wash)" as string, alignItems: "center", justifyContent: "center", marginLeft: 6 },
  badgeText: { fontSize: 11, fontWeight: "600", color: "var(--accent)" as string },
  tool: { width: 22, height: 22, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  toolOver: { backgroundColor: "var(--press)" as string },
  head: { height: 28, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, marginTop: 0 },
  headLabel: { flexDirection: "row", alignItems: "center", gap: 4, height: 22 },
  headText: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  grow: { flex: 1, minWidth: 0 },
  tools: { flexDirection: "row", alignItems: "center", gap: 2 },
  group: { height: 28, justifyContent: "center", paddingHorizontal: 8 },
  groupText: { fontSize: 11, fontWeight: "500", color: "var(--ink-4)" as string },
  empty: { height: 28, justifyContent: "center", paddingHorizontal: 8 },
  emptyText: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
