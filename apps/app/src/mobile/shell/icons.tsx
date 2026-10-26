// The tab bar's stroke icons (16 px grid, skin tokens for colour).
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";

const PATHS = {
  chats: ["M3 4.5A2 2 0 015 2.5h6a2 2 0 012 2v4.5a2 2 0 01-2 2H7l-3 2.500V11a2 2 0 01-1-1.700z"],
  inbox: ["M2.500 9l1.800-5.500h7.400L13.500 9v3.500h-11z", "M2.500 9h3.200l.8 1.600h3l.8-1.600h3.200"],
  records: ["M2.500 3.500h11v9h-11z", "M2.500 7h11M6.500 3.500v9"],
  files: ["M2.500 4.500a1 1 0 011-1h3l1.500 1.500h4.500a1 1 0 011 1v6.500a1 1 0 01-1 1h-9a1 1 0 01-1-1z"],
  you: ["M8 8a2.800 2.800 0 100-5.600A2.800 2.800 0 008 8z", "M2.800 13.500c.4-2.400 2.500-3.800 5.200-3.800s4.800 1.400 5.200 3.800"],
  chev: ["M6 4l4 4-4 4"],
  back: ["M9.500 3.500L5 8l4.500 4.500"],
  star: ["M8 2.200l1.800 3.700 4 .6-2.900 2.800.7 4L8 11.400 4.400 13.300l.7-4L2.200 6.500l4-.6z"],
  work: ["M3 8.500l3 3 7-7"],
  settings: ["M8 10.200a2.200 2.200 0 100-4.400 2.200 2.200 0 000 4.400z", "M8 1.800v1.600M8 12.600v1.600M1.800 8h1.600M12.600 8h1.600M3.600 3.600l1.100 1.100M11.300 11.300l1.100 1.100M12.400 3.600l-1.100 1.100M4.700 11.300l-1.100 1.100"],
} as const;
export type MobileIcon = keyof typeof PATHS;

export function Icon({ name, size = 22, color = "var(--ink-3)", width = 1.4 }: { name: MobileIcon; size?: number; color?: string; width?: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const paths: ReactElement[] = [];
  for (const d of PATHS[name]) paths.push(createElement("path", { key: d, d, fill: "none" }));
  return createElement("svg", { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", stroke: color, strokeWidth: width, strokeLinecap: "round", strokeLinejoin: "round" } }, ...paths);
}
