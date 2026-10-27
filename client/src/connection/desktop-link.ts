// The narrow, validated page contract for a packaged desktop shell. It has no
// desktop-app dependency so any client can consume the typed bootstrap safely.
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

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
export type Unlisten = () => void;
export type Listen = (event: "vyre://deep-link", listener: (event: { payload: unknown }) => void) => Promise<Unlisten>;

export interface DesktopLinkBridge {
  bootstrap(): Promise<{ info: DesktopInfo; pendingLink: DesktopDeepLink | null }>;
  listenLinks(listener: (link: DesktopDeepLink) => void): Promise<Unlisten>;
}

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

/** Validates the native payload before delivering it and maintains one lossless native subscription for the page lifetime. */
export function makeDesktopLinkBridge(invoke: Invoke, listen: Listen): DesktopLinkBridge {
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
      void subscription.catch(() => { if (linkSubscription === subscription) linkSubscription = undefined; });
    }
    return linkSubscription;
  };

  return {
    async bootstrap() {
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

type TauriGlobal = { __TAURI__?: { core?: { invoke?: Invoke }; event?: { listen?: Listen } } };

/** Undefined outside the packaged shell. */
export function shellDesktopLinkBridge(g: TauriGlobal = globalThis as never): DesktopLinkBridge | null {
  const invoke = g.__TAURI__?.core?.invoke;
  const listen = g.__TAURI__?.event?.listen;
  return invoke && listen ? makeDesktopLinkBridge(invoke, listen) : null;
}
