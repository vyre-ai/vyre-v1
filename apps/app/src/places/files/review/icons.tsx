// Stroke icons of the review surfaces, from the prototype's diff tab and git strip: 16 px viewBox, drawn as inline SVG on web. Colours are skin tokens.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";

export const ICON = {
  branch: ["M6 3.8a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z", "M6 12.2a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z", "M13 5.8a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z", "M4.5 5.3v5.4M11.5 7.3c0 2.2-2.4 2.6-7 3.6"],
  shield: ["M8 2l5 1.8v3.6c0 3-2 5.3-5 6.6-3-1.3-5-3.6-5-6.6V3.8z"],
  check: ["M3 8.5l3 3 7-7"],
  chevd: ["M3.5 6l4.5 4.5L12.5 6"],
  chev: ["M6 3.5L10.5 8 6 12.5"],
  more: ["M3.5 8h.01M8 8h.01M12.5 8h.01"],
  pull: ["M8 2.5v8M4.500 7.5L8 11l3.5-3.5M3 13.5h10"],
  push: ["M8 13.5v-8M4.500 8.5L8 5l3.5 3.5M3 2.5h10"],
  sync: ["M13 6a5 5 0 00-9-1.500M3 2.5v2.5h2.5", "M3 10a5 5 0 009 1.500M13 13.5V11h-2.5"],
  restore: ["M3 8a5 5 0 105-5M3 3.5V8h4.500"],
  tag: ["M2.5 8.5V3.5h5l6 6-5 5z", "M5.500 6h.01"],
  compare: ["M5 3v10M11 3v10M2.5 6H5M2.5 10H5M11 6h2.5M11 10h2.5"],
  search: ["M11.5 7a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z", "M10.5 10.5L14 14"],
  info: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M8 7.5v3.5M8 5.2h.01"],
  history: ["M13.5 8a5.5 5.5 0 11-1.6-3.9", "M13 2.5v2.8h-2.8", "M8 5v3l2 1.5"],
  warn: ["M8 2.5l6 10.5H2z", "M8 6.5v3M8 11.5h.01"],
} as const;
export type IconName = keyof typeof ICON;

/** One stroke icon. Web only (an SVG); other platforms draw nothing until their own icon set lands. */
export function Glyph({ name, size = 14, color = "var(--ink-3)", width = 1.4 }: { name: IconName; size?: number; color?: string; width?: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const paths: ReactElement[] = [];
  for (const d of ICON[name]) paths.push(createElement("path", { key: d, d, fill: "none" }));
  return createElement(
    "svg",
    { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: width, strokeLinecap: "round", strokeLinejoin: "round" } },
    ...paths,
  );
}
