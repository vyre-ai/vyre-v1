// The Vault place in the shell (spec 3.8): the whole Apple-Passwords layout over the Space's data. The runtime's people list, calls and door become the place's VaultData; where a click
// leaves the Vault (share, export, Advanced, requests, an agent) it goes out through the shell. Before the runtime exists the place draws its own loading frame.
import { useMemo } from "react";
import type { ReactElement } from "react";
import VaultLayout, { VaultLoading } from "../../places/vault/layout/index.tsx";
import type { VaultBrowsers, VaultData, VaultRoute } from "../../places/vault/layout/index.tsx";
import { usePlaceHash } from "../hash/context.tsx";
import type { HashTarget } from "../hash/hash.ts";
import { attemptKey } from "./files-review.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

export function vaultRoute(target: HashTarget): VaultRoute {
  if (target.screen === "vault_requests.list") return { surface: "requests" };
  if (target.screen === "vault.export" && target.args["folderId"]) return { surface: "export", folderId: target.args["folderId"] };
  if (target.args["share"]) return { surface: "share", itemId: target.args["share"] };
  if (target.args["export"]) return { surface: "export", folderId: target.args["export"] };
  if (target.args["advanced"] === "true") return { surface: "advanced" };
  if (target.args["policy"] === "true") return { surface: "policy" };
  return { surface: "layout" };
}

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
const shellInvoke = (): Invoke | undefined => (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;

/** Install Vyre for Chrome through the desktop shell's three fixed commands (src-tauri/src/chrome.rs); undefined in a browser, so the web app has no such row. */
export function desktopBrowsers(invoke: Invoke | undefined = shellInvoke()): VaultBrowsers | undefined {
  if (!invoke) return undefined;
  return {
    async install() {
      const raw = await invoke("install_chrome_extension");
      const r = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      if (typeof r["extensionDir"] !== "string" || !Array.isArray(r["browsers"])) throw new Error("Vyre could not tell where it put the extension.");
      return { extensionDir: r["extensionDir"], version: typeof r["version"] === "string" ? r["version"] : "", browsers: r["browsers"].filter((b): b is string => typeof b === "string") };
    },
    async openExtensionsPage() { await invoke("open_chrome_extensions"); },
    async revealFolder() { await invoke("reveal_chrome_extension"); },
  };
}

export function vaultData(rt: ShellRuntime, browsers: VaultBrowsers | undefined = desktopBrowsers()): VaultData {
  return {
    screens: rt.screens, call: rt.call, connection: rt.connection, principals: rt.principals, me: rt.me, spaceName: rt.space.name,
    nav: {
      openShare: (itemId) => rt.open({ screen: "vault.layout", args: { share: itemId } }),
      openExport: (folderId) => rt.open({ screen: "vault.export", args: { folderId } }),
      openAdvanced: () => rt.open({ screen: "vault.layout", args: { advanced: true } }),
      openBackups: () => rt.open({ screen: "console.backups" }),
      openDevices: () => rt.open({ screen: "devices.mine" }),
      openOutsideActors: () => rt.open({ screen: "console.outside-actors" }),
      openPolicy: () => rt.open({ screen: "vault.layout", args: { policy: true } }),
      openRequests: () => rt.open({ screen: "vault_requests.list" }),
      openAgent: (agentId) => rt.open({ screen: "chats.agent-page", args: { agentId } }),
      // Ask an agent about an item: a new Ask pane scoped to it, opened as a thread
      ask: (agentId, _mode, about) => {
        void rt.call("chat.start", { kind: "ask", idempotencyKey: attemptKey(), agentIds: [agentId], scopeType: about.kind, scopeId: about.id, title: about.title })
          .then((out: unknown) => rt.open({ subject: { type: "thread", id: (out as { thread: { threadId: string } }).thread.threadId } }))
          .catch(() => undefined);
      },
    },
    clock: () => ({ now: rt.clock().now }),
    ...(browsers ? { browsers } : {}),
  };
}

export default function VaultPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const { target, opened } = usePlaceHash();
  const data = useMemo(() => (rt ? vaultData(rt) : null), [rt]);
  const route = useMemo(() => vaultRoute(target), [target]);
  return data ? <VaultLayout data={data} route={route} onRouteClose={() => opened({ screen: "vault.layout" })} /> : <VaultLoading />;
}
