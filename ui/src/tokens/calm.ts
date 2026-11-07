// The calm pass, once (DESIGN-SYSTEM-221 sections 1, 2 and 7; owner 6 Nov 2026: "10X cleaner, breathable, calmer, beautiful"). The numbers the conversation, the stream and the sidebar
// share live here, so a place never types its own radius, face size or gap. One radius for every button, field, chip, card, menu and panel; only avatars and the round send button stay circles.

/** The one corner radius. */
export const RADIUS = 12;
/** The message column, centred in its pane. */
export const COLUMN = 680;
/** A face beside a message, 28 px. */
export const FACE = 28;
/** The face sits in the gutter left of the column; this is how far its left edge is from the column's. */
export const GUTTER = 42;
/** Between two people's messages, and inside one person's run. */
export const GAP_BETWEEN = 20;
export const GAP_WITHIN = 6;
/** Message text and its line: 15 on 24 (1.6). Names 14 semibold, meta 12 muted, system lines 13 muted. */
export const BODY_PX = 15;
export const BODY_LEAD = 24;
export const NAME_PX = 14;
export const META_PX = 12;
export const SYSTEM_PX = 13;
/** A sidebar row. */
export const ROW = 32;
/** The tallest a chart gets. */
export const CHART_MAX = 140;
/** The soft amber wash behind a highlight, and the faint tint behind inline code (a share of the ink colour). */
export const HIGHLIGHT = "rgba(245, 176, 65, 0.18)";
export const CODE_TINT = "color-mix(in srgb, var(--ink) 7%, transparent)";

/** The room the column and its gutter need side by side: under this the face goes inline above the text. */
export const GUTTER_MIN_WIDTH = COLUMN + 2 * (GUTTER + 8);
export const gutterFits = (paneWidth: number): boolean => paneWidth >= GUTTER_MIN_WIDTH;

/** The space above a message: 20 where the author changes, 6 inside a run. */
export const gapAbove = (newgroup: boolean): number => (newgroup ? GAP_BETWEEN : GAP_WITHIN);

/** The first message of a run shows the face, the name and the time; a later one shows its time only on hover. */
export function headerOf(newgroup: boolean): "full" | "hover-time" {
  return newgroup ? "full" : "hover-time";
}

/** A goal's progress in a sidebar row: muted "212/300", never a bar. */
export const countLabel = (done: number, total: number): string => `${done}/${total}`;
