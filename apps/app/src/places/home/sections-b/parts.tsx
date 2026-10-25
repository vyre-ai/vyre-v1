// Shared pieces of Home sections B: the icons for starred things, and ListRow, the one row every section here draws. ListRow is ui/Row with its leading and trailing
// slots (ruling 36); it adds only the right-click menu, the hover tools, the arrow keys across sections and Delete. Hover and selection paint the whole row.
import { createElement, useCallback, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { menuTrigger } from "../../../../../../ui/src/Menu/index.tsx";
import { MoreButton } from "../sections-a/parts.tsx";
import { useSelection } from "../sections-a/data.tsx";
import type { StarIcon } from "./model.ts";

/** 16 px viewBox stroke icons for the kinds of starred thing, in the same hand as sections A. */
const PATHS: Record<StarIcon | "plus" | "up" | "check" | "lock", readonly string[]> = {
  terminal: ["M2.5 4.5a2 2 0 012-2h7a2 2 0 012 2v7a2 2 0 01-2 2h-7a2 2 0 01-2-2z", "M5 6.5l2 1.5-2 1.5M8.500 10h2.500"],
  chat: ["M3 4.5A2 2 0 015 2.5h6a2 2 0 012 2v4.5a2 2 0 01-2 2H7l-3 2.5V11a2 2 0 01-1-1.7z"],
  file: ["M4 2.5h5l3 3v7a1 1 0 01-1 1H4a1 1 0 01-1-1v-9a1 1 0 011-1z", "M9 2.500v3h3"],
  record: ["M3.2 4.5v7c0 1.1 2.1 2 4.8 2s4.8-.9 4.8-2v-7", "M3.2 8c0 1.1 2.1 2 4.8 2s4.8-.9 4.8-2", "M12.8 4.5c0 1.1-2.1 2-4.8 2s-4.8-.9-4.8-2 2.1-2 4.8-2 4.8.9 4.8 2z"],
  run: ["M3 8a5 5 0 109.5-2.2M13 2.5v3h-3"],
  calendar: ["M3 4.500a1.500 1.500 0 011.500-1.500h7A1.500 1.500 0 0113 4.500v7a1.500 1.500 0 01-1.500 1.500h-7A1.500 1.500 0 013 11.500z", "M3 6.500h10M5.500 2v2M10.500 2v2"],
  person: ["M10.5 5.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z", "M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"],
  star: ["M8 2.200l1.800 3.700 4 .6-2.900 2.800.7 4L8 11.400 4.400 13.300l.7-4L2.200 6.500l4-.6z"],
  plus: ["M8 3.500v9M3.500 8h9"],
  up: ["M8 13V3.500M4 7.500l4-4 4 4"],
  check: ["M3 8.500l3 3 7-7"],
  lock: ["M4.500 7.500h7v5h-7z", "M6 7.500V5.500a2 2 0 014 0v2"],
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 15, color = "var(--ink-3)", width = 1.4 }: { name: IconName; size?: number; color?: string; width?: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const paths: ReactElement[] = [];
  for (const d of PATHS[name]) paths.push(createElement("path", { key: d, d, fill: "none" }));
  return createElement("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: width, strokeLinecap: "round", strokeLinejoin: "round" } }, ...paths);
}

const webProps = (props: Record<string, unknown>): Record<string, unknown> => (Platform.OS === "web" ? props : {});

export interface ListRowProps {
  /** unique across the page: "today:evt_1", "star:terminal:trm_1" */
  rowKey: string;
  title: string;
  note?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Click, Enter and Space. */
  onOpen: () => void;
  /** Right-click, the Menu key and the ... button. */
  onMenu?: (x: number, y: number) => void;
  /** Delete and Backspace. */
  onRemove?: () => void;
  label?: string;
}

/** A ui/Row for Home: whole-row hover and selection, the ... button on hover, selection or focus, arrow keys that cross sections. */
export function ListRow({ rowKey, title, note, leading, trailing, onOpen, onMenu, onRemove, label }: ListRowProps): ReactElement {
  const sel = useSelection();
  const [over, setOver] = useState(false);
  const selected = sel.selected === rowKey;
  const trig = onMenu ? menuTrigger(onMenu) : {};
  const trigKey = (trig as { onKeyDown?: (e: unknown) => void }).onKeyDown;
  const keys = (e: { key?: string; preventDefault?: () => void }): void => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault?.(); sel.move(e.key === "ArrowDown" ? 1 : -1, rowKey); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && onRemove) { e.preventDefault?.(); onRemove(); return; }
    trigKey?.(e);
  };
  const focusRef = useCallback((el: unknown) => {
    sel.focusRef(rowKey, el ? { focus: () => (el as { querySelector?: (q: string) => { focus?: () => void } | null }).querySelector?.('[role="button"]')?.focus?.() } : null);
  }, [sel, rowKey]);
  const tools = onMenu ? <MoreButton inline visible={over || selected} label={`More for ${label ?? title}`} onOpen={onMenu} /> : null;
  return (
    <View
      ref={focusRef as never}
      style={s.wrap}
      testID={`wrap-${rowKey}`}
      {...trig}
      {...webProps({ onMouseEnter: () => setOver(true), onMouseLeave: () => setOver(false), onKeyDown: keys })}
    >
      <Row
        id={rowKey}
        title={title}
        {...(note ? { note } : {})}
        selected={selected}
        hovered={over}
        {...(leading ? { leading } : {})}
        trailing={<View style={s.trail}>{trailing}{tools}</View>}
        onPress={() => { sel.select(rowKey); onOpen(); }}
      />
    </View>
  );
}

/** A small text button in the accent wash, as the prototype's Go and Join buttons. */
export function GoButton({ label, onPress, testID, disabled = false }: { label: string; onPress: () => void; testID?: string; disabled?: boolean }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} testID={testID}
      onPress={onPress} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
      style={[s.go, over && s.goOver, disabled && s.goOff]}
    >
      <Text style={s.goText}>{label}</Text>
    </Pressable>
  );
}

/** Quick start: an icon and a word, quiet until hovered. */
export function QuickButton({ label, icon, onPress, testID }: { label: string; icon: IconName; onPress: () => void; testID?: string }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)} testID={testID} style={[s.qs, over && s.qsOver]}>
      <Icon name={icon} size={14} />
      <Text style={[s.qsText, over && s.qsTextOver]}>{label}</Text>
    </Pressable>
  );
}

export const s = StyleSheet.create({
  wrap: { marginHorizontal: -8 },
  trail: { flexDirection: "row", alignItems: "center", gap: 6 },
  go: { height: 26, paddingHorizontal: 12, borderRadius: 7, justifyContent: "center", backgroundColor: "var(--accent-wash)" as string },
  goOver: { opacity: 0.85 },
  goOff: { opacity: 0.5 },
  goText: { color: "var(--accent)" as string, fontSize: 12.5, fontWeight: "500" },
  qs: { height: 26, paddingHorizontal: 9, borderRadius: 7, flexDirection: "row", alignItems: "center", gap: 7 },
  qsOver: { backgroundColor: "var(--hover)" as string },
  qsText: { color: "var(--ink-2)" as string, fontSize: 12.5, fontWeight: "500" },
  qsTextOver: { color: "var(--ink)" as string },
});
