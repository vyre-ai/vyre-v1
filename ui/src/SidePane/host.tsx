// The soft sheets: the app is three rounded full-height sheets on the rail ground, the sidebar, the main view and the right rail. A place never lays this out itself: anything drawn with
// ui/SidePane or ui/ResizableColumn lands in the shell's left or right outlet through a portal (so the place's providers still reach it), wears the sheet shape there, and every place gets
// the same frame. With no host above it (a test, a mount, the phone) the same component draws inline, as a plain column.

import { createContext, useContext, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Platform, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { injectCss } from "../theme/css.ts";
import { GUTTER } from "./layout.ts";
import { RADIUS } from "../tokens/radius.ts";
import type { Band, Layout } from "./layout.ts";

export interface SheetHost {
  /** The node the sidebar sheet lands in. */
  left: unknown;
  /** The node the right rail's sheets land in. */
  right: unknown;
  /** The Hide button, for a sheet with no head of the shell's. */
  hide?: ReactNode;
}

const Ctx = createContext<SheetHost | null>(null);
export const SheetHostProvider = Ctx.Provider;
export const useSheetHost = (): SheetHost | null => useContext(Ctx);

/** Below this window width the right rail floats over the main sheet instead of taking room from it. */
export const SHEET_OVERLAY_BELOW = 1000;
/** The one gutter: window edge to panel and panel to panel, every place (DESIGN-SYSTEM-221 section 1). */
export const SHEET_GAP = GUTTER;
export const SHEET_RADIUS = RADIUS;

/**
 * What the shell tells its panels (the layout model in ./layout.ts, computed once in the shell). A panel reads its mode and width here instead of deciding for itself, registers when it is open so the
 * model knows a pane is up, and saves a dragged width under the band it was dragged in. Absent (a test, a mount, the phone) the panels fall back to their own widths.
 */
export interface ShellLayoutApi {
  layout: Layout;
  /** A panel is open. The newest pane wins (one side pane at a time); closing it brings the one before it back. Returns the release. */
  register(kind: "sidebar" | "pane", id: string, close?: () => void, meta?: { def: number; min: number; max: number }): () => void;
  /** The pane that owns the right side now. */
  activePane: string | null;
  /** Saved width for a panel key in the current band. */
  saved(key: string): number | null;
  /** Save a dragged width (or clear it with null) under the current band and draw again. */
  commit(key: string, width: number | null): void;
  /** Overlay sidebar: show it over main or put it away. */
  peekSidebar(on: boolean): void;
}

const LayoutCtx = createContext<ShellLayoutApi | null>(null);
export const ShellLayoutProvider = LayoutCtx.Provider;
export const useShellLayout = (): ShellLayoutApi | null => useContext(LayoutCtx);
export type { Band, Layout };

export function intoSheet(target: unknown, node: ReactNode): ReactNode {
  if (Platform.OS !== "web" || target === null || target === undefined) return null;
  return createPortal(node, target as Element);
}

/** The shape of a sheet, the clipping box inside the column that holds the resize edge. */
export const SHEET: ViewStyle = { flex: 1, minHeight: 0, minWidth: 0, borderRadius: SHEET_RADIUS, overflow: "hidden", backgroundColor: "var(--side)" as string };

/** The right rail floats as a card while the window is narrow. */
export function useRailOverlay(): boolean {
  const w = useWindowDimensions().width;
  const managed = useShellLayout();
  if (managed !== null) return managed.layout.pane.mode === "overlay";
  return w > 0 && w < SHEET_OVERLAY_BELOW;
}

/** A panel in an overlay mode: over main, from the right, inside the one gutter; the scrim under it is the shell's. */
export const RAIL_OVERLAY: ViewStyle = { position: "absolute", top: 0, right: 0, bottom: 0, zIndex: 41, marginLeft: 0, ...(Platform.OS === "web" ? ({ boxShadow: "var(--sh-pop)", borderRadius: SHEET_RADIUS } as ViewStyle) : {}) };
export const SIDEBAR_OVERLAY: ViewStyle = { position: "absolute", top: 0, left: 0, bottom: 0, zIndex: 40, ...(Platform.OS === "web" ? ({ boxShadow: "var(--sh-pop)", borderRadius: SHEET_RADIUS } as ViewStyle) : {}) };

/**
 * Where the browser has corner-shape, sheets and the smaller shapes are true squircles. Marked with data-sq on the element, so one rule covers every place: a browser without it keeps the plain radius.
 * The !important beats the atomic style React Native Web writes for borderRadius.
 */
export const SQUIRCLE_CSS = [
  "@supports (corner-shape:squircle){[data-sq]{corner-shape:squircle}[data-sq=sheet],[data-sq=card],[data-sq=row],[data-sq=track],[data-sq=tile]{border-radius:12px!important}[data-sq=face]{border-radius:38%!important}}",
].join("\n");

export function useSquircle(): void {
  if (Platform.OS !== "web") return;
  injectCss((globalThis as { document?: Parameters<typeof injectCss>[0] }).document, "vyre-ui-squircle", SQUIRCLE_CSS);
}

/** The web prop that marks a shape; nothing on native. */
export function sq(shape: "sheet" | "card" | "row" | "track" | "tile" | "face"): Record<string, unknown> {
  return Platform.OS === "web" ? { dataSet: { sq: shape } } : {};
}

/**
 * A panel tells the shell it is open. Returns false while another pane owns the right side (one side pane at a time) or before the shell has seen this one, so the caller draws nothing then.
 * Outside the shell, or for a panel that is not managed, it is always true.
 */
export function usePanelPresence(kind: "sidebar" | "pane", id: string, open: boolean, close?: () => void, meta?: { def: number; min: number; max: number }): boolean {
  const shell = useShellLayout();
  const closeRef = useRef(close);
  closeRef.current = close;
  const register = shell?.register;
  useEffect(() => {
    if (register === undefined || !open) return undefined;
    return register(kind, id, () => closeRef.current?.(), meta);
  }, [register, kind, id, open, meta?.def, meta?.min, meta?.max]);   // eslint-disable-line react-hooks/exhaustive-deps -- meta is three numbers, listed one by one
  if (shell === null || !open) return true;
  if (kind === "sidebar") return true;
  return shell.activePane === id;
}
