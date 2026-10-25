// Icons of the contact tab, drawn like the sidebar's (16 px viewBox strokes from the prototype's Inbox). The sidebar set has the channel icons; these are the rest.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";

export const PATHS = {
  mail: ["M4 3.5h8a2 2 0 012 2v5a2 2 0 01-2 2H4a2 2 0 01-2-2v-5a2 2 0 012-2z", "M2.5 5l5.5 4 5.5-4"],
  sms: ["M3 4.5A1.5 1.5 0 014.5 3h7A1.5 1.5 0 0113 4.5v5a1.5 1.5 0 01-1.5 1.5H7l-3 2.5V11h-.5A1.5 1.5 0 013 9.5z"],
  call: ["M3.2 2.8h2.3l1 2.8-1.3.9a8 8 0 003.4 3.4l.9-1.3 2.8 1v2.3c0 .6-.5 1.1-1.1 1.1A9.8 9.8 0 012.1 3.9c0-.6.5-1.1 1.1-1.1z"],
  vm: ["M4.5 10.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z", "M11.5 10.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z", "M4.5 10.5h7"],
  cal: ["M4.5 3.5h7a2 2 0 012 2v6a2 2 0 01-2 2h-7a2 2 0 01-2-2v-6a2 2 0 012-2z", "M2.5 6.5h11M5.5 2v3M10.5 2v3"],
  bell: ["M4 11V7.4a4 4 0 018 0V11l1.2 1.6H2.8z", "M6.4 14a1.7 1.7 0 003.2 0"],
  link: ["M6.8 9.2a2.6 2.6 0 003.7 0l2-2a2.6 2.6 0 00-3.7-3.7l-.6.6", "M9.2 6.8a2.6 2.6 0 00-3.7 0l-2 2a2.6 2.6 0 003.7 3.7l.6-.6"],
  flag: ["M3.5 14V2.5M3.5 3h8l-1.7 2.6L11.5 8h-8"],
  more: ["M3.5 8h.01", "M8 8h.01", "M12.5 8h.01"],
  chevd: ["M3.5 6l4.5 4.5L12.5 6"],
  chevr: ["M6 3.5l4.5 4.5L6 12.5"],
  check: ["M3 8.5l3 3 7-7"],
  shield: ["M8 2l5 1.8v3.7c0 3-2.2 5.2-5 6.5-2.8-1.3-5-3.5-5-6.5V3.8z", "M5.8 8l1.7 1.7 2.9-3.2"],
  play: ["M5 3.2l7 4.8-7 4.8z"],
  stop: ["M4.5 4.5h7v7h-7z"],
  file: ["M4 2h5l3 3v9H4z", "M9 2v3h3"],
  clip: ["M13 7.5L7.8 12.7a3 3 0 01-4.2-4.2l5.5-5.5a2 2 0 012.8 2.8L6.4 11.3a1 1 0 01-1.4-1.4l4.8-4.8"],
  up: ["M8 13V3M3.5 7.5L8 3l4.5 4.5"],
  edit: ["M3 13h2.2L12.6 5.6a1.5 1.5 0 000-2.1l-.1-.1a1.5 1.5 0 00-2.1 0L3 10.8z", "M9.2 4.6l2.2 2.2"],
  x: ["M4 4l8 8M12 4l-8 8"],
  ask: ["M8 2.5l1.2 3.3 3.3 1.2-3.3 1.2L8 11.5 6.8 8.2 3.5 7l3.3-1.2z"],
} as const;
export type IconName = keyof typeof PATHS;
const FILLED: ReadonlySet<IconName> = new Set(["play", "stop"]);

/** One icon. Web only (an SVG); other platforms draw nothing until their own icon set lands. */
export function Icon({ name, size = 15, color = "var(--ink-3)" }: { name: IconName; size?: number; color?: string }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const filled = FILLED.has(name);
  const paths: ReactElement[] = [];
  for (const d of PATHS[name]) paths.push(createElement("path", { key: d, d, fill: filled ? color : "none" }));
  return createElement(
    "svg",
    { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: name === "more" ? 2.4 : 1.4, strokeLinecap: "round", strokeLinejoin: "round" } },
    ...paths,
  );
}
