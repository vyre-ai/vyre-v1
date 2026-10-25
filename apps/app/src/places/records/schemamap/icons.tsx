// Icons of the Schema map and the Record types list, from the prototype's Records (vyre-v1.html): 16 px stroke icons.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";

export const ICON = {
  link: ["M7 9a2.8 2.8 0 004 0l2-2a2.8 2.8 0 00-4-4l-.7.7M9 7a2.8 2.8 0 00-4 0L3 9a2.8 2.8 0 004 4l.7-.7"],
  cal: ["M4.5 3.5h7A2 2 0 0113.5 5.5v6a2 2 0 01-2 2h-7a2 2 0 01-2-2v-6a2 2 0 012-2z", "M2.5 6.5h11M5.5 2v3M10.5 2v3"],
  choice: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M5.8 7l2.2 2.2L10.2 7"],
  person: ["M10.5 5.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z", "M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"],
  check: ["M5 2.5h6A2.5 2.5 0 0113.5 5v6a2.5 2.5 0 01-2.5 2.5H5A2.5 2.5 0 012.5 11V5A2.5 2.5 0 015 2.5z", "M5.5 8.2l1.8 1.8 3.2-3.4"],
  attach: ["M13 7.5l-5.3 5.3a3.2 3.2 0 01-4.5-4.5L8.9 2.6a2.1 2.1 0 013 3l-5.6 5.6a1 1 0 01-1.5-1.5L10 4.5"],
  lock: ["M5 7h6a1.5 1.5 0 011.5 1.5V12A1.5 1.5 0 0111 13.5H5A1.5 1.5 0 013.5 12V8.5A1.5 1.5 0 015 7z", "M5.5 7V5a2.5 2.5 0 015 0v2"],
  lookup: ["M3 8h8M8 4.5L11.5 8 8 11.5", "M13 3v10"],
  spark: ["M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2"],
  star: ["M8 2.5l1.7 3.5 3.8.5-2.8 2.6.7 3.8L8 11.1 4.6 12.9l.7-3.8L2.5 6.5l3.8-.5z"],
  plain: ["M3 4h10M3 8h10M3 12h6"],
  plus: ["M8 3.5v9M3.5 8h9"],
  minus: ["M3.5 8h9"],
  expand: ["M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9"],
  chev: ["M6 3.5L10.5 8 6 12.5"],
  schema: ["M3.5 2.5h2A1.5 1.5 0 017 4v1.5A1.5 1.5 0 015.5 7h-2A1.5 1.5 0 012 5.5V4a1.5 1.5 0 011.5-1.5z", "M10.5 9.5h2A1.5 1.5 0 0114 11v1.5a1.5 1.5 0 01-1.5 1.5h-2A1.5 1.5 0 019 12.5V11a1.5 1.5 0 011.5-1.5z", "M7 4.5h2.5A1.5 1.5 0 0111 6v3.5"],
  table: ["M4.5 3h7A2 2 0 0113.5 5v6a2 2 0 01-2 2h-7a2 2 0 01-2-2V5a2 2 0 012-2z", "M2.5 6.5h11M2.5 9.8h11M6.5 6.5V13"],
  open: ["M6.5 3.5H3.5v9h9v-3M9 3.5h3.5V7M12.5 3.5L7 9"],
} as const;
export type IconName = keyof typeof ICON;

export function Glyph({ name, size = 15, color = "var(--ink-3)", width = 1.4 }: { name: IconName; size?: number; color?: string; width?: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const paths: ReactElement[] = [];
  for (const d of ICON[name]) paths.push(createElement("path", { key: d, d, fill: "none" }));
  return createElement(
    "svg",
    { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: width, strokeLinecap: "round", strokeLinejoin: "round" } },
    ...paths,
  );
}
