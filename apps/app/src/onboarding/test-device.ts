// A test says which device it means: the setup steps follow the device (the Mac and Windows apps do all of them, a browser has no sessions or folders, a phone no Chrome). The
// desktop app is told by its Tauri bridge, so "mac" sets one for the call and puts it back; "web" makes sure there is none.
import { detectDevice } from "./device.ts";
import type { Device } from "./device.ts";

export function asDevice<T>(device: "mac" | "web", run: () => T): T {
  const g = globalThis as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown; navigator?: unknown };
  const had = { tauri: g.__TAURI__, internals: g.__TAURI_INTERNALS__ };
  if (device === "mac") g.__TAURI__ = {}; else { delete g.__TAURI__; delete g.__TAURI_INTERNALS__; }
  try {
    const seen: Device = detectDevice(1280);
    if (device === "mac" && seen !== "mac" && seen !== "win") throw new Error(`the test asked for the Mac app but the page reads as ${seen}`);
    if (device === "web" && seen !== "web") throw new Error(`the test asked for a browser but the page reads as ${seen}`);
    return run();
  } finally {
    if (had.tauri === undefined) delete g.__TAURI__; else g.__TAURI__ = had.tauri;
    if (had.internals === undefined) delete g.__TAURI_INTERNALS__; else g.__TAURI_INTERNALS__ = had.internals;
  }
}
