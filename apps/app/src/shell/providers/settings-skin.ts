// Settings > Appearance: choosing a skin tile saved the setting and moved the preview, but nothing told the window, so the app stayed in the skin it was in (data-mode and data-theme unchanged).
// This applies the skin to the window at once, the way the title bar's skin menu does (the same theme controller, the same root attributes), and the saved setting follows.
import { createThemeController } from "../../../../../ui/src/theme/controller.ts";
import type { ShellRuntime } from "./runtime.tsx";

export function applySkinToWindow(rt: Pick<ShellRuntime, "me" | "space">, skin: string): boolean {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return false;
  const root = doc.documentElement;
  let storage: Storage | null = null;
  try { storage = globalThis.localStorage ?? null; } catch { /* blocked storage keeps the theme in this window */ }
  const theme = createThemeController({
    personId: rt.me.id, spaceId: rt.space.id, spaceSkin: { [rt.space.id]: root.getAttribute("data-skin") ?? "system" },
    prefersDark: globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false, storage,
    root: { setAttribute: (key, value) => root.setAttribute(key, value), setProperty: (key, value) => root.style.setProperty(key, value), removeProperty: (key) => root.style.removeProperty(key) },
  });
  theme.setSkin(skin);
  return true;
}
