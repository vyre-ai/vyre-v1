// Shared pieces of the Files tree and list: stroke icons by kind, small buttons, where a press landed. Colours are skin tokens, so a skin switch repaints with no re-render.
import { createElement } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet } from "react-native";
import type { FileKind } from "./model.ts";

/** 16 px viewBox stroke icons, from the prototype's Files. */
export const ICON = {
  folder: ["M2.5 4.5a1 1 0 011-1h3l1.5 1.5h4.5a1 1 0 011 1v6a1 1 0 01-1 1h-9a1 1 0 01-1-1z"],
  file: ["M4 2.5h5l3.5 3.5v7a1 1 0 01-1 1h-7.5a1 1 0 01-1-1v-9.5a1 1 0 011-1z", "M9 2.5V6h3.5"],
  doc: ["M4 2.5h5l3.5 3.5v7a1 1 0 01-1 1h-7.5a1 1 0 01-1-1v-9.5a1 1 0 011-1z", "M9 2.5V6h3.5", "M5.5 8.5h5M5.5 10.5h5"],
  sheet: ["M3.5 2.5h9a1 1 0 011 1v9a1 1 0 01-1 1h-9a1 1 0 01-1-1v-9a1 1 0 011-1z", "M2.5 6h11M2.5 9.5h11M6.5 6v7.5"],
  slides: ["M3 3.5h10a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1v-6a1 1 0 011-1z", "M6 14h4M8 11.5V14"],
  image: ["M3.5 2.5h9a1 1 0 011 1v9a1 1 0 01-1 1h-9a1 1 0 01-1-1v-9a1 1 0 011-1z", "M2.5 10.5l3-3 3 3 2-2 3 3", "M6 6h.01"],
  video: ["M3 4h7a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1z", "M11 7l3-1.5v5L11 9"],
  audio: ["M6 11.5V4.5l6-1.5v7", "M6 11.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z", "M12 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"],
  code: ["M5.5 5L2.5 8l3 3M10.5 5l3 3-3 3M9 3.5l-2 9"],
  archive: ["M3 3.5h10v3H3z", "M3.5 6.5v6a1 1 0 001 1h7a1 1 0 001-1v-6", "M6.5 9h3"],
  clock: ["M13.5 8a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z", "M8 5v3l2 1.5"],
  users: ["M8 5.5a2.3 2.3 0 11-4.6 0 2.3 2.3 0 014.6 0z", "M1.8 13a4.2 4.2 0 018.4 0", "M10.5 3.5a2.3 2.3 0 010 4.4", "M12 9.2a4.2 4.2 0 012.2 3.8"],
  trash: ["M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"],
  memory: ["M8 2.5c-2.5 0-4.5 1.6-4.5 3.8 0 1 .4 1.8 1 2.4V12a1 1 0 001 1h5a1 1 0 001-1V8.7c.6-.6 1-1.4 1-2.4C12.5 4.1 10.5 2.5 8 2.5z", "M6.5 7.5h3M8 6v3"],
  graph: ["M8 3a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM3.5 10a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM12.5 10a1.5 1.5 0 100 3 1.5 1.5 0 000-3z", "M7.2 5.8L4.3 10M8.8 5.8l2.9 4.2M5 11.5h6"],
  chevd: ["M3.5 6l4.5 4.5L12.5 6"],
  sortAsc: ["M8 3.5v9M4.5 7L8 3.5 11.5 7"],
  sortDesc: ["M8 12.5v-9M4.5 9L8 12.5 11.5 9"],
  check: ["M3 8.5l3 3 7-7"],
  link: ["M6.8 9.2a2.6 2.6 0 003.7 0l2-2a2.6 2.6 0 00-3.7-3.7l-.6.6", "M9.2 6.8a2.6 2.6 0 00-3.7 0l-2 2a2.6 2.6 0 003.7 3.7l.6-.6"],
  x: ["M4 4l8 8M12 4l-8 8"],
  plus: ["M8 3v10M3 8h10"],
  list: ["M5.5 4h8M5.5 8h8M5.5 12h8", "M2.8 4h.01M2.8 8h.01M2.8 12h.01"],
  grid: ["M3.7 2.5h2.1a1.2 1.2 0 011.2 1.2v2.1a1.2 1.2 0 01-1.2 1.2H3.7a1.2 1.2 0 01-1.2-1.2V3.7a1.2 1.2 0 011.2-1.2z", "M10.2 2.5h2.1a1.2 1.2 0 011.2 1.2v2.1a1.2 1.2 0 01-1.2 1.2h-2.1A1.2 1.2 0 019 5.8V3.7a1.2 1.2 0 011.2-1.2z", "M3.7 9h2.1A1.2 1.2 0 017 10.2v2.1a1.2 1.2 0 01-1.2 1.2H3.7a1.2 1.2 0 01-1.2-1.2v-2.1A1.2 1.2 0 013.7 9z", "M10.2 9h2.1a1.2 1.2 0 011.2 1.2v2.1a1.2 1.2 0 01-1.2 1.2h-2.1A1.2 1.2 0 019 12.3v-2.1A1.2 1.2 0 0110.2 9z"],
  chev: ["M6 3.5L10.5 8 6 12.5"],
  sort: ["M5 3v10M2.5 10.5L5 13l2.5-2.5", "M11 13V3M8.5 5.5L11 3l2.5 2.5"],
} as const;
export type IconName = keyof typeof ICON;

const KIND_ICON: Record<FileKind | "folder", IconName> = {
  folder: "folder", text: "doc", markdown: "doc", document: "doc", spreadsheet: "sheet", presentation: "slides", pdf: "doc", image: "image", video: "video", audio: "audio", code: "code",
  archive: "archive", google_native: "doc", other: "file",
};
export const iconOfKind = (k: FileKind | "folder"): IconName => KIND_ICON[k];

/** One stroke icon. Web only (an SVG); other platforms draw nothing until their own icon set lands. */
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

/** Where a press landed, so a menu opens under the pointer. A press without coordinates (the keyboard) opens at the top left of the window. */
export function pointOf(e: unknown): { x: number; y: number } {
  const n = (e as { nativeEvent?: { pageX?: number; pageY?: number } }).nativeEvent;
  const ok = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { x: ok(n?.pageX), y: ok(n?.pageY) };
}

/** A small icon button of a header. Hover paints the whole button. */
export function IconButton({ icon, label, onPress, on = false, testID }: { icon: IconName; label: string; onPress: (x: number, y: number) => void; on?: boolean; testID?: string }): ReactElement {
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }} testID={testID}
      onPress={(e) => { const p = pointOf(e); onPress(p.x, p.y); }}
      style={({ hovered }: { hovered?: boolean }) => [s.ib, (hovered === true || on) && s.ibOver]}
    >
      <Glyph name={icon} size={15} color={on ? "var(--accent)" : "var(--ink-2)"} />
    </Pressable>
  );
}

export const s = StyleSheet.create({
  ib: { height: 28, minWidth: 28, paddingHorizontal: 6, borderRadius: 7, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  ibOver: { backgroundColor: "var(--hover)" as string },
});
