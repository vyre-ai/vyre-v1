// The Vault place in the shell (spec 3.8): the whole Apple-Passwords layout over the Space's data. The runtime's people list, calls and door become the place's VaultData; where a click
// leaves the Vault (share, export, Advanced, requests, an agent) it goes out through the shell. Before the runtime exists the place draws its own loading frame.
import { useMemo } from "react";
import type { ReactElement } from "react";
import VaultLayout, { VaultLoading } from "../../places/vault/layout/index.tsx";
import type { VaultData } from "../../places/vault/layout/index.tsx";
import { useOptionalShellRuntime } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

export function vaultData(rt: ShellRuntime): VaultData {
  return {
    screens: rt.screens, call: rt.call, connection: rt.connection, principals: rt.principals, me: rt.me, spaceName: rt.space.name,
    nav: {
      openShare: (itemId) => rt.open({ screen: "vault.layout", args: { share: itemId } }),
      openExport: (folderId) => rt.open({ screen: "vault.layout", args: { export: folderId } }),
      openAdvanced: () => rt.open({ screen: "vault.layout", args: { advanced: true } }),
      openRequests: () => rt.open({ screen: "vault_requests.list" }),
      openAgent: (agentId) => rt.open({ screen: "chats.agent-page", args: { agentId } }),
    },
    clock: () => ({ now: rt.clock().now }),
  };
}

export default function VaultPlace(_props: { place: string }): ReactElement {
  const rt = useOptionalShellRuntime();
  const data = useMemo(() => (rt ? vaultData(rt) : null), [rt]);
  return data ? <VaultLayout data={data} /> : <VaultLoading />;
}
