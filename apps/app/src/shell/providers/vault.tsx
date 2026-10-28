// The Vault place in the shell (spec 3.8): the whole Apple-Passwords layout over the Space's data. The runtime's people list, calls and door become the place's VaultData; where a click
// leaves the Vault (share, export, Advanced, requests, an agent) it goes out through the shell. Before the runtime exists the place draws its own loading frame.
import { useMemo } from "react";
import type { ReactElement } from "react";
import VaultLayout, { VaultLoading } from "../../places/vault/layout/index.tsx";
import type { VaultData, VaultRoute } from "../../places/vault/layout/index.tsx";
import { usePlaceHash } from "../hash/context.tsx";
import type { HashTarget } from "../hash/hash.ts";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

export function vaultRoute(target: HashTarget): VaultRoute {
  if (target.screen === "vault_requests.list") return { surface: "requests" };
  if (target.screen === "vault.export" && target.args["folderId"]) return { surface: "export", folderId: target.args["folderId"] };
  if (target.args["share"]) return { surface: "share", itemId: target.args["share"] };
  if (target.args["export"]) return { surface: "export", folderId: target.args["export"] };
  if (target.args["advanced"] === "true") return { surface: "advanced" };
  return { surface: "layout" };
}

export function vaultData(rt: ShellRuntime): VaultData {
  return {
    screens: rt.screens, call: rt.call, connection: rt.connection, principals: rt.principals, me: rt.me, spaceName: rt.space.name,
    nav: {
      openShare: (itemId) => rt.open({ screen: "vault.layout", args: { share: itemId } }),
      openExport: (folderId) => rt.open({ screen: "vault.export", args: { folderId } }),
      openAdvanced: () => rt.open({ screen: "vault.layout", args: { advanced: true } }),
      openBackups: () => rt.open({ screen: "console.backups" }),
      openDevices: () => rt.open({ screen: "devices.mine" }),
      openOutsideActors: () => rt.open({ screen: "console.outside-actors" }),
      openRequests: () => rt.open({ screen: "vault_requests.list" }),
      openAgent: (agentId) => rt.open({ screen: "chats.agent-page", args: { agentId } }),
    },
    clock: () => ({ now: rt.clock().now }),
  };
}

export default function VaultPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const { target, opened } = usePlaceHash();
  const data = useMemo(() => (rt ? vaultData(rt) : null), [rt]);
  const route = useMemo(() => vaultRoute(target), [target]);
  return data ? <VaultLayout data={data} route={route} onRouteClose={() => opened({ screen: "vault.layout" })} /> : <VaultLoading />;
}
