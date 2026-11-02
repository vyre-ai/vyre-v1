// The soft sheets: the app is three rounded full-height sheets on the rail ground, the sidebar, the main view and the right rail. A place never lays this out itself: anything drawn with
// ui/SidePane or ui/ResizableColumn lands in the shell's left or right outlet through a portal (so the place's providers still reach it), wears the sheet shape there, and every place gets
// the same frame. With no host above it (a test, a mount, the phone) the same component draws inline, as a plain column.

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Platform, useWindowDimensions } from "react-native";
import type { ViewStyle } from "react-native";
import { injectCss } from "../theme/css.ts";

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
/** The gap between two sheets. */
export const SHEET_GAP = 6;
export const SHEET_RADIUS = 16;

export function intoSheet(target: unknown, node: ReactNode): ReactNode {
  if (Platform.OS !== "web" || target === null || target === undefined) return null;
  return createPortal(node, target as Element);
}

/** The shape of a sheet, the clipping box inside the column that holds the resize edge. */
export const SHEET: ViewStyle = { flex: 1, minHeight: 0, minWidth: 0, borderRadius: SHEET_RADIUS, overflow: "hidden", backgroundColor: "var(--side)" as string };

/** The right rail floats as a card while the window is narrow. */
export function useRailOverlay(): boolean {
  const w = useWindowDimensions().width;
  return w > 0 && w < SHEET_OVERLAY_BELOW;
}

export const RAIL_OVERLAY: ViewStyle = { position: "absolute", top: 8, right: 8, bottom: 8, zIndex: 20, marginLeft: 0, ...(Platform.OS === "web" ? ({ boxShadow: "var(--sh-pop)", borderRadius: 18 } as ViewStyle) : {}) };

/**
 * Where the browser has corner-shape, sheets and the smaller shapes are true squircles. Marked with data-sq on the element, so one rule covers every place: a browser without it keeps the plain radius.
 * The !important beats the atomic style React Native Web writes for borderRadius.
 */
export const SQUIRCLE_CSS = [
  "@supports (corner-shape:squircle){[data-sq]{corner-shape:squircle}[data-sq=sheet]{border-radius:22px!important}[data-sq=card]{border-radius:22px!important}[data-sq=row]{border-radius:15px!important}[data-sq=track]{border-radius:26px!important}[data-sq=tile]{border-radius:20px!important}[data-sq=face]{border-radius:38%!important}}",
].join("\n");

export function useSquircle(): void {
  if (Platform.OS !== "web") return;
  injectCss((globalThis as { document?: Parameters<typeof injectCss>[0] }).document, "vyre-ui-squircle", SQUIRCLE_CSS);
}

/** The web prop that marks a shape; nothing on native. */
export function sq(shape: "sheet" | "card" | "row" | "track" | "tile" | "face"): Record<string, unknown> {
  return Platform.OS === "web" ? { dataSet: { sq: shape } } : {};
}
