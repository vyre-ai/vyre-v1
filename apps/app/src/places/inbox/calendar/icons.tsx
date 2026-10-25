// Icons of the Calendar (16 px viewBox strokes from the prototype's Inbox).
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";

export const PATHS = {
  chevr: ["M6 3.5l4.5 4.5L6 12.5"],
  chevl: ["M10 3.5L5.5 8l4.5 4.5"],
  chevd: ["M3.5 6l4.5 4.5L12.5 6"],
  plus: ["M8 3v10M3 8h10"],
  users: ["M8 5.5a2.3 2.3 0 11-4.6 0 2.3 2.3 0 014.6 0z", "M1.8 13a4.2 4.2 0 018.4 0", "M10.5 3.5a2.3 2.3 0 010 4.4", "M12 9.2a4.2 4.2 0 012.2 3.8"],
  cal: ["M4.5 3.5h7a2 2 0 012 2v6a2 2 0 01-2 2h-7a2 2 0 01-2-2v-6a2 2 0 012-2z", "M2.5 6.5h11M5.5 2v3M10.5 2v3"],
  spark: ["M8 2.5l1.2 3.3 3.3 1.2-3.3 1.2L8 11.5 6.8 8.2 3.5 7l3.3-1.2z"],
  lock: ["M5 7h6a1 1 0 011 1v4.5a1 1 0 01-1 1H5a1 1 0 01-1-1V8a1 1 0 011-1z", "M5.5 7V5a2.5 2.5 0 015 0v2"],
  link: ["M6.8 9.2a2.6 2.6 0 003.7 0l2-2a2.6 2.6 0 00-3.7-3.7l-.6.6", "M9.2 6.8a2.6 2.6 0 00-3.7 0l-2 2a2.6 2.6 0 003.7 3.7l.6-.6"],
  inbox: ["M2.5 9.5l1.6-5.2a1.5 1.5 0 011.4-1.1h5a1.5 1.5 0 011.4 1.1l1.6 5.2V12a1.5 1.5 0 01-1.5 1.5h-8A1.5 1.5 0 012.5 12z", "M2.5 9.5h3l1 1.5h3l1-1.5h3"],
  x: ["M4 4l8 8M12 4l-8 8"],
  check: ["M3 8.5l3 3 7-7"],
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 15, color = "var(--ink-3)" }: { name: IconName; size?: number; color?: string }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const paths: ReactElement[] = [];
  for (const d of PATHS[name]) paths.push(createElement("path", { key: d, d, fill: "none" }));
  return createElement(
    "svg",
    { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } },
    ...paths,
  );
}
