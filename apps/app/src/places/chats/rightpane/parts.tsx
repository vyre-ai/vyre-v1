// Small pieces of the Chats right pane: stroke icons, the agent's face, a quiet icon button, the on/off switch, and PaneList, the one list every tab draws. PaneList is
// ui/VirtualList over ui/Row with its leading and trailing slots (ruling 36); it adds only the right-click menu and the hover tools. Colours are skin tokens, so a skin
// switch repaints with no re-render.
import { createElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { VirtualList } from "../../../../../../ui/src/VirtualList/index.tsx";
import type { VirtualWindow } from "../../../../../../ui/src/VirtualList/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";

const PATHS = {
  moon: ["M12.5 9.2A5.2 5.2 0 016.8 3.5a5.2 5.2 0 105.7 5.7z"],
  hand: ["M5.5 8V3.8a1 1 0 012 0V7M7.5 7V2.8a1 1 0 012 0V7M9.5 7V3.8a1 1 0 012 0v4.4c0 2.6-1.4 4.3-3.6 4.3-1.5 0-2.4-.6-3.3-1.8L3.1 8.4a1 1 0 011.5-1.3z"],
  expand: ["M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9"],
  terminal: ["M2.5 4.5a2 2 0 012-2h7a2 2 0 012 2v7a2 2 0 01-2 2h-7a2 2 0 01-2-2z", "M5 6.5l2 1.5-2 1.5M8.5 10h2.5"],
  lock: ["M4.5 7.5h7v5.5h-7z", "M6 7.5V5.8a2 2 0 014 0v1.7"],
  reply: ["M6.500 4L2.500 8l4 4M2.500 8h7a4 4 0 014 4"],
  helper: ["M8 2.500l1.200 3 3 .4-2.300 2 .7 3.100L8 9.500 5.400 11l.7-3.100-2.300-2 3-.4z"],
  chat: ["M3 4.5A2 2 0 015 2.5h6a2 2 0 012 2v4.5a2 2 0 01-2 2H7l-3 2.500V11a2 2 0 01-1-1.700z"],
  folder: ["M2.500 4.500a1 1 0 011-1h3l1.500 1.500h4.500a1 1 0 011 1v6.500a1 1 0 01-1 1h-9a1 1 0 01-1-1z"],
  file: ["M4 2.500h5l3 3v7a1 1 0 01-1 1H4a1 1 0 01-1-1v-9a1 1 0 011-1z", "M9 2.500v3h3"],
  back: ["M9.500 3.500L5 8l4.500 4.500"],
  chev: ["M4 6l4 4 4-4"],
  clock: ["M8 13.500a5.500 5.500 0 100-11 5.500 5.500 0 000 11z", "M8 5v3.200l2 1.300"],
  watch: ["M1.800 8s2.300-4.500 6.200-4.500S14.200 8 14.200 8s-2.300 4.500-6.200 4.500S1.800 8 1.800 8z", "M8 9.800a1.800 1.800 0 100-3.600 1.800 1.800 0 000 3.600z"],
  plus: ["M8 3.500v9M3.500 8h9"],
  check: ["M3 8.500l3 3 7-7"],
  x: ["M4 4l8 8M12 4l-8 8"],
  more: ["M3.500 8h.01", "M8 8h.01", "M12.500 8h.01"],
  filter: ["M2.500 4h11M4.500 8h7M6.500 12h3"],
  doc: ["M4 2.500h5l3 3v7a1 1 0 01-1 1H4a1 1 0 01-1-1v-9a1 1 0 011-1z", "M5.500 8h5M5.500 10.500h5"],
  edit: ["M10.800 2.700l2.500 2.500L6.500 12 3.500 12.500 4 9.500z"],
  trash: ["M3.500 4.500h9M6.500 4.500v-1h3v1M5 4.500l.5 8h5l.5-8"],
  copy: ["M5.500 5.500h7v8h-7z", "M3.500 10.500v-8h7"],
  bubble: ["M3 4.500A2 2 0 015 2.500h6a2 2 0 012 2v4.500a2 2 0 01-2 2H7l-3 2.500V11a2 2 0 01-1-1.700z"],
  rec: ["M8 11.500a3.500 3.500 0 100-7 3.500 3.500 0 000 7z"],
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 15, color = "var(--ink-3)", width = 1.4, fill }: { name: IconName; size?: number; color?: string; width?: number; fill?: string }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const paths: ReactElement[] = [];
  for (const d of PATHS[name]) paths.push(createElement("path", { key: d, d, fill: fill ?? "none" }));
  return createElement("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: name === "more" ? 2.4 : width, strokeLinecap: "round", strokeLinejoin: "round" } }, ...paths);
}

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** An agent is a rounded square whose colour comes from its name, mixed into the surface so it reads in every skin; `pulse` rings it while it works. */
export function Face({ name, size = 18, pulse = false }: { name: string; size?: number; pulse?: boolean }): ReactElement {
  const hue = (hash(name) % 12) * 30;
  return (
    <View aria-hidden testID={`face-${name}`} style={{ width: size, height: size, flexShrink: 0, flexGrow: 0 }}>
      <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: `hsla(${hue}, 65%, 52%, 0.22)` as string, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: `hsl(${hue}, 55%, 46%)` as string, fontSize: Math.max(9, Math.round(size * 0.5)), fontWeight: "600" }}>{(name.trim()[0] ?? "?").toUpperCase()}</Text>
      </View>
      {pulse ? <View testID="pulse" style={[s.pulse, { width: size + 6, height: size + 6, borderRadius: Math.round(size * 0.4) }]} /> : null}
    </View>
  );
}

/** A glyph in a row's leading slot, the width of a face so titles line up. */
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

/** The on/off switch of a routine. */
export function Switch({ on, label, onPress, testID }: { on: boolean; label: string; onPress: () => void; testID?: string }): ReactElement {
  return (
    <Pressable role="switch" aria-label={label} aria-checked={on} onPress={onPress} testID={testID} style={[s.switchTrack, on && s.switchOn]}>
      <View style={[s.switchKnob, on && s.switchKnobOn]} />
    </Pressable>
  );
}

/** A small text button in a section: "Wake", "Give back", "Run now". `primary` is the one filled action. */
export function TextButton({ label, onPress, primary = false, disabled = false, testID }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean; testID?: string }): ReactElement {
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

/** The quiet line at the foot of the pane, with Undo where the change can be taken back. */
export function Notice({ text, onUndo, onClose }: { text: string; onUndo?: () => void; onClose: () => void }): ReactElement {
  return (
    <View testID="pane-notice" accessibilityRole="alert" style={s.notice}>
      <Text numberOfLines={2} style={s.noticeText}>{text}</Text>
      {onUndo ? <TextButton label="Undo" onPress={onUndo} testID="notice-undo" /> : null}
      <Tool icon="x" label="Dismiss" onPress={onClose} testID="notice-close" />
    </View>
  );
}

/* ---------- the list ---------- */

export type Entry =
  | { key: string; type: "label"; text: string; right?: string }
  | { key: string; type: "row"; title: string; note?: string; leading?: ReactNode; trailing?: ReactNode | ((over: boolean) => ReactNode); onPress?: () => void; menu?: MenuEntry[]; selected?: boolean; testID?: string }
  | { key: string; type: "block"; node: ReactElement }
  | { key: string; type: "empty"; text: string; testID?: string };

/** A row that shows its hover tools: the pointer state lives here, so the Row stays a plain ui/Row. */
function Hot({ children }: { children: (over: boolean) => ReactElement }): ReactElement {
  const [over, setOver] = useState(false);
  return <View {...{ onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false) }}>{children(over)}</View>;
}

export function PaneList({ entries, window, testID }: { entries: readonly Entry[]; window?: VirtualWindow; testID?: string }): ReactElement {
  const menu = useMenu();
  const render = (e: Entry): ReactElement => {
    switch (e.type) {
      case "label": return (
        <View testID={`label-${e.key}`} style={s.label}>
          <Text accessibilityRole="header" style={s.labelText}>{e.text}</Text>
          {e.right ? <Text style={s.labelRight}>{e.right}</Text> : null}
        </View>
      );
      case "empty": return <View testID={e.testID ?? `empty-${e.key}`} style={s.empty}><Text style={s.emptyText}>{e.text}</Text></View>;
      case "block": return e.node;
      case "row": {
        const row = (over: boolean): ReactElement => (
          <Row
            id={e.testID ?? e.key} title={e.title} {...(e.note ? { note: e.note } : {})} selected={e.selected === true}
            {...(e.onPress ? { onPress: e.onPress } : {})}
            {...(e.leading ? { leading: e.leading } : {})}
            {...(e.trailing ? { trailing: typeof e.trailing === "function" ? e.trailing(over) : e.trailing } : {})}
          />
        );
        const menuItems = e.menu;
        const body = <Hot>{row}</Hot>;
        return menuItems && menuItems.length > 0
          ? <View {...menuTrigger((x, y) => menu.show(menuItems, x, y, "context", { label: e.title }))}>{body}</View>
          : body;
      }
    }
  };
  return (
    <View testID={testID ?? "pane-list"} style={s.list}>
      <VirtualList data={entries} rowHeight="measure" keyOf={(e) => e.key} renderItem={render} {...(window ? { window } : {})} />
      {menu.element}
    </View>
  );
}

export const s = StyleSheet.create({
  pulse: { position: "absolute", left: -3, top: -3, borderWidth: 1.5, borderColor: "var(--accent)" as string, opacity: 0.55 },
  lead: { width: 18, height: 18, alignItems: "center", justifyContent: "center" },
  tool: { width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  toolOver: { backgroundColor: "var(--press)" as string },
  switchTrack: { width: 28, height: 16, borderRadius: 8, backgroundColor: "var(--line-2)" as string, justifyContent: "center", paddingHorizontal: 2 },
  switchOn: { backgroundColor: "var(--accent)" as string },
  switchKnob: { width: 12, height: 12, borderRadius: 6, backgroundColor: "var(--win)" as string },
  switchKnobOn: { alignSelf: "flex-end" },
  btn: { height: 26, paddingHorizontal: 10, borderRadius: 7, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  btnOver: { backgroundColor: "var(--hover)" as string },
  btnPrimary: { backgroundColor: "var(--accent)" as string },
  btnText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink)" as string },
  btnTextPrimary: { color: "var(--accent-ink)" as string },
  list: { flex: 1, minHeight: 0 },
  label: { minHeight: 30, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 8, paddingTop: 12, paddingBottom: 4 },
  labelText: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  labelRight: { fontSize: 11.5, color: "var(--ink-4)" as string },
  empty: { minHeight: 28, justifyContent: "center", paddingHorizontal: 8, paddingVertical: 4 },
  emptyText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  notice: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingLeft: 12, paddingRight: 6, borderTopWidth: 1, borderTopColor: "var(--line)" as string, backgroundColor: "var(--raised)" as string },
  noticeText: { flex: 1, fontSize: 12.5, color: "var(--ink-2)" as string },
});
