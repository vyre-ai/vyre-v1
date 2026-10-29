// Stroke icons for the rail and the title bar. Paths follow the prototype's place icons (16 px grid, 1.5 stroke); the colour is the current text colour.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";

const sq = (x: number, y: number): string => `M${x + 1.2} ${y}h2.1a1.2 1.2 0 011.2 1.2v2.1a1.2 1.2 0 01-1.2 1.2h-2.1a1.2 1.2 0 01-1.2-1.2v-2.1a1.2 1.2 0 011.2-1.2z`;

export type ShellIconName =
  | "home" | "chats" | "inbox" | "records" | "files" | "apps" | "automations" | "vault" | "settings" | "console" | "join"
  | "moon" | "search" | "chev" | "sync" | "cloudOff" | "user" | "userPlus" | "signOut" | "terminal" | "check" | "more" | "lock";

export const SHELL_ICONS: Readonly<Record<ShellIconName, readonly string[]>> = {
  lock:["M5 7V5a3 3 0 016 0v2","M4 7h8a1 1 0 011 1v5a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z","M8 10v1"],
  home: ["M2.5 7.5L8 3l5.5 4.5V13a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5z", "M6.5 13.5v-4h3v4"],
  chats: ["M3 3.5h10a1 1 0 011 1v6a1 1 0 01-1 1H7l-3 2.5v-2.5H3a1 1 0 01-1-1v-6a1 1 0 011-1z"],
  inbox: ["M2.5 9.5l1.6-5.2a1 1 0 011-.8h5.8a1 1 0 011 .8l1.6 5.2V12a1 1 0 01-1 1h-9a1 1 0 01-1-1z", "M2.5 9.5h3l1 1.5h3l1-1.5h3"],
  records: ["M4 2.5h8A1.5 1.5 0 0113.5 4v8a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 12V4A1.5 1.5 0 014 2.5z", "M2.5 6h11M2.5 9.5h11M6.5 6v7.5"],
  files: ["M2.5 4.5a1 1 0 011-1h3l1.5 1.5h4.5a1 1 0 011 1v6.5a1 1 0 01-1 1h-9a1 1 0 01-1-1z"],
  apps: [sq(2.5, 2.5), sq(9, 2.5), sq(2.5, 9), sq(9, 9)],
  automations: ["M9 2L4 9h4l-1 5 5-7H8z"],
  vault: ["M4.5 7h7A1.5 1.5 0 0113 8.5V12a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 12V8.5A1.5 1.5 0 014.5 7z", "M5.5 7V5a2.5 2.5 0 015 0v2"],
  settings: ["M6 8a2 2 0 104 0 2 2 0 10-4 0", "M8 1.8v1.7M8 12.5v1.7M14.2 8h-1.7M3.5 8H1.8M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2M12.4 12.4l-1.2-1.2M4.8 4.8L3.6 3.6"],
  console: ["M3.5 3h9A1.5 1.5 0 0114 4.5v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 10.5v-6A1.5 1.5 0 013.5 3z", "M5 6.5l2 1.5-2 1.5M8.5 10h2.5"],
  join: ["M8 3v10M3 8h10"],
  moon: ["M12.5 9.5A5 5 0 016.5 3.5a5 5 0 106 6z"],
  search: ["M7 11.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9z", "M10.5 10.5l3 3"],
  chev: ["M4 6l4 4 4-4"],
  sync: ["M13 8a5 5 0 01-8.7 3.3M3 8a5 5 0 018.7-3.3", "M12.5 2.5v2.5H10M3.5 13.5V11H6"],
  cloudOff: ["M2.5 2.5l11 11", "M5 10.5H4.5a2.5 2.5 0 01-.4-4.97A3.5 3.5 0 019 4.2M11.5 6.5a2.5 2.5 0 011 4.5H8"],
  user: ["M8 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5z", "M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4"],
  userPlus: ["M6 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5z", "M1.5 13.5c.5-2.3 2.3-3.5 4.5-3.5s4 1.2 4.5 3.5M12 5v4M10 7h4"],
  signOut: ["M6 3H3.5v10H6M10 5l3 3-3 3M13 8H6"],
  terminal: ["M3.5 3h9A1.5 1.5 0 0114 4.5v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 10.5v-6A1.5 1.5 0 013.5 3z", "M5 6.5l2 1.5-2 1.5M8.5 10h2.5"],
  check: ["M3.5 8.5l3 3 6-7"],
  more: ["M3.5 8h.01M8 8h.01M12.5 8h.01"],
};

/** The icon as an svg string, for ui/Menu items (which take an svg string as their icon). */
export function iconMarkup(name: ShellIconName): string {
  let paths = "";
  for (const d of SHELL_ICONS[name]) paths += `<path d="${d}"/>`;
  return `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

export function ShellIcon({ name, size = 19, color = "var(--ink-3)" }: { name: ShellIconName; size?: number; color?: string }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const paths: ReactElement[] = [];
  for (const d of SHELL_ICONS[name]) paths.push(createElement("path", { key: d, d }));
  return createElement(
    "svg",
    { viewBox: "0 0 16 16", width: size, height: size, "aria-hidden": true, style: { display: "block", flex: "none", fill: "none", stroke: color, strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } },
    ...paths,
  );
}
