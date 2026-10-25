// Stroke icons for the Automations place, 16 px viewBox, drawn from the prototype's set. Web draws an SVG; other platforms draw nothing until their icon set lands.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import type { IconKey } from "./model.ts";

export const PATHS = {
  bolt: ["M9 1.8L3.5 9H8l-1 5.2L12.5 7H8z"],
  clock: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M8 5v3l2 1.5"],
  hook: ["M6 11.5a3 3 0 110-6h.5", "M10 4.5a3 3 0 110 6h-.5", "M6.5 8h3"],
  inbox: ["M2.5 9.5l1.4-5A1.5 1.5 0 015.3 3.5h5.4a1.5 1.5 0 011.4 1l1.4 5", "M2.5 9.5v2a1 1 0 001 1h9a1 1 0 001-1v-2h-3.2l-.8 1.3H6.5l-.8-1.3z"],
  mail: ["M2.5 4.5h11v7h-11z", "M2.8 5l5.2 3.8L13.2 5"],
  chat: ["M3 4.5A2 2 0 015 2.5h6a2 2 0 012 2v4.5a2 2 0 01-2 2H7l-3 2.5V11a2 2 0 01-1-1.7z"],
  sheet: ["M3 3.5h10v9H3z", "M3 6.5h10M3 9.5h10M6.5 3.5v9"],
  ci: ["M8 2.5l5 2.8v5.4L8 13.5l-5-2.8V5.3z", "M5.8 8.1l1.6 1.6 2.8-3"],
  meeting: ["M2.5 4.5h7.5v7H2.5z", "M10 7l3.5-2v6L10 9"],
  stage: ["M3 3.5v9", "M3 4h8l-1.6 2.5L11 9H3"],
  reply: ["M6.5 4.5L3 8l3.5 3.5", "M3 8h6a4 4 0 014 4"],
  button: ["M3 6h10v4H3z", "M6 8h4"],
  hand: ["M5 8V4.2a1 1 0 012 0V7", "M7 7V3.4a1 1 0 012 0V7", "M9 7V4.2a1 1 0 012 0V9.5a4 4 0 01-4 4h-.5A3.5 3.5 0 013 10V8.8a1 1 0 011.9-.4z"],
  record: ["M3.2 4.5v7c0 1.1 2.1 2 4.8 2s4.8-.9 4.8-2v-7", "M3.2 8c0 1.1 2.1 2 4.8 2s4.8-.9 4.8-2", "M12.8 4.5c0 1.1-2.1 2-4.8 2s-4.8-.9-4.8-2 2.1-2 4.8-2 4.8.9 4.8 2z"],
  search: ["M7 11.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9z", "M10.4 10.4L13.5 13.5"],
  plus: ["M8 3.5v9M3.5 8h9"],
  edit: ["M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z"],
  task: ["M3 3.5h10v9H3z", "M5.5 8.2l1.7 1.7 3.3-3.4"],
  send: ["M13.5 2.5L2.5 7l4.2 1.8L8.5 13z", "M6.7 8.8l4.3-4"],
  phone: ["M4.5 2.5h2l1 2.6-1.3.9a6 6 0 003 3l.9-1.3 2.6 1v2a1.5 1.5 0 01-1.6 1.5A9 9 0 013 4.1 1.5 1.5 0 014.5 2.5z"],
  ai: ["M8 2.5l1.2 3.3L12.5 7l-3.3 1.2L8 11.5 6.8 8.2 3.5 7l3.3-1.2z", "M12 11.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5z"],
  journey: ["M3.5 3.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z", "M12.5 9.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z", "M5 5h3.5a2.5 2.5 0 010 5H7.5"],
  hourglass: ["M4.5 2.5h7M4.5 13.5h7", "M5 2.5v2.3c0 1 1 1.9 3 3.2 2-1.300 3-2.200 3-3.200V2.500", "M5 13.5v-2.3c0-1 1-1.900 3-3.200 2 1.300 3 2.200 3 3.200v2.300"],
  branch: ["M5 3.5a1.500 1.500 0 100 3 1.500 1.500 0 000-3z", "M5 6.500v3", "M5 12.500a1.500 1.500 0 100-3 1.500 1.500 0 000 3z", "M11 3.500a1.500 1.500 0 100 3 1.500 1.500 0 000-3z", "M11 6.500c0 2.500-6 1.500-6 3"],
  parallel: ["M4 2.500v11M12 2.500v11", "M2 6l2-2 2 2M10 6l2-2 2 2"],
  loop: ["M3 8a5 5 0 019-3", "M12.500 2.500V5H10", "M13 8a5 5 0 01-9 3", "M3.500 13.500V11H6"],
  stop: ["M5 5h6v6H5z", "M8 1.800a6.200 6.200 0 100 12.400A6.200 6.200 0 008 1.800z"],
  shield: ["M8 2l5 1.800v4c0 3-2.200 5-5 6.200C5.200 12.800 3 10.800 3 7.800v-4z", "M5.600 8.100l1.700 1.700 3.100-3.400"],
  sign: ["M3 12.500h10", "M4 10.500l6.500-6.500 1.500 1.500-6.500 6.500H4z"],
  code: ["M6 4.500L2.500 8 6 11.500M10 4.500L13.500 8 10 11.500"],
  more: ["M3.500 8h.01", "M8 8h.01", "M12.500 8h.01"],
  chevR: ["M6 3.500L10.500 8 6 12.500"],
  chevD: ["M3.500 6L8 10.500 12.500 6"],
  folder: ["M2.500 4.500a1 1 0 011-1h3l1.500 1.500h4.500a1 1 0 011 1v5.500a1 1 0 01-1 1h-9a1 1 0 01-1-1z"],
  warn: ["M8 2.500l6 10.500H2z", "M8 6.500v3M8 11.200h.01"],
  x: ["M4 4l8 8M12 4l-8 8"],
  fit: ["M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3"],
  panel: ["M2.500 3.500h11v9h-11z", "M9.500 3.500v9"],
  key: ["M6 9.500a3 3 0 110-6 3 3 0 010 6z", "M8.200 7.800L13 12.500M11 10.500l1.500 1.500"],
  flask: ["M6.500 2.500h3M7 2.500v4L3.800 12a1 1 0 00.9 1.500h6.600a1 1 0 00.9-1.500L9 6.500v-4"],
  users: ["M6 7.500a2 2 0 100-4 2 2 0 000 4z", "M2.500 12.500c.4-2 1.800-3 3.500-3s3.100 1 3.500 3", "M10.500 7a1.600 1.600 0 100-3.200", "M11 9.600c1.300.2 2.200 1 2.500 2.400"],
  check: ["M3.500 8.500l3 3 6-7"],
  sparkle: ["M8 2.500l1.200 3.300L12.500 7l-3.300 1.200L8 11.500 6.800 8.200 3.500 7l3.300-1.200z"],
} as const satisfies Record<string, readonly string[]>;
export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, size = 15, color = "var(--ink-3)" }: { name: GlyphName | IconKey; size?: number; color?: string }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const d = (PATHS as Record<string, readonly string[]>)[name] ?? PATHS.record;
  return createElement(
    "svg",
    { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: name === "more" ? 2.4 : 1.4, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } },
    ...d.map((p) => createElement("path", { key: p, d: p })),
  );
}
