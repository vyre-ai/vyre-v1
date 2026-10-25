// Attaches the shell keyboard map to the window (web and desktop). Phones have no hardware map; the hook does nothing there.
import { useEffect, useRef } from "react";
import { Platform as RNPlatform } from "react-native";
import { matchShortcut } from "./map.ts";
import type { KeyLike, Matched, Platform } from "./map.ts";

type Doc = {
  addEventListener(t: "keydown", f: (e: KeyLike & { target?: unknown; preventDefault(): void }) => void): void;
  removeEventListener(t: "keydown", f: (e: KeyLike & { target?: unknown; preventDefault(): void }) => void): void;
};

export function detectPlatform(): Platform {
  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator;
  return /Mac|iPhone|iPad/i.test(`${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`) ? "mac" : "other";
}

/** True when the key went to a terminal, where Cmd-K clears the screen. */
export function inTerminal(target: unknown): boolean {
  const t = target as { closest?: (s: string) => unknown } | null | undefined;
  return typeof t?.closest === "function" && t.closest("[data-terminal], .vy-term") != null;
}

export function useShellKeys(handle: (m: Matched) => boolean | void, platform: Platform = detectPlatform()): void {
  const ref = useRef(handle);
  ref.current = handle;
  useEffect(() => {
    if (RNPlatform.OS !== "web") return;
    const doc = (globalThis as { document?: Doc }).document;
    if (!doc) return;
    const on = (e: KeyLike & { target?: unknown; preventDefault(): void }): void => {
      const m = matchShortcut(e, platform, { inTerminal: inTerminal(e.target) });
      if (m && ref.current(m) !== false) e.preventDefault();
    };
    doc.addEventListener("keydown", on);
    return () => doc.removeEventListener("keydown", on);
  }, [platform]);
}
