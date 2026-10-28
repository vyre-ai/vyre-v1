// Desktop and compact widths match the theme first-frame shots (1280 and 390).
import { SHOT_WIDTHS } from "../../../../../../ui/src/theme/index.ts";
import { CARD_W } from "./model.ts";

export type StudioLayout = "desktop" | "compact";

export const DESKTOP_WIDTH = SHOT_WIDTHS[0];
export const COMPACT_WIDTH = SHOT_WIDTHS[1];
/** Desktop inspector column. Matches frameFor("desktop").inspectorWidth. */
export const DESKTOP_INSPECTOR = 300;

export interface StudioFrame {
  width: number;
  inspectorWidth: number | "100%";
  compact: boolean;
}

/** Side inspector on a desktop window. A compact window stacks it at full width. */
export function frameFor(layout: StudioLayout): StudioFrame {
  if (layout === "compact") return { width: COMPACT_WIDTH, inspectorWidth: "100%", compact: true };
  return { width: DESKTOP_WIDTH, inspectorWidth: DESKTOP_INSPECTOR, compact: false };
}

/** Beside when the window can hold the desktop inspector and a card. The compact shot cannot. Width 0 is not measured yet. */
export function layoutForWidth(width: number): StudioLayout {
  if (width <= 0) return "desktop";
  if (width <= COMPACT_WIDTH || width < DESKTOP_INSPECTOR + CARD_W) return "compact";
  return "desktop";
}
