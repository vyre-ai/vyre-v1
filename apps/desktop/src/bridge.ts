// The page's side of the shell (window.__TAURI__.core.invoke): typed calls for the native features. The invoke function is passed in, so the same
// code runs in the page (window.__TAURI__.core.invoke) and in tests (a recorder). Nothing here reaches the network or the file system.

import { checkPicked, pickOptions } from "./files.ts";
import type { PickRequest } from "./files.ts";
import { osNotification } from "./notify.ts";
import type { NotificationInput } from "./notify.ts";
import { badgeText } from "./notify.ts";
import type { SessionSource } from "./session-import/types.ts";

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export type Bridge = {
  /** Shows an OS banner when the rules allow it. Resolves true when one was shown. */
  notify(n: NotificationInput, opts: { windowFocused: boolean; showContent?: boolean }): Promise<boolean>;
  /** Opens the system dialog; resolves to the absolute paths chosen (empty when cancelled). */
  pick(req: PickRequest): Promise<string[]>;
  /** The Needs you count for the tray and the dock. */
  setBadge(count: number): Promise<void>;
  /** Finds Codex sessions from state_5.sqlite without opening transcript files. */
  discoverCodexSessions(options?: { codexHome?: string }): Promise<SessionSource[]>;
  /** Finds Codex and Claude sources natively; no packaged web code traverses local provider roots. */
  discoverSessionSources(options?: { codexHome?: string; claudeHome?: string; claudeDesktopHome?: string }): Promise<SessionSource[]>;
};

export function makeBridge(invoke: Invoke): Bridge {
  return {
    async notify(n, opts) {
      const os = osNotification(n, opts);
      if (!os) return false;
      await invoke("notify", { title: os.title, body: os.body, link: os.link, tag: os.tag });
      return true;
    },
    async pick(req) {
      const o = pickOptions(req);
      const got = await invoke("pick_paths", { options: o });
      return checkPicked(o, Array.isArray(got) ? got.filter((p): p is string => typeof p === "string") : null);
    },
    async setBadge(count) {
      await invoke("set_badge", { count: Math.max(0, Math.floor(Number.isFinite(count) ? count : 0)), text: badgeText(count) });
    },
    async discoverCodexSessions(options = {}) {
      const got = await invoke("discover_codex_sessions", { options });
      return Array.isArray(got) ? got.filter((source): source is SessionSource => typeof source === "object" && source !== null) : [];
    },
    async discoverSessionSources(options = {}) {
      const got = await invoke("discover_session_sources", { options });
      return Array.isArray(got) ? got.filter((source): source is SessionSource => typeof source === "object" && source !== null) : [];
    },
  };
}

/** The shell's invoke when the page runs inside it; undefined in a browser. */
export function shellInvoke(g: { __TAURI__?: { core?: { invoke?: Invoke } } } = globalThis as never): Invoke | undefined {
  return g.__TAURI__?.core?.invoke;
}
