// The live side of the theme: one controller per window. It resolves and writes the root synchronously
// (the skin changes in the same task as the click, across Spaces too), then persists in the background.
// Spec 3.9 Appearance (personal per Space), 3.0 title bar skin menu (instant; preview on hover or arrow).

import {
  APPEARANCE_KEY,
  applyToRoot,
  emptyStore,
  readStore,
  resolveTheme,
  toInput,
  withMode,
  withOpenSpace,
  withSkin,
  writeStore,
} from "./theme.ts";
import type { AppearanceStore, AppliedTheme, ModeChoice, Preview, ThemeRoot } from "./theme.ts";

/** localStorage on web, a secure-store wrapper on native. Both calls may throw (private window, cleared data): the theme never depends on them. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeControllerOptions {
  personId: string;
  spaceId: string;
  /** Each Space's skin default, from the Space record (spec 2.1 "skin default"). */
  spaceSkin: Readonly<Record<string, string>>;
  prefersDark: boolean;
  root: ThemeRoot;
  storage: ThemeStorage | null;
}

export interface ThemeController {
  current(): AppliedTheme;
  store(): AppearanceStore;
  /** Choose a skin for the open Space. Applies now, then saves. */
  setSkin(skin: string): AppliedTheme;
  setMode(mode: ModeChoice): AppliedTheme;
  /** Open another Space: its own skin (or its default) is on the root before the call returns. */
  switchSpace(spaceId: string): AppliedTheme;
  /** Show a skin without choosing it (menu hover or arrow). Nothing is stored. null ends the preview. */
  preview(preview: Preview | null): AppliedTheme;
  /** The device switched light or dark (matters for System only). */
  setPrefersDark(dark: boolean): AppliedTheme;
  subscribe(listener: (theme: AppliedTheme) => void): () => void;
}

export function createThemeController(options: ThemeControllerOptions): ThemeController {
  let prefersDark = options.prefersDark;
  let preview: Preview | null = null;
  let store = ((): AppearanceStore => {
    let raw: string | null = null;
    try {
      raw = options.storage ? options.storage.getItem(APPEARANCE_KEY) : null;
    } catch {
      raw = null;
    }
    const saved = readStore(raw);
    // Another person's choices are not this person's: start from nothing.
    const mine = saved && saved.personId === options.personId ? saved : emptyStore(options.personId, options.spaceId);
    return { ...withOpenSpace(mine, options.spaceId), spaceSkin: { ...options.spaceSkin } };
  })();
  let applied = resolveTheme(toInput(store, prefersDark, preview));
  applyToRoot(applied, options.root);
  const listeners = new Set<(theme: AppliedTheme) => void>();

  function persist(): void {
    try {
      options.storage?.setItem(APPEARANCE_KEY, writeStore(store));
    } catch {
      // Storage can be full or blocked. The choice still holds for this window.
    }
  }

  function paint(save: boolean): AppliedTheme {
    applied = resolveTheme(toInput(store, prefersDark, preview));
    applyToRoot(applied, options.root);
    if (save) persist();
    for (const listener of listeners) listener(applied);
    return applied;
  }

  // The first write also records the open Space, so the next head script finds it.
  persist();

  return {
    current: () => applied,
    store: () => store,
    setSkin(skin) {
      store = withSkin(store, store.spaceId, skin);
      preview = null;
      return paint(true);
    },
    setMode(mode) {
      store = withMode(store, store.spaceId, mode);
      return paint(true);
    },
    switchSpace(spaceId) {
      store = withOpenSpace(store, spaceId);
      preview = null;
      return paint(true);
    },
    preview(next) {
      preview = next;
      return paint(false);
    },
    setPrefersDark(dark) {
      prefersDark = dark;
      return paint(false);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
