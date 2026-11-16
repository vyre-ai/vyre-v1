// The URL carries both the place and its item. The browser's Back and Forward, the keys, the mouse buttons and the swipe all run the tab's own Back and Forward
// (history-bridge.ts); a copied link or a hand-edited address opens its place and item through the same hub navigation as opening an item inside a place.
import { useEffect } from "react";
import type { ShellHub } from "../spaces/hub.ts";
import { startHistoryBridge } from "./history-bridge.ts";
import { startNavInput } from "./nav-input.ts";
import { startOpenHow } from "../tabs/open-how.ts";
import { startViewMemory } from "../tabs/view-memory.ts";
import type { BridgeWindow } from "./history-bridge.ts";

export function UrlSync({ hub }: { hub: ShellHub }): null {
  useEffect(() => {
    if (typeof window === "undefined" || !window.location) return undefined;
    const stopBridge = startHistoryBridge(hub, window as unknown as BridgeWindow);
    const desktop = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
    const stopInput = startNavInput(hub, document as unknown as Parameters<typeof startNavInput>[1], { desktop });
    const stopHow = startOpenHow(document as unknown as Parameters<typeof startOpenHow>[0]);
    const stopMemory = startViewMemory(
      document as unknown as Parameters<typeof startViewMemory>[0],
      () => {
        try {
          return { tab: hub.session().tabs.state().active, hash: hub.state().hash };
        } catch {
          return { tab: "", hash: "" };
        }
      },
      (l) => hub.subscribe(l),
    );
    return () => {
      stopMemory();
      stopBridge();
      stopInput();
      stopHow();
    };
  }, [hub]);
  return null;
}
