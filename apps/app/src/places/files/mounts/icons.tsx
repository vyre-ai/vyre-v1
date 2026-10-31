// Icons and provider marks of the mount sheet, from the prototype's Files (vyre-v1.html, mounts): 16 px stroke icons, the Google Drive, Microsoft 365 and GitHub marks.
// Web draws inline SVG; other platforms draw an empty box of the same size until their own icon set lands.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform, View } from "react-native";
import { AppIcon } from "../../../../../../ui/src/AppIcon/index.tsx";

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

export type MarkKind = "google_drive" | "microsoft" | "onedrive" | "sharepoint" | "local" | "github";

/** The provider mark: the real brand logo from ui/AppIcon (Google Drive, OneDrive, SharePoint, GitHub), a laptop for this computer. "microsoft" is the suite as a whole (the four squares). */
export function Mark({ kind, size = 20 }: { kind: MarkKind; size?: number }): ReactElement {
  if (kind === "local") {
    return <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", flexShrink: 0 }} testID="mark-local"><Glyph name="laptop" size={size * 0.8} color="var(--ink)" /></View>;
  }
  const brand = kind === "google_drive" ? "gdrive" : kind;
  const names: Record<string, string> = { gdrive: "Google Drive", onedrive: "OneDrive", sharepoint: "SharePoint", github: "GitHub", microsoft: "Microsoft 365" };
  return <View style={{ flexShrink: 0 }} testID={`mark-${kind}`}><AppIcon brand={brand} size={size} name={names[brand] ?? brand} testID={`mark-icon-${kind}`} /></View>;
}
