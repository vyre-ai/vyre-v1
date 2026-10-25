// ui/Menu: the one menu (spec 3.0, ARCH 7.14, D51). Every menu in the app is built here.
// Report a problem is appended here to every context, help and shortcut menu and never by a caller.
// Icons are all or none: when any actionable item lacks one, the appended item carries none either.
// Colours are skin tokens (CSS variables on web), so a skin switch repaints with no re-render.
// Keyboard: arrows, Home, End, type-ahead, Enter or Space to choose, Escape to close. Hover moves the highlight.

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { isHead, isItem, isReportItem, isSeparator, resolveMenuItems } from "./props.ts";
import type { MenuEntry, MenuItem, MenuProps, MenuSource } from "./props.ts";
import { MenuPortal } from "./portal.tsx";

export type { MenuEntry, MenuHead, MenuItem, MenuProps, MenuSeparator, MenuSource } from "./props.ts";
export { REPORT_A_PROBLEM, appendReportProblem, resolveMenuItems } from "./props.ts";

/* ---------- Report a problem hook-up ---------- */

/** What was right-clicked, for the report sheet (P-L9_16 shows it). */
export interface ReportContext {
  label?: string;
}

type ReportHandler = (context: ReportContext) => void;

let reportHandler: ReportHandler | null = null;

/** The shell registers the sheet opener once. Returns a function that removes it. */
export function setReportProblemHandler(handler: ReportHandler | null): () => void {
  reportHandler = handler;
  return () => {
    if (reportHandler === handler) reportHandler = null;
  };
}

/** Opens the report sheet. Menus, the Help menu and Cmd-Shift-/ all end up here. */
export function reportProblem(context: ReportContext = {}): void {
  if (reportHandler) reportHandler(context);
}

/* ---------- pure menu logic (tested without a renderer) ---------- */

/** Menu entries with Report a problem appended (unless the source says leave alone) and wired to the sheet. */
export function menuEntries(props: MenuProps, context: ReportContext = {}): MenuEntry[] {
  const resolved = resolveMenuItems(props);
  const out: MenuEntry[] = [];
  for (const entry of resolved) {
    if (isReportItem(entry) && isItem(entry) && entry.onSelect === undefined) {
      out.push({ ...entry, onSelect: () => reportProblem(context) });
    } else {
      out.push(entry);
    }
  }
  return out;
}

/** Indices of the entries a person can land on. */
export function selectableIndices(entries: readonly MenuEntry[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry !== undefined && isItem(entry)) out.push(i);
  }
  return out;
}

export type NavKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/** Next highlighted index for an arrow key. Wraps. `from` is -1 when nothing is highlighted. */
export function moveActive(entries: readonly MenuEntry[], from: number, key: NavKey): number {
  const list = selectableIndices(entries);
  if (list.length === 0) return -1;
  if (key === "Home") return list[0] ?? -1;
  if (key === "End") return list[list.length - 1] ?? -1;
  const at = list.indexOf(from);
  if (key === "ArrowDown") return list[at < 0 ? 0 : (at + 1) % list.length] ?? -1;
  return list[at < 0 ? list.length - 1 : (at - 1 + list.length) % list.length] ?? -1;
}

/** Type-ahead: the next item after `from` whose label starts with the typed text. `inclusive` also tests `from` (typing more letters). */
export function typeAhead(entries: readonly MenuEntry[], from: number, typed: string, inclusive = false): number {
  const needle = typed.toLowerCase();
  if (needle.length === 0) return -1;
  const list = selectableIndices(entries);
  const at = list.indexOf(from);
  const start = at < 0 ? 0 : inclusive ? at : at + 1;
  for (let step = 0; step < list.length; step++) {
    const index = list[(start + step) % list.length];
    const entry = index === undefined ? undefined : entries[index];
    if (entry !== undefined && isItem(entry) && entry.label.toLowerCase().startsWith(needle)) return index ?? -1;
  }
  return -1;
}

/** Keeps the whole menu inside the window with a small margin, like a native menu. */
export function clampMenu(x: number, y: number, width: number, height: number, viewW: number, viewH: number, margin = 6): { left: number; top: number } {
  const left = Math.max(margin, Math.min(x, viewW - width - margin));
  const top = Math.max(margin, Math.min(y, viewH - height - margin));
  return { left, top };
}

/** True when every actionable item has an icon, or none does (D51). */
export function iconsAllOrNone(entries: readonly MenuEntry[]): boolean {
  let withIcon = 0;
  let total = 0;
  for (const entry of entries) {
    if (!isItem(entry)) continue;
    total += 1;
    if (typeof entry.icon === "string" && entry.icon.length > 0) withIcon += 1;
  }
  return withIcon === 0 || withIcon === total;
}

/** A Kit screen menu entry (KitScreenDef.menus[].items) as menu items. `run` receives the action key. */
export interface KitMenuItem {
  label: string;
  icon: string;
  action: string;
  keys?: string;
  when?: string;
}

export function kitMenuEntries(items: readonly KitMenuItem[], run: (action: string) => void, visible: (when: string) => boolean = () => true): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const item of items) {
    if (item.when !== undefined && !visible(item.when)) continue;
    out.push({ label: item.label, icon: item.icon, onSelect: () => run(item.action) });
  }
  return out;
}

/* ---------- icons ---------- */

const ICON_PATHS: Readonly<Record<string, string>> = {
  flag: '<path d="M4 13.5V2.5M4 3h7.5l-1.6 2.6L11.5 8.2H4"/>',
  x: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  minus: '<path d="M3.5 8h9"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  copy: '<rect x="5" y="5" width="8.500" height="8.500" rx="1.600"/><path d="M3.500 10.500V4A1.500 1.500 0 015 2.500h6.500"/>',
  star: '<path d="M8 2l1.800 3.700 4 .6-2.900 2.800.7 4L8 11.200 4.400 13.100l.7-4L2.200 6.300l4-.6z"/>',
  pane: '<rect x="2" y="3" width="12" height="10" rx="1.800"/><path d="M10 3v10"/>',
  trash: '<path d="M3 4.500h10M6.500 4.500V3h3v1.500M4.500 4.500l.6 8.500h5.800l.6-8.500"/>',
  edit: '<path d="M3 13h3l7-7-3-3-7 7zM9 4l3 3"/>',
  open: '<path d="M6.500 3.500H3.500v9h9v-3M9 3.500h3.500V7M12.500 3.500L7 9"/>',
  link: '<path d="M6.500 9.500l3-3M7 4.500l.8-.8a2.500 2.500 0 013.500 3.500l-.8.800M9 11.500l-.8.800a2.500 2.500 0 01-3.500-3.500l.8-.8"/>',
  clock: '<circle cx="8" cy="8" r="5.500"/><path d="M8 5v3.200l2 1.300"/>',
  eye: '<path d="M1.500 8S4 3.500 8 3.500 14.500 8 14.500 8 12 12.500 8 12.500 1.500 8 1.500 8z"/><circle cx="8" cy="8" r="2"/>',
  search: '<circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/>',
  more: '<circle cx="3.5" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.5" cy="8" r=".9" fill="currentColor"/>',
};

/** Native has no inline svg here; a glyph character keeps the icon readable until a native icon set lands. */
const NATIVE_GLYPHS: Readonly<Record<string, string>> = {
  flag: "\u2691",
  x: "\u00d7",
  plus: "+",
  minus: "\u2212",
  check: "\u2713",
  more: "\u22ef",
  star: "\u2606",
  pane: "\u25eb",
};

export function iconNames(): string[] {
  return Object.keys(ICON_PATHS);
}

const ICON_SIZE = 15;

/** An icon: a name from the built-in set or an svg string. Web draws inline svg; native draws a glyph character. */
export function MenuIcon({ icon, color, size = ICON_SIZE }: { icon: string; color?: string; size?: number }): ReactElement {
  const box = { width: size, height: size };
  if (Platform.OS !== "web") {
    const glyph = NATIVE_GLYPHS[icon];
    return (
      <View style={[styles.iconSlot, box]}>
        {glyph === undefined ? null : <Text style={{ color: color ?? "var(--ink-3)", fontSize: size, lineHeight: size }}>{glyph}</Text>}
      </View>
    );
  }
  const named = ICON_PATHS[icon];
  const markup = named !== undefined
    ? `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${named}</svg>`
    : icon.trimStart().startsWith("<svg") ? icon : "";
  return (
    <View style={[styles.iconSlot, box]} aria-hidden>
      {markup === "" ? null : createElement("span", { style: { display: "inline-flex", color: color ?? "inherit" }, dangerouslySetInnerHTML: { __html: markup } })}
    </View>
  );
}

/* ---------- web-only props without a ts-ignore ---------- */

interface KeyEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

interface Focusable {
  focus?: (options?: { preventScroll?: boolean }) => void;
}

function focusNode(node: unknown): void {
  if (Platform.OS !== "web" || node === null || typeof node !== "object") return;
  const focusable = node as Focusable;
  if (typeof focusable.focus === "function") focusable.focus({ preventScroll: true });
}

/** Props React Native Web forwards to the DOM but React Native's types do not list. */
function webProps(props: Record<string, unknown>): Record<string, unknown> {
  return Platform.OS === "web" ? props : {};
}

const FIXED = (Platform.OS === "web" ? "fixed" : "absolute") as unknown as ViewStyle["position"];

/* ---------- the menu ---------- */

export interface MenuViewProps extends MenuProps {
  /** Called once when the menu closes (a choice, Escape or a press outside). */
  onClose?: () => void;
  /** What was right-clicked, passed to the report sheet. */
  reportContext?: ReportContext;
}

const MENU_W = 220;
const MENU_H = 120;

export function Menu(props: MenuViewProps): ReactElement | null {
  const { onClose, reportContext } = props;
  const entries = useMemo(() => menuEntries(props, reportContext), [props.items, props.source, reportContext]);
  const window = useWindowDimensions();
  const [gone, setGone] = useState(false);
  const [active, setActive] = useState(() => moveActive(entries, -1, "Home"));
  const [size, setSize] = useState<{ w: number; h: number }>({ w: MENU_W, h: MENU_H });
  const nodes = useRef<Record<number, unknown>>({});
  const typed = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  const close = useCallback(() => {
    setGone(true);
    if (onClose) onClose();
  }, [onClose]);

  const land = useCallback((index: number) => {
    if (index < 0) return;
    setActive(index);
    focusNode(nodes.current[index]);
  }, []);

  useEffect(() => {
    land(moveActive(entries, -1, "Home"));
  }, [entries, land]);

  const choose = useCallback((entry: MenuItem) => {
    close();
    if (entry.onSelect) entry.onSelect();
  }, [close]);

  const onKeyDown = (event: KeyEventLike): void => {
    const { key } = event;
    if (key === "Escape") {
      event.preventDefault?.();
      event.stopPropagation?.();
      close();
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
      event.preventDefault?.();
      land(moveActive(entries, active, key));
      return;
    }
    if (key === "Tab") {
      event.preventDefault?.();
      land(moveActive(entries, active, event.shiftKey === true ? "ArrowUp" : "ArrowDown"));
      return;
    }
    if (key.length === 1 && key !== " " && event.metaKey !== true && event.ctrlKey !== true) {
      const now = Date.now();
      const text = now - typed.current.at < 700 ? typed.current.text + key : key;
      typed.current = { text, at: now };
      const hit = typeAhead(entries, active, text, text.length > 1);
      if (hit >= 0) land(hit);
    }
  };

  if (gone) return null;

  const { left, top } = clampMenu(props.x ?? 0, props.y ?? 0, size.w, size.h, window.width, window.height);
  const rows: ReactNode[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry === undefined) continue;
    if (isSeparator(entry)) {
      rows.push(<View key={`s${i}`} style={styles.sep} {...webProps({ dataSet: { separator: "true" } })} />);
    } else if (isHead(entry)) {
      rows.push(<Text key={`h${i}`} style={styles.head} role="heading" aria-level={3}>{entry.head}</Text>);
    } else {
      rows.push(
        <MenuRow
          key={`i${i}`}
          entry={entry}
          lit={i === active}
          onHover={() => land(i)}
          onChoose={() => choose(entry)}
          nodeRef={(node) => { nodes.current[i] = node; }}
        />,
      );
    }
  }

  return (
    <MenuPortal>
    <View style={styles.layer} testID="menu-layer" pointerEvents="box-none">
      <Pressable
        accessibilityLabel="Close menu"
        style={styles.backdrop}
        onPress={close}
        {...webProps({ onContextMenu: (event: { preventDefault: () => void }) => { event.preventDefault(); close(); }, tabIndex: -1 })}
      />
      <View
        role="menu"
        aria-label={menuLabel(entries)}
        testID="menu"
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
        }}
        style={[styles.panel, { left, top }]}
        {...webProps({ onKeyDown })}
      >
        {rows}
      </View>
    </View>
    </MenuPortal>
  );
}

function menuLabel(entries: readonly MenuEntry[]): string {
  for (const entry of entries) if (isItem(entry)) return entry.label;
  return "Menu";
}

function MenuRow({ entry, lit, onHover, onChoose, nodeRef }: {
  entry: MenuItem;
  lit: boolean;
  onHover: () => void;
  onChoose: () => void;
  nodeRef: (node: unknown) => void;
}): ReactElement {
  const report = isReportItem(entry);
  // the quiet prototype highlight: the hover wash, the same ink; never a filled accent box
  const ink = entry.danger === true ? "var(--danger)" : "var(--ink)";
  const wash = lit ? { backgroundColor: "var(--hover)" } : null;
  return (
    <Pressable
      ref={nodeRef}
      role="menuitem"
      aria-label={entry.label}
      aria-checked={entry.checked === true ? true : undefined}
      onPress={onChoose}
      onHoverIn={onHover}
      onFocus={onHover}
      testID={report ? "menu-item-report" : `menu-item-${entry.label}`}
      style={[styles.item, wash]}
      {...webProps(report ? { dataSet: { report: "true" } } : {})}
    >
      {entry.icon !== undefined && entry.icon.length > 0 ? <MenuIcon icon={entry.icon} color={ink} /> : null}
      <Text numberOfLines={1} style={[styles.label, { color: ink }]}>{entry.label}</Text>
      {entry.count !== undefined ? <Text style={styles.count} testID={`menu-count-${entry.label}`}>{entry.count}</Text> : null}
      {entry.checked === true ? <Text style={[styles.check, entry.count !== undefined && styles.checkAfterCount, { color: ink }]}>{"✓"}</Text> : null}
    </Pressable>
  );
}

/* ---------- opening a menu from a surface ---------- */

export interface OpenMenu {
  items: readonly MenuEntry[];
  x: number;
  y: number;
  source: MenuSource;
  context?: ReportContext;
  nonce: number;
}

interface PointerLike {
  clientX?: number;
  clientY?: number;
  nativeEvent?: { pageX?: number; pageY?: number };
  preventDefault?: () => void;
}

function pointOf(event: PointerLike): { x: number; y: number } {
  return {
    x: event.clientX ?? event.nativeEvent?.pageX ?? 0,
    y: event.clientY ?? event.nativeEvent?.pageY ?? 0,
  };
}

/** Handlers that open a menu from a surface: right-click on web, long press on a phone, Shift-F10 and the menu key. */
export function menuTrigger(open: (x: number, y: number) => void): Record<string, unknown> {
  const onLongPress = (event: PointerLike): void => {
    const { x, y } = pointOf(event);
    open(x, y);
  };
  if (Platform.OS !== "web") return { onLongPress };
  return {
    onContextMenu: (event: PointerLike): void => {
      event.preventDefault?.();
      const { x, y } = pointOf(event);
      open(x, y);
    },
    onKeyDown: (event: KeyEventLike & { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }): void => {
      if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey === true)) return;
      event.preventDefault?.();
      const box = event.currentTarget?.getBoundingClientRect?.();
      open(box?.left ?? 0, box?.bottom ?? 0);
    },
  };
}

/** One open menu for a surface. `element` goes anywhere in the tree; `show` opens it at a point. */
export function useMenu(): {
  element: ReactElement | null;
  show: (items: readonly MenuEntry[], x: number, y: number, source?: MenuSource, context?: ReportContext) => void;
  hide: () => void;
} {
  const [open, setOpen] = useState<OpenMenu | null>(null);
  const counter = useRef(0);
  const show = useCallback((items: readonly MenuEntry[], x: number, y: number, source: MenuSource = "context", context?: ReportContext) => {
    counter.current += 1;
    setOpen({ items, x, y, source, nonce: counter.current, ...(context === undefined ? {} : { context }) });
  }, []);
  const hide = useCallback(() => setOpen(null), []);
  const element = open === null ? null : (
    <Menu key={open.nonce} items={open.items} x={open.x} y={open.y} source={open.source} onClose={hide} {...(open.context === undefined ? {} : { reportContext: open.context })} />
  );
  return { element, show, hide };
}

/* ---------- styles ---------- */

const styles = StyleSheet.create({
  layer: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, zIndex: 2147483000 },
  backdrop: { position: FIXED, left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "transparent" },
  panel: {
    position: FIXED,
    minWidth: MENU_W,
    maxWidth: 320,
    padding: 5,
    borderRadius: 10,
    backgroundColor: "var(--raised)" as string,
    boxShadow: "var(--sh-pop)" as string,
  },
  // the lit row is the wash; the browser focus ring would draw a black box around it
  item: { flexDirection: "row", alignItems: "center", height: 28, paddingHorizontal: 9, borderRadius: 6, gap: 9, width: "100%", ...({ outlineStyle: "none" } as ViewStyle) },
  label: { flexShrink: 1, fontSize: 13, lineHeight: 18 },
  check: { marginLeft: "auto", fontSize: 12 },
  checkAfterCount: { marginLeft: 0 },
  count: { marginLeft: "auto", minWidth: 24, textAlign: "right", fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  iconSlot: { width: ICON_SIZE, height: ICON_SIZE, alignItems: "center", justifyContent: "center" },
  head: { paddingTop: 6, paddingBottom: 4, paddingHorizontal: 9, fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  sep: { height: 1, backgroundColor: "var(--line)" as string, marginVertical: 4, marginHorizontal: 6 },
});
