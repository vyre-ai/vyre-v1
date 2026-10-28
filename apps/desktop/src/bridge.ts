// Desktop-only features compose the lower validated deep-link bridge with
// notifications, picker and badge controls. App clients import the lower
// structural bridge directly and never depend on this sibling app package.
import { makeDesktopLinkBridge } from "../../../client/src/connection/desktop-link.ts";
import type { DesktopDeepLink, DesktopInfo, DesktopLinkBridge, Invoke, Listen, Unlisten } from "../../../client/src/connection/desktop-link.ts";
import { checkPicked, pickOptions } from "./files.ts";
import type { PickRequest } from "./files.ts";
import { osNotification } from "./notify.ts";
import type { NotificationInput } from "./notify.ts";
import { badgeText } from "./notify.ts";

export type { DesktopDeepLink, DesktopInfo, Invoke, Listen, Unlisten } from "../../../client/src/connection/desktop-link.ts";

import type { SessionSource } from "./session-import/types.ts";

export type Bridge = DesktopLinkBridge & {
  discoverCodexSessions(options?: { codexHome?: string }): Promise<SessionSource[]>;
  discoverSessionSources(options?: { codexHome?: string; claudeHome?: string; claudeDesktopHome?: string }): Promise<SessionSource[]>;
  /** Shows an OS banner when the rules allow it. Resolves true when one was shown. */
  notify(n: NotificationInput, opts: { windowFocused: boolean; showContent?: boolean }): Promise<boolean>;
  /** Opens the system dialog; resolves to the absolute paths chosen (empty when cancelled). */
  pick(req: PickRequest): Promise<string[]>;
  /** The Needs you count for the tray and the dock. */
  setBadge(count: number): Promise<void>;
};

export function makeBridge(invoke: Invoke, listen: Listen): Bridge {
  const links = makeDesktopLinkBridge(invoke, listen);
  return {
    async discoverCodexSessions(options = {}) { return await invoke("discover_codex_sessions", { options }) as SessionSource[]; },
    async discoverSessionSources(options = {}) { return await invoke("discover_session_sources", { options }) as SessionSource[]; },
    async notify(n, opts) {
      const os = osNotification(n, opts);
      if (!os) return false;
      await invoke("notify", { title: os.title, body: os.body, link: os.link, tag: os.tag });
      return true;
    },
    async pick(req) {
      const options = pickOptions(req);
      const got = await invoke("pick_paths", { options });
      return checkPicked(options, Array.isArray(got) ? got.filter((path): path is string => typeof path === "string") : null);
    },
    async setBadge(count) {
      await invoke("set_badge", { count: Math.max(0, Math.floor(Number.isFinite(count) ? count : 0)), text: badgeText(count) });
    },
    bootstrap: links.bootstrap,
    listenLinks: links.listenLinks,
  };
}

/** The shell's invoke when the page runs inside it; undefined in a browser. */
type TauriGlobal = { __TAURI__?: { core?: { invoke?: Invoke }; event?: { listen?: Listen } } };

export function shellInvoke(g: TauriGlobal = globalThis as never): Invoke | undefined {
  return g.__TAURI__?.core?.invoke;
}

/** The shell's event listener when the page runs inside it; undefined in a browser. */
export function shellListen(g: TauriGlobal = globalThis as never): Listen | undefined {
  return g.__TAURI__?.event?.listen;
}
