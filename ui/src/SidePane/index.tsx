// ui/Pane and ui/SidePane (spec 3.0, D57, ARCH 7). Every pane header has exactly one toggle and it is the far-left child.
// An inner pane's toggle stays hidden while the side pane is open. The side pane is resizable: drag its left edge,
// arrow keys when the edge is focused, double-click to reset. Its width is remembered per pane key.
// The header's tabs are the shared ui/TabStrip: content (Details, History, Ask, Call) is a tab, never a bespoke header.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { PanResponder, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { MenuIcon } from "../Menu/index.tsx";
import { TabStrip } from "../TabStrip/index.tsx";
import type { TabMenuExtra } from "../TabStrip/index.tsx";
import { PANE_HEADER_ORDER, SIDE_PANE_MAX, SIDE_PANE_MIN, paneToggleLabel, sidePaneMax, sidePaneMin } from "./props.ts";
import type { PaneProps, PaneTab, SidePaneProps } from "./props.ts";

export type { PaneProps, PaneTab, PaneToggle, SidePaneProps } from "./props.ts";
export { PANE_HEADER_ORDER, SIDE_PANE_MAX, SIDE_PANE_MIN, paneToggleLabel } from "./props.ts";

/* ---------- width memory ---------- */

/** The slice of Storage the pane needs. localStorage on web; memory elsewhere. */
export interface WidthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DEFAULT_PANE_WIDTH = 340;
const STORE_PREFIX = "vyre-ui:";

export interface PaneWidthStore {
  get(paneKey: string): number | null;
  set(paneKey: string, width: number): void;
  reset(paneKey: string): void;
}

/** Remembers one width per pane key. A storage that throws (private window, blocked data) falls back to memory. */
export function createPaneWidthStore(storage: WidthStorage | null): PaneWidthStore {
  const memory = new Map<string, number>();
  const name = (paneKey: string): string => `${STORE_PREFIX}${paneKey}:w`;
  return {
    get(paneKey) {
      const kept = memory.get(paneKey);
      if (kept !== undefined) return kept;
      if (storage === null) return null;
      try {
        const raw = storage.getItem(name(paneKey));
        const n = raw === null ? NaN : Number.parseFloat(raw);
        return Number.isFinite(n) && n > 0 ? n : null;
      } catch {
        return null;
      }
    },
    set(paneKey, width) {
      memory.set(paneKey, width);
      if (storage === null) return;
      try {
        storage.setItem(name(paneKey), `${width}px`);
      } catch {
        // memory still has it for this session
      }
    },
    reset(paneKey) {
      memory.delete(paneKey);
      if (storage === null) return;
      try {
        storage.removeItem(name(paneKey));
      } catch {
        // nothing to undo
      }
    },
  };
}

function browserStorage(): WidthStorage | null {
  if (Platform.OS !== "web") return null;
  try {
    const host = globalThis as { localStorage?: WidthStorage };
    return host.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The app's store. Tests build their own with createPaneWidthStore. */
export const paneWidths: PaneWidthStore = createPaneWidthStore(browserStorage());

/** Keeps a width between the floor and the cap (a fraction of the window). The floor wins in a narrow window; an unknown window (0) applies only the floor. */
export function clampPaneWidth(width: number, windowWidth: number, min = SIDE_PANE_MIN, maxFraction = SIDE_PANE_MAX): number {
  if (!(windowWidth > 0)) return Math.round(Math.max(min, width));
  const cap = Math.max(min, windowWidth * maxFraction);
  return Math.round(Math.min(Math.max(min, width), cap));
}

/** Arrow keys grow (left) or shrink (right) the pane by a step; Home resets. Returns null for any other key. */
export function widthForKey(current: number, key: string, windowWidth: number, min = SIDE_PANE_MIN, maxFraction = SIDE_PANE_MAX): number | "reset" | null {
  if (key === "ArrowLeft") return clampPaneWidth(current + 24, windowWidth, min, maxFraction);
  if (key === "ArrowRight") return clampPaneWidth(current - 24, windowWidth, min, maxFraction);
  if (key === "Home") return "reset";
  return null;
}

/* ---------- web-only props without a ts-ignore ---------- */

interface KeyEventLike {
  key: string;
  preventDefault?: () => void;
}

function webProps(props: Record<string, unknown>): Record<string, unknown> {
  return Platform.OS === "web" ? props : {};
}

/* ---------- header ---------- */

export const PANE_HEADER_HEIGHT = 38;

/** Props shared by Pane and SidePane beyond the frozen ones: the tab callbacks and the body. */
export interface PaneViewProps extends PaneProps {
  children?: ReactNode;
  onSelectTab?: (key: string) => void;
  onCloseTab?: (key: string) => void;
  onReorderTabs?: (keys: readonly string[]) => void;
  tabMenu?: (key: string) => readonly TabMenuExtra[];
  onPlus?: () => void;
  plusTitle?: string;
  /** Tighter padding on pinned tabs, for a narrow pane that must fit four of them. */
  tight?: boolean;
}

export interface SidePaneViewProps extends SidePaneProps, Omit<PaneViewProps, keyof PaneProps> {
  /** Width used the first time, before the person drags. */
  defaultWidth?: number;
  onWidthChange?: (width: number) => void;
}

/** The one pane toggle. Draws the pane glyph; the label flips between Hide and Show. */
export function PaneToggleButton({ open, onPress, hidden = false }: { open: boolean; onPress?: () => void; hidden?: boolean }): ReactElement {
  const [over, setOver] = useState(false);
  const label = paneToggleLabel(open);
  return (
    <Pressable
      role="button"
      aria-label={label}
      aria-pressed={open}
      aria-hidden={hidden ? true : undefined}
      focusable={!hidden}
      testID="pane-toggle"
      onPress={onPress}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      style={[styles.toggle, over ? HOVER : null]}
      {...webProps({ title: `${label}  ⌘\\`, dataSet: { paneToggle: "far-left" } })}
    >
      <MenuIcon icon="pane" color={over ? "var(--ink)" : "var(--ink-3)"} size={16} />
    </Pressable>
  );
}

function PaneHeader(props: PaneViewProps & { innerToggleHidden: boolean }): ReactElement {
  const { toggle, title, tabs, activeTab } = props;
  const list: PaneTab[] = tabs === undefined ? [] : tabs.slice();
  const strip = list.length > 0 ? (
    <TabStrip
      tabs={list}
      active={activeTab ?? list[0]?.key ?? ""}
      label={title}
      {...(props.tight === true ? { tight: true } : {})}
      {...(props.onSelectTab === undefined ? {} : { onSelect: props.onSelectTab })}
      {...(props.onCloseTab === undefined ? {} : { onClose: props.onCloseTab })}
      {...(props.onReorderTabs === undefined ? {} : { onReorder: props.onReorderTabs })}
      {...(props.tabMenu === undefined ? {} : { menu: props.tabMenu })}
      {...(props.onPlus === undefined ? {} : { onPlus: props.onPlus })}
      {...(props.plusTitle === undefined ? {} : { plusTitle: props.plusTitle })}
    />
  ) : (
    <View style={styles.titleBox}>
      <Text numberOfLines={1} style={styles.title}>{title ?? ""}</Text>
    </View>
  );
  // PANE_HEADER_ORDER is ["toggle", "tabs"]: the toggle is the first child, the far left.
  const order: readonly string[] = PANE_HEADER_ORDER;
  const parts: ReactNode[] = [];
  for (const slot of order) {
    if (slot === "toggle") {
      parts.push(
        <View key="toggle" style={[styles.toggleCell, props.innerToggleHidden ? HIDE : null]}>
          <PaneToggleButton open={toggle.open} hidden={props.innerToggleHidden} {...(toggle.onPress === undefined ? {} : { onPress: toggle.onPress })} />
        </View>,
      );
    } else {
      parts.push(<View key="tabs" style={styles.tabsSlot}>{strip}</View>);
    }
  }
  return (
    <View
      style={styles.header}
      testID="pane-header"
      {...webProps({ dataSet: { paneHeader: "true", toggleCount: "1", innerToggle: props.innerToggleHidden ? "hidden" : "shown" } })}
    >
      {parts}
    </View>
  );
}

/** A pane inside the main view. Its toggle sits at the far left of its header and hides while the side pane is open. */
export function Pane(props: PaneViewProps): ReactElement {
  return (
    <View style={styles.pane} testID="pane" role="region" aria-label={props.title ?? paneToggleLabel(props.toggle.open)}>
      <PaneHeader {...props} innerToggleHidden={props.toggle.open} />
      <View style={styles.body}>{props.children}</View>
    </View>
  );
}

/* ---------- side pane ---------- */

export function SidePane(props: SidePaneViewProps): ReactElement | null {
  const { paneKey, toggle, onWidthChange } = props;
  const window = useWindowDimensions();
  const min = sidePaneMin(props);
  const maxFraction = sidePaneMax(props);
  const first = props.defaultWidth ?? DEFAULT_PANE_WIDTH;
  const [stored, setStored] = useState<number | null>(() => paneWidths.get(paneKey));
  const [lit, setLit] = useState(false);
  const [dragging, setDragging] = useState(false);
  const width = clampPaneWidth(stored ?? first, window.width, min, maxFraction);
  const widthRef = useRef(width);
  widthRef.current = width;
  const windowRef = useRef(window.width);
  windowRef.current = window.width;
  const startWidth = useRef(width);
  const lastTap = useRef(0);

  useEffect(() => {
    setStored(paneWidths.get(paneKey));
  }, [paneKey]);

  const apply = useCallback((next: number, remember: boolean) => {
    const clamped = clampPaneWidth(next, windowRef.current, min, maxFraction);
    setStored(clamped);
    if (remember) paneWidths.set(paneKey, clamped);
    if (onWidthChange) onWidthChange(clamped);
  }, [paneKey, min, maxFraction, onWidthChange]);

  const reset = useCallback(() => {
    paneWidths.reset(paneKey);
    setStored(null);
    if (onWidthChange) onWidthChange(clampPaneWidth(first, windowRef.current, min, maxFraction));
  }, [paneKey, first, min, maxFraction, onWidthChange]);

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      startWidth.current = widthRef.current;
      setDragging(true);
    },
    onPanResponderMove: (_event, gesture) => apply(startWidth.current - gesture.dx, false),
    onPanResponderRelease: (_event, gesture) => {
      setDragging(false);
      if (Math.abs(gesture.dx) < 2) {
        const now = Date.now();
        if (now - lastTap.current < 450) {
          lastTap.current = 0;
          reset();
        } else {
          lastTap.current = now;
        }
        return;
      }
      apply(startWidth.current - gesture.dx, true);
    },
    onPanResponderTerminate: () => setDragging(false),
  }), [apply, reset]);

  if (!toggle.open) return null;

  const onKeyDown = (event: KeyEventLike): void => {
    const next = widthForKey(widthRef.current, event.key, windowRef.current, min, maxFraction);
    if (next === null) return;
    event.preventDefault?.();
    if (next === "reset") reset();
    else apply(next, true);
  };

  return (
    <View style={[styles.side, { width }]} testID="side-pane" role="complementary" aria-label={props.title ?? paneKey} {...webProps({ dataSet: { paneKey, min: String(min), max: String(maxFraction) } })}>
      <View
        {...responder.panHandlers}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the side pane"
        aria-valuenow={width}
        aria-valuemin={min}
        aria-valuemax={Math.max(min, Math.round(window.width * maxFraction))}
        testID="side-pane-resize"
        focusable
        onPointerEnter={() => setLit(true)}
        onPointerLeave={() => setLit(false)}
        style={styles.edge}
        {...webProps({ tabIndex: 0, title: "Drag to resize, double-click to reset", onKeyDown, onFocus: () => setLit(true), onBlur: () => setLit(false) })}
      >
        <View style={[styles.edgeLine, lit || dragging ? EDGE_ON : null]} />
      </View>
      <PaneHeader {...props} innerToggleHidden={false} />
      <View style={styles.body}>{props.children}</View>
    </View>
  );
}

// Plain objects (not StyleSheet ids) so the painted token is visible in the element's inline style.
const HOVER = { backgroundColor: "var(--hover)" };
const HIDE = { display: "none" } as unknown as ViewStyle;
const EDGE_ON = { backgroundColor: "var(--accent-line)", width: 2 };

const COL_RESIZE = (Platform.OS === "web" ? "col-resize" : undefined) as unknown as ViewStyle["cursor"];

const styles = StyleSheet.create({
  header: { height: PANE_HEADER_HEIGHT, flexDirection: "row", alignItems: "center", backgroundColor: "var(--side)" as string },
  toggleCell: { height: PANE_HEADER_HEIGHT, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  toggle: { width: 28, height: 28, marginLeft: 6, marginRight: 2, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  tabsSlot: { flex: 1, minWidth: 0 },
  titleBox: { height: PANE_HEADER_HEIGHT, justifyContent: "center", paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  title: { color: "var(--ink)" as string, fontSize: 12.5, fontWeight: "500" },
  pane: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: "var(--side)" as string, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, overflow: "hidden" },
  side: { height: "100%", minWidth: 0, minHeight: 0, backgroundColor: "var(--side)" as string, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, overflow: "visible" },
  body: { flex: 1, minHeight: 0 },
  edge: { position: "absolute", top: 0, bottom: 0, left: -4, width: 7, zIndex: 6, alignItems: "center", cursor: COL_RESIZE },
  edgeLine: { height: "100%", width: 1, backgroundColor: "transparent" },
});
