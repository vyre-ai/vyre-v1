// The page's side of the shell (window.__TAURI__.core.invoke): typed calls for the native features. The invoke function is passed in, so the same
// code runs in the page (window.__TAURI__.core.invoke) and in tests (a recorder). Nothing here reaches the network or the file system.

import { checkPicked, pickOptions } from "./files.ts";
import type { PickRequest } from "./files.ts";
import { osNotification } from "./notify.ts";
import type { NotificationInput } from "./notify.ts";
import { badgeText } from "./notify.ts";

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export type DesktopDeepLink = {
  action: "join" | "open" | "pair" | "signin";
  params: Record<string, string>;
};

export type DesktopInfo = {
  app: string;
  version: string;
  platform: string;
  arch: string;
  sidecar: {
    phase: "starting" | "ready" | "restarting" | "failed" | "stopped";
    url: string | null;
    version: string | null;
    restarts: number;
    error: string | null;
  };
};

export type Unlisten = () => void;
export type Listen = (event: "vyre://deep-link", listener: (event: { payload: unknown }) => void) => Promise<Unlisten>;

export type Bridge = {
  /** Shows an OS banner when the rules allow it. Resolves true when one was shown. */
  notify(n: NotificationInput, opts: { windowFocused: boolean; showContent?: boolean }): Promise<boolean>;
  /** Opens the system dialog; resolves to the absolute paths chosen (empty when cancelled). */
  pick(req: PickRequest): Promise<string[]>;
  /** The Needs you count for the tray and the dock. */
  setBadge(count: number): Promise<void>;
  /** The packaged shell's status and a deep link that arrived before the page loaded. */
  bootstrap(): Promise<{ info: DesktopInfo; pendingLink: DesktopDeepLink | null }>;
  /** Receives only validated Vyre deep links; unlistening pauses callbacks while the bridge keeps buffering. */
  listenLinks(listener: (link: DesktopDeepLink) => void): Promise<Unlisten>;
};

const deepLinkActions = new Set<DesktopDeepLink["action"]>(["join", "open", "pair", "signin"]);
const sidecarPhases = new Set<DesktopInfo["sidecar"]["phase"]>(["starting", "ready", "restarting", "failed", "stopped"]);
const maxLinkParams = 16;
const maxLinkParamKeyLength = 64;
const maxLinkParamValueLength = 2048;
const maxPendingDeliveredLinks = 16;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableText(value: unknown): string | null | undefined {
  return value === null || typeof value === "string" ? value : undefined;
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001F\u007F-\u009F]/u.test(value);
}

function desktopInfo(value: unknown): DesktopInfo | null {
  const got = record(value);
  const sidecar = record(got?.["sidecar"]);
  const app = text(got?.["app"]);
  const version = text(got?.["version"]);
  const platform = text(got?.["platform"]);
  const arch = text(got?.["arch"]);
  const phase = text(sidecar?.["phase"]);
  const url = nullableText(sidecar?.["url"]);
  const sidecarVersion = nullableText(sidecar?.["version"]);
  const error = nullableText(sidecar?.["error"]);
  const restarts = sidecar?.["restarts"];
  if (!app || !version || !platform || !arch || !phase || !sidecarPhases.has(phase as DesktopInfo["sidecar"]["phase"]) || url === undefined || sidecarVersion === undefined || error === undefined || typeof restarts !== "number" || !Number.isSafeInteger(restarts) || restarts < 0) return null;
  return { app, version, platform, arch, sidecar: { phase: phase as DesktopInfo["sidecar"]["phase"], url, version: sidecarVersion, restarts, error } };
}

function deepLink(value: unknown): DesktopDeepLink | null {
  const got = record(value);
  const action = text(got?.["action"]);
  const rawParams = record(got?.["params"]);
  if (!action || !deepLinkActions.has(action as DesktopDeepLink["action"]) || !rawParams) return null;
  const entries = Object.entries(rawParams);
  if (entries.length > maxLinkParams) return null;
  const params: Record<string, string> = {};
  for (const [key, param] of entries) {
    if (!key || key.length > maxLinkParamKeyLength || param === undefined || typeof param !== "string" || param.length > maxLinkParamValueLength || hasControlCharacters(key) || hasControlCharacters(param) || key === "__proto__" || key === "constructor" || key === "prototype") return null;
    params[key] = param;
  }
  return { action: action as DesktopDeepLink["action"], params };
}

export function makeBridge(invoke: Invoke, listen: Listen): Bridge {
  let pendingDeliveredLinks: DesktopDeepLink[] = [];
  let linkListener: ((link: DesktopDeepLink) => void) | undefined;
  let linkSubscription: Promise<Unlisten> | undefined;
  let listenerGeneration = 0;

  const holdLink = (link: DesktopDeepLink): void => {
    if (pendingDeliveredLinks.length === maxPendingDeliveredLinks) pendingDeliveredLinks.shift();
    pendingDeliveredLinks.push(link);
  };

  const subscribeToLinks = (): Promise<Unlisten> => {
    if (!linkSubscription) {
      const subscription = listen("vyre://deep-link", (event) => {
        const link = deepLink(event.payload);
        if (!link) return;
        if (linkListener) linkListener(link);
        else holdLink(link);
      });
      linkSubscription = subscription;
      void subscription.catch(() => {
        if (linkSubscription === subscription) linkSubscription = undefined;
      });
    }
    return linkSubscription;
  };

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
    async bootstrap() {
      // Register before take_pending_link flips the native delivery switch. Links
      // emitted while it drains are held above until listenLinks receives them.
      await subscribeToLinks();
      const [rawInfo, rawPendingLink] = await Promise.all([invoke("desktop_info"), invoke("take_pending_link")]);
      const info = desktopInfo(rawInfo);
      if (!info) throw new Error("desktop shell returned invalid bootstrap info");
      const pendingLink = rawPendingLink === null ? null : deepLink(rawPendingLink);
      if (rawPendingLink !== null && !pendingLink) throw new Error("desktop shell returned invalid pending link");
      return { info, pendingLink };
    },
    async listenLinks(listener) {
      await subscribeToLinks();
      const generation = ++listenerGeneration;
      linkListener = listener;
      for (const link of pendingDeliveredLinks.splice(0)) listener(link);
      return () => {
        if (generation !== listenerGeneration) return;
        listenerGeneration++;
        linkListener = undefined;
      };
    },
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
