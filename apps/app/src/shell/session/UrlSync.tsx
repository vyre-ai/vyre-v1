// The URL carries both the place and its item. The browser's Back and Forward, the keys, the mouse buttons and the swipe all run the tab's own Back and Forward
// (history-bridge.ts); a copied link or a hand-edited address opens its place and item through the same hub navigation as opening an item inside a place.
import { useEffect } from "react";
import type { ShellHub } from "../spaces/hub.ts";
import { startHistoryBridge } from "./history-bridge.ts";
import { startNavInput } from "./nav-input.ts";
import type { BridgeWindow } from "./history-bridge.ts";

export function UrlSync({ hub }: { hub: ShellHub }): null {
  useEffect(() => {
    if (typeof window === "undefined" || !window.location) return undefined;
    const stopBridge = startHistoryBridge(hub, window as unknown as BridgeWindow);
    const desktop = (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
    const stopInput = startNavInput(hub, document, { desktop });
    return () => {
      stopBridge();
      stopInput();
    };
  }, [hub]);
  return null;
}
