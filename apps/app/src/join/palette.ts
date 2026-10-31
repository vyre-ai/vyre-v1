// Join colours (spec 3.13, ARCH 7.13): the pages follow the platform's own look, not the Space skin, so they use the system palette
// (iOS and macOS system colours) in light and dark. One accent, the system blue. The mode comes from the document the theme boot marked
// (data-mode or data-theme), else from the operating system.
import { useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";

export interface JoinPalette {
  bg: string; tx: string; tx2: string; tx3: string; grp: string; hair: string; blue: string; green: string; red: string;
  sheet: string; warn: string; sw: string; back: string; panel: string; cam: string; halftone: string; halftoneAccent: string;
  /** Text and marks on the accent colour. */
  accentInk: string;
  /** A tint of the accent for hover and selected surfaces, and its line. */
  accentWash: string; accentLine: string;
  /** A hover wash for neutral surfaces. */
  hover: string;
}
export type JoinMode = "light" | "dark";

// The Space skins' own colours (paper and graphite, ui/src/tokens/skins.ts), so the first screens look like the app they open: one violet accent, warm neutrals, text that holds contrast on its surface.
// `blue` is the accent (the name is older than the palette). Secondary text is ink-2; tx3 is for placeholders and quiet marks only.
export const LIGHT: JoinPalette = {
  bg: "#FFFFFF", tx: "#18181A", tx2: "#4E4E52", tx3: "#76767B", grp: "#F5F5F3", hair: "rgba(24,24,26,.14)", blue: "#5B5BD6", green: "#2F9461", red: "#C62F2F",
  sheet: "#FFFFFF", warn: "#A8631F", sw: "#E4E4E1", back: "#EEEEEB", panel: "#FFFFFF", cam: "#FFFFFF", halftone: "#5B5BD6", halftoneAccent: "#5B5BD6",
  accentInk: "#FFFFFF", accentWash: "rgba(91,91,214,.09)", accentLine: "rgba(91,91,214,.45)", hover: "rgba(24,24,26,.045)",
};
export const DARK: JoinPalette = {
  bg: "#1C1C1E", tx: "#EDEDEF", tx2: "#B9B9BE", tx3: "#8D8D93", grp: "#252528", hair: "rgba(255,255,255,.13)", blue: "#8B8BFF", green: "#4CC38A", red: "#F27A7A",
  sheet: "#2A2A2D", warn: "#E5A55C", sw: "#3A3A3F", back: "#0E0E0F", panel: "#1C1C1E", cam: "#3A3A3C", halftone: "#8B8BFF", halftoneAccent: "#8B8BFF",
  accentInk: "#15151A", accentWash: "rgba(139,139,255,.15)", accentLine: "rgba(139,139,255,.5)", hover: "rgba(255,255,255,.06)",
};

export const paletteOf = (mode: JoinMode): JoinPalette => (mode === "dark" ? DARK : LIGHT);

/** The mode the document was marked with before first paint, if any. */
export function documentMode(): JoinMode | null {
  const doc = (globalThis as { document?: { documentElement?: { getAttribute(n: string): string | null } } }).document;
  const root = doc?.documentElement;
  if (!root) return null;
  const v = root.getAttribute("data-mode") ?? root.getAttribute("data-theme");
  return v === "dark" || v === "light" ? v : null;
}

/** Re-reads the mode when the document's skin changes (a skin picked later, or the boot script marking the page after the static markup was made). */
function watchDocument(onChange: () => void): () => void {
  const root = (globalThis as { document?: { documentElement?: object } }).document?.documentElement;
  const Observer = (globalThis as { MutationObserver?: new (cb: () => void) => { observe(n: object, o: object): void; disconnect(): void } }).MutationObserver;
  if (!root || !Observer) return () => undefined;
  const mo = new Observer(onChange);
  mo.observe(root, { attributes: true, attributeFilter: ["data-mode", "data-theme"] });
  return () => mo.disconnect();
}

/** The mode of the page. The server snapshot is "nothing marked", so a pre-rendered page hydrates and then follows the document at once instead of keeping the light markup. */
export function useJoinMode(): JoinMode {
  const os = useColorScheme();
  const marked = useSyncExternalStore(watchDocument, documentMode, () => null);
  return marked ?? (os === "dark" ? "dark" : "light");
}

export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", sans-serif';
export const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
