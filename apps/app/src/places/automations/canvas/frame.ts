// Desktop and compact widths match the theme first-frame shots (1280 and 390).
import { SHOT_WIDTHS } from "../../../../../../ui/src/theme/index.ts";
import { CARD_W } from "./model.ts";

export type StudioLayout = "desktop" | "compact";

export const DESKTOP_WIDTH = SHOT_WIDTHS[0];
export const COMPACT_WIDTH = SHOT_WIDTHS[1];
/** Desktop inspector column. Matches frameFor("desktop").inspectorWidth. */
export const DESKTOP_INSPECTOR = 300;

/** Compact builder reads top to bottom. Desktop keeps one graph. */
export const COMPACT_REGIONS = ["Canvas overview", "Selected step", "Data", "Test"] as const;
export type CompactRegion = (typeof COMPACT_REGIONS)[number];

/** Inspector tabs use the same words as the regions after the canvas. */
export const COMPACT_SECTION: Record<"configure" | "data" | "test", CompactRegion> = {
  configure: "Selected step",
  data: "Data",
  test: "Test",
};

export interface StudioFrame {
  width: number;
  inspectorWidth: number | "100%";
  compact: boolean;
  /** Compact stacks named regions. The graph is not scaled down into a miniature. */
  ordered: boolean;
}

/** Side inspector on a desktop window. A compact window stacks it at full width. */
export function frameFor(layout: StudioLayout): StudioFrame {
  if (layout === "compact") return { width: COMPACT_WIDTH, inspectorWidth: "100%", compact: true, ordered: true };
  return { width: DESKTOP_WIDTH, inspectorWidth: DESKTOP_INSPECTOR, compact: false, ordered: false };
}

/** Region labels in reading order. Desktop is empty so the graph is not restated as screens. */
export function regionOrder(layout: StudioLayout): readonly CompactRegion[] {
  return frameFor(layout).ordered ? COMPACT_REGIONS : [];
}

export function compactRegionLabel(layout: StudioLayout): string | null {
  const order = regionOrder(layout);
  return order.length === 0 ? null : order.join(", ");
}

/** Compact never draws the graph smaller than the cards. Desktop keeps the zoom. */
export function canvasScale(ordered: boolean, zoom: number): number {
  if (!ordered) return zoom;
  return zoom < 1 ? 1 : zoom;
}

/** Beside when the window can hold the desktop inspector and a card. The compact shot cannot. Width 0 is not measured yet. */
export function layoutForWidth(width: number): StudioLayout {
  if (width <= 0) return "desktop";
  if (width <= COMPACT_WIDTH || width < DESKTOP_INSPECTOR + CARD_W) return "compact";
  return "desktop";
}
