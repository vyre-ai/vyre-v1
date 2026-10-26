// ui/TabStrip: one strip for main tabs and for the side pane (spec 3.0, 4.7). Content is a tab, never a bespoke header.
// Click selects, middle-click or the x closes, right-click and the options button open the tab menu (built by ui/Menu,
// which appends Report a problem), drag or Alt-Arrow reorders, arrows move between tabs. The pane toggle is not part of
// this strip: the pane header puts it at the far left, before the strip.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ViewStyle } from "react-native";
import { MenuIcon, menuTrigger, useMenu } from "../Menu/index.tsx";
import type { MenuEntry } from "../Menu/index.tsx";
import { activeTab } from "./props.ts";
import type { TabSpec, TabStripProps } from "./props.ts";

export type { TabSpec, TabStripProps } from "./props.ts";
export { activeTab } from "./props.ts";

/* ---------- pure logic (tested without a renderer) ---------- */

/** An extra entry for the tab menu. The frozen prop is label and icon; onSelect, danger and checked are read when present. */
export interface TabMenuExtra {
  label: string;
  icon?: string;
  onSelect?: () => void;
  danger?: boolean;
  checked?: boolean;
}

export type TabOp = "close" | "closeOthers" | "closeAll";

/** Moves `from` to the index `to` has now. Pinned tabs never move and nothing moves in front of them. */
export function reorderKeys(tabs: readonly TabSpec[], from: string, to: string): string[] {
  const keys: string[] = [];
  for (const tab of tabs) keys.push(tab.key);
  const a = keys.indexOf(from);
  const b = keys.indexOf(to);
  if (a < 0 || b < 0 || a === b) return keys;
  if (tabs[a]?.pinned === true || tabs[b]?.pinned === true) return keys;
  keys.splice(a, 1);
  keys.splice(b, 0, from);
  return keys;
}

/** The tab one step left or right of `key`, or the last or first one. Does not wrap. */
export function stepKey(tabs: readonly TabSpec[], key: string, step: "left" | "right" | "first" | "last"): string | undefined {
  const at = tabs.findIndex((tab) => tab.key === key);
  if (tabs.length === 0) return undefined;
  if (step === "first") return tabs[0]?.key;
  if (step === "last") return tabs[tabs.length - 1]?.key;
  if (at < 0) return tabs[0]?.key;
  const next = step === "left" ? at - 1 : at + 1;
  return tabs[next]?.key;
}

/** Which key is active after `closed` goes away: the neighbour to the right, else to the left. */
export function afterClose(tabs: readonly TabSpec[], closed: string, active: string): string | undefined {
  if (closed !== active) return active;
  const at = tabs.findIndex((tab) => tab.key === closed);
  return tabs[at + 1]?.key ?? tabs[at - 1]?.key;
}

/** Keys the "close others" and "close all" commands remove. Pinned tabs stay. */
export function closableKeys(tabs: readonly TabSpec[], op: TabOp, key: string | undefined): string[] {
  const out: string[] = [];
  for (const tab of tabs) {
    if (tab.pinned === true) continue;
    if (op === "closeOthers" && tab.key === key) continue;
    if (op === "close" && tab.key !== key) continue;
    out.push(tab.key);
  }
  return out;
}

/**
 * The standard tab menu: the caller's extras, then Close Tab (not for a pinned tab), Close Other Tabs, Close All Tabs.
 * ui/Menu appends Report a problem. Icons are all or none: one extra without an icon drops them from the whole menu.
 */
export function tabMenuEntries(
  tabs: readonly TabSpec[],
  key: string | undefined,
  extras: readonly TabMenuExtra[],
  run: (op: TabOp, key: string | undefined) => void,
): MenuEntry[] {
  const tab = key === undefined ? undefined : tabs.find((t) => t.key === key);
  const std: { label: string; icon: string; op: TabOp }[] = [];
  if (tab !== undefined && tab.pinned !== true) std.push({ label: "Close Tab", icon: "x", op: "close" });
  std.push({ label: "Close Other Tabs", icon: "minus", op: "closeOthers" });
  std.push({ label: "Close All Tabs", icon: "x", op: "closeAll" });
  let icons = true;
  for (const extra of extras) if (extra.icon === undefined || extra.icon.length === 0) icons = false;
  const out: MenuEntry[] = [];
  for (const extra of extras) {
    out.push({
      label: extra.label,
      ...(icons && extra.icon !== undefined ? { icon: extra.icon } : {}),
      ...(extra.onSelect === undefined ? {} : { onSelect: extra.onSelect }),
      ...(extra.danger === true ? { danger: true } : {}),
      ...(extra.checked === true ? { checked: true } : {}),
    });
  }
  if (extras.length > 0) out.push({ separator: true });
  for (const item of std) out.push({ label: item.label, ...(icons ? { icon: item.icon } : {}), onSelect: () => run(item.op, key) });
  return out;
}

/* ---------- web-only props without a ts-ignore ---------- */

interface EventLike {
  key?: string;
  button?: number;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
  nativeEvent?: { pageX?: number; pageY?: number };
}

interface Focusable {
  focus?: (options?: { preventScroll?: boolean }) => void;
  measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
}

function webProps(props: Record<string, unknown>): Record<string, unknown> {
  return Platform.OS === "web" ? props : {};
}

function focusNode(node: unknown): void {
  if (Platform.OS !== "web" || node === null || typeof node !== "object") return;
  const focusable = node as Focusable;
  if (typeof focusable.focus === "function") focusable.focus({ preventScroll: true });
}

/* ---------- the strip ---------- */

export const TAB_STRIP_HEIGHT = 38;
export const TAB_HEIGHT = 32;
const TAB_MAX_WIDTH = 210;

export interface TabStripViewProps extends TabStripProps {
  /** Accessible name for the strip. */
  label?: string;
  /** Pinned tabs with 7 px padding instead of 10: a narrow side pane that has to fit four tabs (the prototype's agent pane). */
  tight?: boolean;
}

export function TabStrip(props: TabStripViewProps): ReactElement {
  const { tabs, active, onSelect, onClose, onReorder, menu, onPlus, plusTitle } = props;
  const { element, show } = useMenu();
  const nodes = useRef<Record<string, unknown>>({});
  const moreNode = useRef<unknown>(null);
  const scroller = useRef<{ scrollTo?: (options: { x: number; animated: boolean }) => void } | null>(null);
  const spans = useRef<Record<string, { x: number; w: number }>>({});
  const view = useRef<{ x: number; w: number }>({ x: 0, w: 0 });
  const [drag, setDrag] = useState<{ from: string; over: string | null } | null>(null);

  const extrasFor = useCallback((key: string | undefined): TabMenuExtra[] => {
    if (menu === undefined || key === undefined) return [];
    const got: readonly TabMenuExtra[] = menu(key);
    return got.slice();
  }, [menu]);

  const run = useCallback((op: TabOp, key: string | undefined) => {
    if (onClose === undefined) return;
    for (const k of closableKeys(tabs, op, key)) onClose(k);
  }, [tabs, onClose]);

  const openFor = useCallback((key: string | undefined, x: number, y: number) => {
    show(tabMenuEntries(tabs, key, extrasFor(key), run), x, y, "context", { label: key === undefined ? "Tabs" : (tabs.find((t) => t.key === key)?.title ?? key) });
  }, [tabs, extrasFor, run, show]);

  const select = useCallback((key: string) => {
    if (onSelect) onSelect(key);
    focusNode(nodes.current[key]);
  }, [onSelect]);

  useEffect(() => {
    const span = spans.current[active];
    const box = scroller.current;
    if (span === undefined || box === null || typeof box.scrollTo !== "function") return;
    if (span.x < view.current.x) box.scrollTo({ x: Math.max(0, span.x - 8), animated: false });
    else if (span.x + span.w > view.current.x + view.current.w && view.current.w > 0) box.scrollTo({ x: span.x + span.w - view.current.w + 8, animated: false });
  }, [active, tabs.length]);

  const onKeyDown = (key: string, event: EventLike): void => {
    const k = event.key ?? "";
    const tab = tabs.find((t) => t.key === key);
    if (event.altKey === true && (k === "ArrowLeft" || k === "ArrowRight") && onReorder) {
      const to = stepKey(tabs, key, k === "ArrowLeft" ? "left" : "right");
      if (to !== undefined) {
        event.preventDefault?.();
        onReorder(reorderKeys(tabs, key, to));
      }
      return;
    }
    const step = k === "ArrowLeft" ? "left" : k === "ArrowRight" ? "right" : k === "Home" ? "first" : k === "End" ? "last" : null;
    if (step !== null) {
      const to = stepKey(tabs, key, step);
      event.preventDefault?.();
      if (to !== undefined && to !== key) select(to);
      return;
    }
    const closing = k === "Delete" || k === "Backspace" || ((event.metaKey === true || event.ctrlKey === true) && k.toLowerCase() === "w");
    if (closing && tab !== undefined && tab.pinned !== true && onClose) {
      event.preventDefault?.();
      const to = afterClose(tabs, key, active);
      onClose(key);
      if (to !== undefined) focusNode(nodes.current[to]);
    }
  };

  const finishDrag = (): void => {
    if (drag !== null && drag.over !== null && drag.over !== drag.from && onReorder) onReorder(reorderKeys(tabs, drag.from, drag.over));
    setDrag(null);
  };

  const tabNodes: ReactNode[] = [];
  for (const tab of tabs) {
    const on = tab.key === active;
    tabNodes.push(
      <TabItem
        key={tab.key}
        tab={tab}
        on={on}
        tight={props.tight === true}
        dropTarget={drag !== null && drag.over === tab.key && drag.from !== tab.key}
        canClose={onClose !== undefined}
        nodeRef={(node) => { nodes.current[tab.key] = node; }}
        onPress={() => select(tab.key)}
        onClose={() => {
          const to = afterClose(tabs, tab.key, active);
          if (onClose) onClose(tab.key);
          if (to !== undefined) focusNode(nodes.current[to]);
        }}
        trigger={menuTrigger((x, y) => openFor(tab.key, x, y))}
        onKeyDown={(event) => onKeyDown(tab.key, event)}
        onDragStart={() => { if (tab.pinned !== true && onReorder) setDrag({ from: tab.key, over: null }); }}
        onDragOver={() => { if (drag !== null && drag.over !== tab.key) setDrag({ from: drag.from, over: tab.key }); }}
        onDragEnd={finishDrag}
        onLayout={(x, w) => { spans.current[tab.key] = { x, w }; }}
      />,
    );
  }

  const current = activeTab(props);
  return (
    <View style={styles.strip} testID="tab-strip" {...webProps({ onPointerLeave: () => setDrag(null), onPointerUp: finishDrag })}>
      <ScrollView
        ref={(node) => { scroller.current = node as unknown as typeof scroller.current; }}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onScroll={(event) => { view.current = { x: event.nativeEvent.contentOffset.x, w: event.nativeEvent.layoutMeasurement.width }; }}
        scrollEventThrottle={64}
        onLayout={(event) => { view.current = { x: view.current.x, w: event.nativeEvent.layout.width }; }}
      >
        <View role="tablist" aria-label={props.label ?? current?.title ?? "Tabs"} style={styles.tabs}>
          {tabNodes}
        </View>
        {onPlus === undefined ? null : (
          <IconButton name="plus" label={plusTitle ?? "Open"} onPress={() => onPlus()} />
        )}
        <View style={styles.spacer} />
        <IconButton
          name="more"
          label="Tab options"
          nodeRef={(node) => { moreNode.current = node; }}
          onPress={() => {
            const box = moreNode.current as Focusable | null;
            if (box !== null && typeof box.measureInWindow === "function") box.measureInWindow((x, y, w, h) => openFor(active, x + w - 230, y + h + 4));
            else openFor(active, 0, TAB_STRIP_HEIGHT);
          }}
        />
      </ScrollView>
      {element}
    </View>
  );
}

function IconButton({ name, label, onPress: press, nodeRef }: { name: string; label: string; onPress: () => void; nodeRef?: (node: unknown) => void }): ReactElement {
  const [over, setOver] = useState(false);
  return (
    <Pressable
      ref={nodeRef}
      role="button"
      aria-label={label}
      testID={`tab-strip-${name}`}
      onPress={press}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      style={[styles.iconButton, over ? HOVER : null]}
      {...webProps({ title: label })}
    >
      <MenuIcon icon={name} color={over ? "var(--ink)" : "var(--ink-3)"} size={16} />
    </Pressable>
  );
}

function TabItem({ tab, on, tight, dropTarget, canClose, nodeRef, onPress: press, onClose, trigger, onKeyDown, onDragStart, onDragOver, onDragEnd, onLayout }: {
  tab: TabSpec;
  on: boolean;
  tight: boolean;
  dropTarget: boolean;
  canClose: boolean;
  nodeRef: (node: unknown) => void;
  onPress: () => void;
  onClose: () => void;
  trigger: Record<string, unknown>;
  onKeyDown: (event: EventLike) => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
  onLayout: (x: number, w: number) => void;
}): ReactElement {
  const [over, setOver] = useState(false);
  const pinned = tab.pinned === true;
  const ink = on ? "var(--ink)" : over ? "var(--ink-2)" : "var(--ink-3)";
  const extraTab = tab as TabSpec & { lead?: ReactNode; iconOnly?: boolean; label?: string };
  const name = extraTab.label ?? tab.title;
  const showClose = !pinned && canClose && (over || on);
  return (
    <Pressable
      ref={nodeRef}
      role="tab"
      aria-selected={on}
      aria-label={name}
      testID={on ? `tab-${tab.key}-selected` : `tab-${tab.key}`}
      onPress={press}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      onLayout={(event) => onLayout(event.nativeEvent.layout.x, event.nativeEvent.layout.width)}
      style={[styles.tab, pinned ? styles.tabPinned : null, pinned && tight ? styles.tabTight : null, over && !on ? HOVER : null, on ? ACTIVE : null, dropTarget ? DROP : null]}
      {...trigger}
      {...webProps({
        title: name,
        tabIndex: on ? 0 : -1,
        onKeyDown: (event: EventLike) => { onKeyDown(event); (trigger["onKeyDown"] as ((e: unknown) => void) | undefined)?.(event); },
        onPointerDown: (event: EventLike) => { if (event.button === undefined || event.button === 0) onDragStart(); },
        onPointerEnter: onDragOver,
        onPointerUp: onDragEnd,
        onAuxClick: (event: EventLike) => {
          if (event.button === 1 && !pinned && canClose) {
            event.preventDefault?.();
            onClose();
          }
        },
      })}
    >
      {extraTab.lead !== undefined ? extraTab.lead : null}
      {tab.icon !== undefined && tab.icon.length > 0 ? <MenuIcon icon={tab.icon} color={ink} size={14} /> : null}
      {extraTab.iconOnly === true ? null : <Text numberOfLines={1} style={[styles.title, { color: ink }]}>{tab.title}</Text>}
      {pinned ? null : (
        <Pressable
          role="button"
          aria-label={`Close ${tab.title}`}
          focusable={false}
          testID={`tab-close-${tab.key}`}
          onPress={onClose}
          style={[styles.close, showClose ? null : HIDDEN]}
          {...webProps({ title: "Close" })}
        >
          <MenuIcon icon="x" color={ink} size={12} />
        </Pressable>
      )}
    </Pressable>
  );
}

// Plain objects (not StyleSheet ids) so the painted token is visible in the element's inline style.
const HOVER = { backgroundColor: "var(--hover)" };
const ACTIVE = { backgroundColor: "var(--win)", borderColor: "var(--line)" };
const DROP = { boxShadow: "inset 2px 0 0 var(--accent)" } as unknown as ViewStyle;
const HIDDEN = { opacity: 0 };

const styles = StyleSheet.create({
  strip: { height: TAB_STRIP_HEIGHT, flexDirection: "row", backgroundColor: "var(--side)" as string, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  scroll: { flex: 1 },
  content: { flexGrow: 1, alignItems: "flex-end", paddingHorizontal: 6, gap: 2 },
  tabs: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  spacer: { flexGrow: 1 },
  tab: {
    height: TAB_HEIGHT,
    maxWidth: TAB_MAX_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingLeft: 10,
    paddingRight: 6,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: "transparent",
  },
  tabPinned: { paddingRight: 10 },
  tabTight: { paddingLeft: 7, paddingRight: 7 },
  title: { flexShrink: 1, fontSize: 12.5, lineHeight: 16 },
  close: { width: 18, height: 18, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  iconButton: { width: 26, height: 26, marginBottom: 4, borderRadius: 7, alignItems: "center", justifyContent: "center" },
});
