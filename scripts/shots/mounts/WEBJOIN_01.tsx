// Mount for a member who joins a server Space from a browser (lane l-webjoin), over scripted answers. ?part=
//   join-covered (the join AI screen: the Space AI key covers them, their own Claude, ChatGPT or Grok still offered), join-nokey (no Space key: who can add one),
//   vault-browser (Vault > AI providers in a browser: the Space key line and Connect Claude, ChatGPT, Grok), vault-desktop (the same section in the desktop app, no Space key read),
//   vault-keys (an empty Vault's Keys section: its own words, not "Your vault is empty"), signin-name (the sign-in screen of a Space whose server answers its id: the address instead)
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { JoinProviderSetup } from "../../../apps/app/src/shell/session/JoinProviderSetup.tsx";
import { signInInvite } from "../../../apps/app/src/shell/session/SessionGate.tsx";
import { JoinFlow } from "../../../apps/app/src/join/JoinFlow.tsx";
import Vault from "../../../apps/app/src/places/vault/layout/index.tsx";
import type { VaultData } from "../../../apps/app/src/places/vault/layout/data.tsx";
import { createSampleVault, northwind } from "../../../apps/app/src/places/vault/layout/sample.ts";
import type { StoredSession } from "../../../apps/app/src/shell/session/stored.ts";

export const title = "Joining a server Space from a browser";

const noop = (): void => undefined;
const stored = { baseUrl: "https://mla.vyre.run", token: "fixture-token", def: { name: "My Legal Academy" } } as StoredSession;
const owner = [{ id: "usr_owner", kind: "person", name: "Irfad Imtiaz", status: "active", roles: ["rol_owner"] }];

function vaultFor(key: { set: boolean; name?: string; models?: string[] } | null, o: { home: "none" | "computer"; empty?: boolean }): VaultData {
  const v = createSampleVault(o.empty ? { ...northwind, items: [], providers: [], history: [], requests: [] } : { ...northwind, items: northwind.items.filter((i) => i.scope === "shared"), providers: [] });
  const call = v.data.call;
  return {
    ...v.data, aiHome: o.home,
    call: async (cap, input) => {
      if (cap === "providers.space_key.get") return key ? { ...key, models: key.models ?? [], mayManage: false, state: "ok" } : { set: false, models: [], mayManage: false };
      if (cap === "access.principals.list") return { principals: owner };
      return call(cap, input);
    },
  };
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "join-covered"), []);
  const browser = useMemo(() => vaultFor({ set: true, name: "OpenCode Go", models: ["glm-5.3", "kimi-k3", "qwen3-coder", "deepseek-v4"] }, { home: "none" }), []);
  const desktop = useMemo(() => vaultFor(null, { home: "computer" }), []);
  const empty = useMemo(() => vaultFor(null, { home: "none", empty: true }), []);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (part === "join-covered") return <JoinProviderSetup stored={stored} ai={{ choice: "sub" }} home="none" spaceAi={{ key: { set: true, name: "OpenCode Go", state: "ok", models: ["glm-5.3", "kimi-k3"] }, admin: null }} onOpen={noop} onClearSecret={noop} />;
  if (part === "join-nokey") return <JoinProviderSetup stored={stored} ai={{ choice: "sub" }} home="none" spaceAi={{ key: { set: false }, admin: "Irfad Imtiaz (owner)" }} onOpen={noop} onClearSecret={noop} />;
  if (part === "signin-name") {
    const invite = signInInvite("https://mla.vyre.run", { name: "spc_2a7c98c337e1dfd2e05e1aab", fingerprint: "", password: true, github: false, sso: [], secondFactorRequired: false });
    return <JoinFlow invite={invite} initial={{ stage: "signin" }} />;
  }
  const data = part === "vault-desktop" ? desktop : part === "vault-keys" ? empty : browser;
  return <View style={{ flex: 1, minHeight: 760 }}><Vault data={data} initial={part === "vault-keys" ? { kind: "keys" } : { kind: "providers" }} /></View>;
}
