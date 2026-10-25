// The few icons the config pane and the Journey designer draw that the canvas set does not have (16 px viewBox, stroke, from the prototype's set). Everything else comes from the canvas icons.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import { Glyph as CanvasGlyph } from "../canvas/icons.tsx";
import { each } from "../runs/each.ts";
import type { GlyphName as CanvasName } from "../canvas/icons.tsx";

const EXTRA = {
  lock: ["M4.5 7.5h7v5.5h-7z", "M6 7.5V5.800a2 2 0 014 0V7.500"],
  people: ["M6 7.500a2 2 0 100-4 2 2 0 000 4z", "M2.500 12.500c.4-2 1.800-3 3.500-3s3.100 1 3.500 3", "M10.500 7a1.600 1.600 0 100-3.200", "M11 9.600c1.300.2 2.200 1 2.500 2.400"],
  bell: ["M4 11.500V7.500a4 4 0 118 0v4l1 1H3z", "M6.500 14a1.500 1.500 0 003 0"],
  gear: ["M8 10a2 2 0 100-4 2 2 0 000 4z", "M8 2.500v1.500M8 12v1.500M2.500 8H4M12 8h1.500M4.100 4.100l1 1M10.900 10.900l1 1M11.900 4.100l-1 1M5.100 10.900l-1 1"],
  history: ["M2.500 8a5.500 5.500 0 105.500-5.500A5.500 5.500 0 004.200 4", "M2.500 2.500V5H5", "M8 5v3l2 1.500"],
  open: ["M9.500 2.500h4v4", "M13.500 2.500L8 8", "M12 9.500v3a1 1 0 01-1 1H3.500a1 1 0 01-1-1V5a1 1 0 011-1h3"],
  copy: ["M5.500 5.500h7v8h-7z", "M3.500 10.500v-8h7"],
  trash: ["M3 4.500h10", "M6.500 4.500V3h3v1.500", "M4.500 4.500l.5 8.500h6l.5-8.500", "M7 7v4M9 7v4"],
  arrow: ["M3.500 8h9", "M9 4.500L12.500 8 9 11.500"],
  arrup: ["M8 12.500v-9", "M4.500 7L8 3.500 11.500 7"],
  arrdn: ["M8 3.500v9", "M4.500 9L8 12.500 11.500 9"],
  grip: ["M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01"],
  records: ["M3.200 4.500v7c0 1.100 2.100 2 4.800 2s4.800-.9 4.800-2v-7", "M3.200 8c0 1.100 2.100 2 4.800 2s4.800-.9 4.800-2", "M12.800 4.500c0 1.100-2.100 2-4.800 2s-4.800-.9-4.800-2 2.100-2 4.800-2 4.800.9 4.800 2z"],
  rename: ["M3 12.500h10", "M4 10.500l6.500-6.500 1.500 1.500-6.500 6.500H4z"],
  chevU: ["M3.500 10L8 5.500 12.500 10"],
  minus: ["M3.500 8h9"],
} as const satisfies Record<string, readonly string[]>;
export type ExtraName = keyof typeof EXTRA;
export type GlyphName = ExtraName | CanvasName;

export function Glyph({ name, size = 15, color = "var(--ink-3)" }: { name: GlyphName; size?: number; color?: string }): ReactElement | null {
  if (name in EXTRA) {
    if (Platform.OS !== "web") return null;
    return createElement(
      "svg",
      { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } },
      ...each(EXTRA[name as ExtraName] as readonly string[], (p) => createElement("path", { key: p, d: p })),
    );
  }
  return <CanvasGlyph name={name as CanvasName} size={size} color={color} />;
}
