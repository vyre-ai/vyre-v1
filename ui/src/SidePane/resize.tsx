// One resize behaviour for every pane edge (the right-hand panes and the left sidebars). A hook holds the width,
// a handle draws the edge: a hover line, col-resize cursor, arrow keys when focused, double-click resets. The width is
// remembered per pane key through paneWidths (localStorage on the web, every access in try/catch).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { PanResponder, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { SIDE_PANE_MAX, SIDE_PANE_MIN } from "./props.ts";
import { clampPaneWidth, paneWidths } from "./index.tsx";
import { RAIL_OVERLAY, SHEET, SHEET_GAP, intoSheet, sq, useRailOverlay, useSheetHost } from "./host.tsx";

/** The pane grows to the left (a right-hand pane, handle on its left edge) or to the right (a left sidebar, handle on its right edge). */
export type GrowDirection = "left" | "right";

export const KEY_STEP = 24;

/** Arrow keys move the edge the way it points: a right-hand pane grows on ArrowLeft, a left sidebar on ArrowRight. Home resets. */
export function keyWidth(current: number, key: string, grow: GrowDirection, windowWidth: number, min: number, maxFraction: number): number | "reset" | null {
  if (key === "Home") return "reset";
  const more = grow === "left" ? "ArrowLeft" : "ArrowRight";
  const less = grow === "left" ? "ArrowRight" : "ArrowLeft";
  if (key === more) return clampPaneWidth(current + KEY_STEP, windowWidth, min, maxFraction);
  if (key === less) return clampPaneWidth(current - KEY_STEP, windowWidth, min, maxFraction);
  return null;
}

export interface ResizeOptions {
  paneKey: string;
  defaultWidth: number;
  grow: GrowDirection;
  min?: number;
  maxFraction?: number;
  /** A hard cap in px on top of the fraction: the prototype's sidebar stops at 380, the right rail at 720. */
  maxWidth?: number;
  onWidthChange?: (width: number) => void;
}

export interface Resizable {
  width: number;
  dragging: boolean;
  min: number;
  maxFraction: number;
  windowWidth: number;
  /** The pointer and key handlers for the handle. */
  panHandlers: Record<string, unknown>;
  onKey(event: { key: string; preventDefault?: () => void }): void;
  setWidth(next: number): void;
  reset(): void;
}

export function useResizable(o: ResizeOptions): Resizable {
  const { paneKey, defaultWidth, grow, onWidthChange } = o;
  const min = o.min ?? SIDE_PANE_MIN;
  const maxFraction = o.maxFraction ?? SIDE_PANE_MAX;
  const win = useWindowDimensions();
  const [stored, setStored] = useState<number | null>(() => paneWidths.get(paneKey));
  const [dragging, setDragging] = useState(false);
  const cap = (w: number): number => (o.maxWidth === undefined ? w : Math.min(w, o.maxWidth));
  const width = cap(clampPaneWidth(stored ?? defaultWidth, win.width, min, maxFraction));
  const widthRef = useRef(width);
  widthRef.current = width;
  const windowRef = useRef(win.width);
  windowRef.current = win.width;
  const start = useRef(width);
  const lastTap = useRef(0);

  useEffect(() => { setStored(paneWidths.get(paneKey)); }, [paneKey]);

  const apply = useCallback((next: number, remember: boolean) => {
    const clamped = cap(clampPaneWidth(next, windowRef.current, min, maxFraction));
    widthRef.current = clamped;
    setStored(clamped);
    if (remember) paneWidths.set(paneKey, clamped);
    if (onWidthChange) onWidthChange(clamped);
  }, [paneKey, min, maxFraction, o.maxWidth, onWidthChange]);

  const reset = useCallback(() => {
    paneWidths.reset(paneKey);
    setStored(null);
    if (onWidthChange) onWidthChange(clampPaneWidth(defaultWidth, windowRef.current, min, maxFraction));
  }, [paneKey, defaultWidth, min, maxFraction, onWidthChange]);

  const sign = grow === "left" ? -1 : 1;
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { start.current = widthRef.current; setDragging(true); },
    onPanResponderMove: (_e, g) => apply(start.current + sign * g.dx, false),
    onPanResponderRelease: (_e, g) => {
      setDragging(false);
      if (Math.abs(g.dx) < 2) {
        const now = Date.now();
        if (now - lastTap.current < 450) { lastTap.current = 0; reset(); } else lastTap.current = now;
        return;
      }
      apply(start.current + sign * g.dx, true);
    },
    onPanResponderTerminate: () => setDragging(false),
  }), [apply, reset, sign]);

  const onKey = (event: { key: string; preventDefault?: () => void }): void => {
    const next = keyWidth(widthRef.current, event.key, grow, windowRef.current, min, maxFraction);
    if (next === null) return;
    event.preventDefault?.();
    if (next === "reset") reset(); else apply(next, true);
  };

  return { width, dragging, min, maxFraction, windowWidth: win.width, panHandlers: responder.panHandlers as unknown as Record<string, unknown>, onKey, setWidth: (n) => apply(n, true), reset };
}

const COL_RESIZE = (Platform.OS === "web" ? "col-resize" : undefined) as unknown as ViewStyle["cursor"];
const LINE_ON = { backgroundColor: "var(--accent-line)", width: 2 };

/** The drag edge. Place it as a child of a position-relative pane; `at` is the pane edge it sits on. */
export function ResizeHandle({ r, at, label = "Resize the pane", testID = "side-pane-resize" }: { r: Resizable; at: "left" | "right"; label?: string; testID?: string }): ReactElement {
  const [lit, setLit] = useState(false);
  const web: Record<string, unknown> = Platform.OS === "web"
    ? { tabIndex: 0, title: "Drag to resize, double-click to reset", onKeyDown: r.onKey, onFocus: () => setLit(true), onBlur: () => setLit(false), onDoubleClick: () => r.reset() }
    : {};
  return (
    <View
      {...r.panHandlers}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={r.width}
      aria-valuemin={r.min}
      aria-valuemax={Math.max(r.min, Math.round(r.windowWidth * r.maxFraction))}
      testID={testID}
      focusable
      onPointerEnter={() => setLit(true)}
      onPointerLeave={() => setLit(false)}
      style={[h.edge, at === "left" ? h.atLeft : h.atRight]}
      {...web}
    >
      <View style={[h.line, lit || r.dragging ? LINE_ON : null]} />
    </View>
  );
}

export interface ResizableColumnProps {
  paneKey: string;
  defaultWidth: number;
  /** "left" for a right-hand pane (handle on its left edge); "right" for a left sidebar. */
  grow: GrowDirection;
  min?: number;
  maxFraction?: number;
  maxWidth?: number;
  /** Stays in the place's own row instead of landing on a sheet: a column that is part of the page (the conversation beside a record). */
  inline?: boolean;
  style?: ViewStyle | ViewStyle[];
  testID?: string;
  label?: string;
  onLayout?: (e: { nativeEvent: { layout: { width: number; height: number } } }) => void;
  role?: "menu" | "complementary";
  children?: ReactNode;
}

/** A column with a resizable width: the sidebars and the right-hand panels that are not a SidePane. In the shell it is a sheet: the sidebar sheet on the left, a right rail sheet on the right. */
export function ResizableColumn(p: ResizableColumnProps): ReactElement | null {
  const host = useSheetHost();
  const overlay = useRailOverlay();
  const r = useResizable({ paneKey: p.paneKey, defaultWidth: p.defaultWidth, grow: p.grow, ...(p.min === undefined ? {} : { min: p.min }), ...(p.maxFraction === undefined ? {} : { maxFraction: p.maxFraction }), ...(p.maxWidth === undefined ? {} : { maxWidth: p.maxWidth }) });
  const handle = <ResizeHandle r={r} at={p.grow === "left" ? "left" : "right"} />;
  const a11y = { ...(p.onLayout === undefined ? {} : { onLayout: p.onLayout as never }), ...(p.label === undefined ? {} : { accessibilityLabel: p.label }), ...(p.role === undefined ? {} : { accessibilityRole: p.role }) };
  const target = host === null || p.inline === true ? null : p.grow === "right" ? host.left : host.right;
  if (host !== null && p.inline !== true) {
    const right = p.grow === "left";
    return <>{intoSheet(target, (
      <View style={[rel, { width: r.width, minWidth: 0, flexShrink: 0 }, right ? { marginLeft: SHEET_GAP } : null, right && overlay ? RAIL_OVERLAY : null]} testID={p.testID} {...a11y}>
        <View style={[SHEET, p.style, SHEET_RESET]} {...sq("sheet")}>{p.children}{right ? null : host.hide}</View>
        {right && overlay ? null : handle}
      </View>
    ))}</>;
  }
  return (
    <View style={[p.style, { width: r.width, minWidth: 0, maxWidth: "100%" }, rel]} testID={p.testID} {...a11y}>
      {p.children}
      {handle}
    </View>
  );
}

/** A caller's column style was written for a bare column: on a sheet the width belongs to the wrapper and the rules go. */
const SHEET_RESET = { width: "auto", borderLeftWidth: 0, borderRightWidth: 0, flex: 1 } as unknown as ViewStyle;

const rel = { position: "relative" } as ViewStyle;

const h = StyleSheet.create({
  edge: { position: "absolute", top: 0, bottom: 0, width: 7, zIndex: 6, alignItems: "center", cursor: COL_RESIZE },
  atLeft: { left: -4 },
  atRight: { right: -4 },
  line: { height: "100%", width: 1, backgroundColor: "transparent" },
});
