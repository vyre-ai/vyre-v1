// Stroke icons for Runs, 16 px viewBox, drawn from the prototype's set (the same shapes the Automations canvas uses). Web draws an SVG; other platforms draw nothing until their icon set lands.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";

export const PATHS = {
  bolt: ["M9 1.8L3.5 9H8l-1 5.2L12.5 7H8z"],
  clock: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M8 5v3l2 1.5"],
  inbox: ["M2.5 9.5l1.4-5A1.5 1.5 0 015.3 3.5h5.4a1.5 1.5 0 011.4 1l1.4 5", "M2.5 9.5v2a1 1 0 001 1h9a1 1 0 001-1v-2h-3.2l-.8 1.3H6.5l-.8-1.3z"],
  stage: ["M3 3.5v9", "M3 4h8l-1.6 2.5L11 9H3"],
  check: ["M3.5 8.5l3 3 6-7"],
  x: ["M4 4l8 8M12 4l-8 8"],
  warn: ["M8 2.5l6 10.5H2z", "M8 6.5v3M8 11.2h.01"],
  hourglass: ["M4.5 2.5h7M4.5 13.5h7", "M5 2.5v2.3c0 1 1 1.9 3 3.2 2-1.3 3-2.2 3-3.2V2.5", "M5 13.5v-2.3c0-1 1-1.9 3-3.2 2 1.3 3 2.2 3 3.2v2.3"],
  retry: ["M3 8a5 5 0 019-3", "M12.5 2.5V5H10", "M13 8a5 5 0 01-9 3", "M3.5 13.5V11H6"],
  stop: ["M5 5h6v6H5z", "M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8z"],
  flask: ["M6.5 2.5h3M7 2.5v4L3.8 12a1 1 0 00.9 1.5h6.6a1 1 0 00.9-1.5L9 6.5v-4"],
  undo: ["M6 3.5L2.5 7 6 10.5", "M2.5 7H9a4 4 0 010 8H6"],
  more: ["M3.5 8h.01", "M8 8h.01", "M12.5 8h.01"],
  filter: ["M2.5 4h11M4.5 8h7M6.5 12h3"],
  chevR: ["M6 3.5L10.5 8 6 12.5"],
  up: ["M8 13V3.5M4 7.5l4-4 4 4"],
  open: ["M9.5 2.5h4v4", "M13.5 2.5L8 8", "M12 9.5v3a1 1 0 01-1 1H3.5a1 1 0 01-1-1V5a1 1 0 011-1h3"],
  link: ["M6.5 9.5a3 3 0 004.2 0l2-2a3 3 0 00-4.2-4.2l-.6.6", "M9.5 6.5a3 3 0 00-4.2 0l-2 2a3 3 0 004.2 4.2l.6-.6"],
  copy: ["M5.5 5.5h7v8h-7z", "M3.5 10.5v-8h7"],
  list: ["M5.5 4h8M5.5 8h8M5.5 12h8", "M2.5 4h.01M2.5 8h.01M2.5 12h.01"],
  key: ["M6 9.5a3 3 0 110-6 3 3 0 010 6z", "M8.2 7.8L13 12.5M11 10.5l1.5 1.5"],
  flag: ["M3 2.5v11", "M3 3h8.5l-1.7 2.8 1.7 2.8H3"],
} as const satisfies Record<string, readonly string[]>;
export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, size = 15, color = "var(--ink-3)" }: { name: GlyphName; size?: number; color?: string }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  return createElement(
    "svg",
    {
      viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, "data-glyph": name,
      style: { display: "block", flex: "none", stroke: color, strokeWidth: name === "more" ? 2.4 : 1.4, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" },
    },
    ...(PATHS[name] as readonly string[]).map((p) => createElement("path", { key: p, d: p })),
  );
}

/** The icon names a run line may carry; an unknown one falls back to the bolt. */
export function lineGlyph(icon: string): GlyphName {
  return icon in PATHS ? (icon as GlyphName) : "bolt";
}
