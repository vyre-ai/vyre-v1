// The marks of the video services on a Join button (the prototype's, lane l-calevents): Google Meet, Zoom, Teams, Webex, Whereby, Around, and a plain camera for any other.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform } from "react-native";
import type { VideoProvider } from "./join.ts";

type Shape = ["path", Record<string, string | number>] | ["rect", Record<string, string | number>] | ["circle", Record<string, string | number>];
const MARKS: Readonly<Record<VideoProvider, readonly Shape[]>> = {
  meet: [
    ["path", { fill: "#00832d", d: "M2 7.5A1.5 1.5 0 013.5 6H14v12H3.5A1.5 1.5 0 012 16.5z" }], ["path", { fill: "#0066da", d: "M2 7.5L6 6v12l-4-1.5z" }],
    ["path", { fill: "#ffba00", d: "M14 6h3a1 1 0 011 1v3l-4 2z" }], ["path", { fill: "#00ac47", d: "M18 14v3a1 1 0 01-1 1h-3v-6z" }], ["path", { fill: "#00832d", d: "M18 10l4-3v10l-4-3z" }],
  ],
  zoom: [["rect", { width: 24, height: 24, rx: 6, fill: "#0b5cff" }], ["path", { fill: "#fff", d: "M5 8.5A1.5 1.5 0 016.5 7h7A1.5 1.5 0 0115 8.5v7a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 015 15.5z" }], ["path", { fill: "#fff", d: "M16 10.5l3-2.2v7.4l-3-2.2z" }]],
  teams: [["rect", { x: 7, y: 4, width: 14, height: 16, rx: 3, fill: "#7b83eb" }], ["rect", { x: 2, y: 7, width: 12, height: 10, rx: 2, fill: "#4b53bc" }], ["path", { fill: "#fff", d: "M5 9.5h6v1.5H8.8V15H7.2v-4H5z" }]],
  webex: [["circle", { cx: 12, cy: 12, r: 11, fill: "#07c160" }], ["circle", { cx: 12, cy: 12, r: 6, fill: "none", stroke: "#fff", "stroke-width": 2.4 }]],
  whereby: [["rect", { width: 24, height: 24, rx: 6, fill: "#4a1e3a" }], ["path", { fill: "none", stroke: "#fff", "stroke-width": 2, "stroke-linecap": "round", d: "M6 9l2.5 7L12 9l3.5 7L18 9" }]],
  around: [["circle", { cx: 12, cy: 12, r: 11, fill: "#ff6b35" }], ["circle", { cx: 12, cy: 12, r: 4.5, fill: "#fff" }]],
  other: [["path", { fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linejoin": "round", d: "M4 7.5h10a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 15V9A1.5 1.5 0 014 7.5zM15.5 11l5-3v8l-5-3" }]],
};

export function BrandMark({ provider, size = 18 }: { provider: VideoProvider; size?: number }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const kids = MARKS[provider].map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }));
  return createElement("svg", { viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": true, "data-mark": provider, style: { display: "block", flex: "none" } }, ...kids);
}
