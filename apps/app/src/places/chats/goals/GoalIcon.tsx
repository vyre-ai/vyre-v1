// The small line icons of the goal screens. Its own file so the goal card (drawn in a conversation) does not pull the whole goal page into the first screen (r41).
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";

/** Small line icons drawn the way the sidebar draws its own (web only; elsewhere the words carry it). */
const PATHS: Readonly<Record<string, readonly string[]>> = {
  target: ["M8 14a6 6 0 100-12 6 6 0 000 12z", "M8 11a3 3 0 100-6 3 3 0 000 6z", "M8 8.01V8"],
  clock: ["M8 14a6 6 0 100-12 6 6 0 000 12z", "M8 4.8V8l2.2 1.4"],
  cal: ["M3 4.5h10v8.5H3z", "M3 7h10", "M5.5 3v3M10.5 3v3"],
  pause: ["M6 4v8M10 4v8"],
  play: ["M5.5 3.8l6.5 4.2-6.5 4.2z"],
  edit: ["M10.8 2.7l2.5 2.5L6.5 12 3.5 12.5 4 9.5z"],
  plus: ["M8 3.5v9M3.5 8h9"],
  more: ["M3.5 8h.01", "M8 8h.01", "M12.5 8h.01"],
  warn: ["M8 2.5l6 10.5H2z", "M8 6.5v3M8 11.3v.01"],
  check: ["M3 8.5l3 3 7-7"],
  file: ["M4 2.5h5l3 3v8H4z", "M9 2.5v3h3"],
  folder: ["M2.5 4.5h4l1.5 1.5h5.5v7h-11z"],
};
export function Icon({
  name,
  size = 14,
  color = "var(--ink-3)",
}: {
  name: string;
  size?: number;
  color?: string;
}): ReactElement | null {
  if (Platform.OS !== "web") return null;
  return createElement(
    "svg",
    {
      viewBox: "0 0 16 16",
      width: size,
      height: size,
      "aria-hidden": true,
      style: {
        display: "block",
        flex: "none",
        fill: "none",
        stroke: color,
        strokeWidth: name === "more" ? 2.4 : 1.4,
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
    },
    ...(PATHS[name] ?? []).map((d) => createElement("path", { key: d, d })),
  );
}
