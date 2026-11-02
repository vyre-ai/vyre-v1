// Mount for a member's own AI account on a Space server (lane l-memberkey, owner ruling 3 Nov), over scripted answers. ?part=
//   policy-on, policy-off (Console > Policies > Sign-in requirements: "Members' AI sign-ins: Open after Google or GitHub sign-in", on and off)
//   vault-kept, vault-forgotten (Vault > AI providers, a member's own Claude sign-in: the server keeps their key for Google or GitHub sign-in, with Forget on this server; and after Forget)
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { ConsoleDataProvider } from "../../../apps/app/src/console/shell/data.tsx";
import type { ConsoleData } from "../../../apps/app/src/console/shell/data.tsx";
import { createSampleConsole } from "../../../apps/app/src/console/shell/sample.ts";
import { Policies } from "../../../apps/app/src/console/pages/Policies.tsx";
import Vault from "../../../apps/app/src/places/vault/layout/index.tsx";
import type { VaultData } from "../../../apps/app/src/places/vault/layout/data.tsx";
import { createSampleVault, northwind } from "../../../apps/app/src/places/vault/layout/sample.ts";

export const title = "A member's own AI account on a Space server";

const policy = { secondFactor: "off" as const, requireSso: false, allowPassword: true, allowGithub: true };
const capabilities = { password: true, github: true, sso: [{ key: "google", title: "Google" }], newMemberMfaEnrollment: true, ownerHasSecondFactor: true, currentHasSecondFactor: true };

function consoleFor(on: boolean): ConsoleData {
  const base = createSampleConsole().data;
  const rows: Record<string, unknown> = {
    "members.sign_in_policy.get": { policy, capabilities },
    "members.sign_in_github.get": { github: { clientId: "Iv1.8a61f9b3a7aba766", secretSet: true, source: "space", callbackUrl: "https://mla.vyre.run/auth/github/callback", createUrl: "https://github.com/settings/applications/new" } },
    "members.sso.list": { providers: [{ key: "google", title: "Google", issuer: "https://accounts.google.com", clientId: "8812-mla.apps.googleusercontent.com", clientSecretHandle: "#Google_Client_Secret", enabled: true, domainHint: "mylegalacademy.com" }] },
    "access.policies.list": { policies: on ? [] : [{ key: "vault.open_after_provider_sign_in", scope: "space", value: false, kind: "vault" }] },
  };
  return { ...base, call: async () => ({}), screens: { ...base.screens, capQuery: (cap: string) => { const state = rows[cap] === undefined ? { status: "loading" } : { status: "ready", data: rows[cap] }; return { subscribe: () => () => undefined, getSnapshot: () => state }; } } as never };
}

function vaultFor(forgotten: boolean): VaultData {
  // a member's own Vault: their Claude sign-in (Mine) and nothing shared
  const v = createSampleVault({ ...northwind, providers: northwind.providers.filter((p) => p.scope === "mine" && p.key === "claude-code") });
  let state = { held: true, remembered: !forgotten, forgotten };
  return { ...v.data, serverKey: { state: async () => state, keep: async (keep) => { state = { held: true, remembered: keep, forgotten: !keep }; return true; } } };
}

export default function Mount(): ReactNode {
  const [part, setPart] = useState<string | null>(null);
  useEffect(() => setPart(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "").get("part") ?? "policy-on"), []);
  const on = useMemo(() => consoleFor(true), []);
  const off = useMemo(() => consoleFor(false), []);
  const kept = useMemo(() => vaultFor(false), []);
  const forgot = useMemo(() => vaultFor(true), []);
  if (part === null) return <View style={{ flex: 1, backgroundColor: "var(--win)" as string }} />;
  if (part === "policy-on" || part === "policy-off") {
    return <ConsoleDataProvider value={part === "policy-on" ? on : off}><View style={{ flex: 1, minHeight: 760 }}><Policies initialId="sign_in" /></View></ConsoleDataProvider>;
  }
  return <View style={{ flex: 1, minHeight: 760 }}><Vault data={part === "vault-forgotten" ? forgot : kept} initial={{ kind: "providers" }} /></View>;
}
