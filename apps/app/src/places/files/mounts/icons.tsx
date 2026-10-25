// Icons and provider marks of the mount sheet, from the prototype's Files (vyre-v1.html, mounts): 16 px stroke icons, the Google Drive, Microsoft 365 and GitHub marks.
// Web draws inline SVG; other platforms draw an empty box of the same size until their own icon set lands.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform, View } from "react-native";

export const ICON = {
  chev: ["M6 3.5L10.5 8 6 12.5"],
  chevd: ["M3.5 6l4.5 4.5L12.5 6"],
  back: ["M10 3L5 8l5 5"],
  x: ["M4 4l8 8M12 4l-8 8"],
  check: ["M3 8.5l3 3 7-7"],
  search: ["M11.5 7a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z", "M10.5 10.5L14 14"],
  folder: ["M2.5 5a1.5 1.5 0 011.5-1.5h2.5l1.5 1.5h4A1.5 1.5 0 0113.5 6.5V12a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 12z"],
  laptop: ["M4.2 3.5h7.6a1.2 1.2 0 011.2 1.2v5.6a1.2 1.2 0 01-1.2 1.2H4.2A1.2 1.2 0 013 10.3V4.7a1.2 1.2 0 011.2-1.2z", "M1.5 12.5h13"],
  lock: ["M5 7h6a1.5 1.5 0 011.5 1.5V12A1.5 1.5 0 0111 13.5H5A1.5 1.5 0 013.5 12V8.5A1.5 1.5 0 015 7z", "M5.5 7V5a2.5 2.5 0 015 0v2"],
  team: ["M8.3 6a2.3 2.3 0 11-4.6 0 2.3 2.3 0 014.6 0z", "M2 13c.5-2.3 2.1-3.5 4-3.5s3.5 1.2 4 3.5", "M13.3 6.5a1.8 1.8 0 11-3.6 0 1.8 1.8 0 013.6 0z", "M11.5 9.5c1.4 0 2.4.9 2.8 2.5"],
  branch: ["M6 3.8a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z", "M6 12.2a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z", "M13 5.8a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z", "M4.5 5.3v5.4M11.5 7.3c0 2.2-2.4 2.6-7 3.6"],
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

const GOOGLE_DRIVE = "M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z";
const GITHUB = "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12";

export type MarkKind = "google_drive" | "microsoft" | "local" | "github";

/** The provider mark: Google Drive green, the four Microsoft squares, the GitHub cat in ink, a laptop for this computer. */
export function Mark({ kind, size = 20 }: { kind: MarkKind; size?: number }): ReactElement {
  const box = { width: size, height: size, alignItems: "center" as const, justifyContent: "center" as const, flexShrink: 0 };
  if (Platform.OS !== "web") return <View style={box} aria-hidden />;
  const svg = (children: ReactElement[]): ReactElement =>
    createElement("svg", { viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": true, style: { display: "block" } }, ...children);
  let inner: ReactElement | null;
  if (kind === "google_drive") inner = svg([createElement("path", { key: "p", fill: "#1A9E6A", d: GOOGLE_DRIVE })]);
  else if (kind === "github") inner = svg([createElement("path", { key: "p", fill: "var(--ink)", d: GITHUB })]);
  else if (kind === "microsoft") {
    inner = svg([
      createElement("rect", { key: "a", x: 2.5, y: 2.5, width: 9, height: 9, fill: "#F25022" }),
      createElement("rect", { key: "b", x: 12.5, y: 2.5, width: 9, height: 9, fill: "#7FBA00" }),
      createElement("rect", { key: "c", x: 2.5, y: 12.5, width: 9, height: 9, fill: "#00A4EF" }),
      createElement("rect", { key: "d", x: 12.5, y: 12.5, width: 9, height: 9, fill: "#FFB900" }),
    ]);
  } else inner = <Glyph name="laptop" size={size} color="var(--ink)" />;
  return <View style={box} testID={`mark-${kind}`}>{inner}</View>;
}
