// Join colours (spec 3.13, ARCH 7.13): the pages follow the platform's own look, not the Space skin, so they use the system palette
// (iOS and macOS system colours) in light and dark. One accent, the system blue. The mode comes from the document the theme boot marked
// (data-mode or data-theme), else from the operating system.
import { useSyncExternalStore } from "react";
import { useColorScheme } from "react-native";

export interface JoinPalette {
  bg: string; tx: string; tx2: string; grp: string; hair: string; blue: string; green: string; red: string;
  sheet: string; warn: string; sw: string; back: string; panel: string; cam: string;
}
export type JoinMode = "light" | "dark";

export const LIGHT: JoinPalette = {
  bg: "#FFFFFF", tx: "#1D1D1F", tx2: "#6E6E73", grp: "#F2F2F7", hair: "rgba(60,60,67,.22)", blue: "#007AFF", green: "#34C759", red: "#FF3B30",
  sheet: "#FFFFFF", warn: "#FF9500", sw: "#E9E9EA", back: "#E9E9EF", panel: "#FFFFFF", cam: "#FFFFFF",
};
export const DARK: JoinPalette = {
  bg: "#1C1C1E", tx: "#F5F5F7", tx2: "#98989D", grp: "#2C2C2E", hair: "rgba(84,84,88,.55)", blue: "#0A84FF", green: "#30D158", red: "#FF453A",
  sheet: "#2C2C2E", warn: "#FF9F0A", sw: "#39393D", back: "#0B0B0D", panel: "#1C1C1E", cam: "#3A3A3C",
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
