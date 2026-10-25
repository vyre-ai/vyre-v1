// Icons of the runbook viewer, from the prototype's Files (vyre-v1.html, runbooks): 16 px stroke icons plus the filled run and stop marks.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";

export const ICON = {
  play: ["M5.2 3.6v8.8l7-4.4z"],
  stop: ["M6 4.5h4A1.5 1.5 0 0111.5 6v4a1.5 1.5 0 01-1.5 1.5H6A1.5 1.5 0 014.5 10V6A1.5 1.5 0 016 4.5z"],
  chevr: ["M6 3.5L10.5 8 6 12.5"],
  chevd: ["M3.5 6l4.5 4.5L12.5 6"],
  server: ["M3.7 2.5h8.6a1.2 1.2 0 011.2 1.2v1.8a1.2 1.2 0 01-1.2 1.2H3.7A1.2 1.2 0 012.5 5.5V3.7a1.2 1.2 0 011.2-1.2z", "M3.7 9h8.6a1.2 1.2 0 011.2 1.2V12a1.2 1.2 0 01-1.2 1.2H3.7A1.2 1.2 0 012.5 12v-1.8A1.2 1.2 0 013.7 9z", "M5 4.7h.01M5 11.2h.01"],
  copy: ["M6.8 5h5.9a.8.8 0 01.8.8v5.9a.8.8 0 01-.8.8H6.8a.8.8 0 01-.8-.8V5.8a.8.8 0 01.8-.8z", "M11 5V3.8A1.3 1.3 0 009.7 2.5H3.8A1.3 1.3 0 002.5 3.8v5.9A1.3 1.3 0 003.8 11H5"],
  eye: ["M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z", "M10 8a2 2 0 11-4 0 2 2 0 014 0z"],
  erase: ["M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.5 7l3 3.5M9.5 7l-3 3.5"],
} as const;
export type IconName = keyof typeof ICON;

const FILLED: readonly IconName[] = ["play", "stop"];

export function Glyph({ name, size = 15, color = "var(--ink-3)", width = 1.4 }: { name: IconName; size?: number; color?: string; width?: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const filled = FILLED.includes(name);
  const paths: ReactElement[] = [];
  for (const d of ICON[name]) paths.push(createElement("path", { key: d, d, fill: filled ? color : "none" }));
  return createElement(
    "svg",
    { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: filled ? "none" : color, strokeWidth: width, strokeLinecap: "round", strokeLinejoin: "round" } },
    ...paths,
  );
}
