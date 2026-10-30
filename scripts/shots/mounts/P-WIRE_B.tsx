// Mount for the wired screens (PR B): ?part=vault-policy (Vault > Advanced > Policy), vault-export (the export sheet with the length of link), email-design (one email design on its own).
// Each is the place's own screen over its sample Space, with the capabilities the screen reads answered here (the policy, the roles, a design), as the booted Space answers them.
import { useMemo } from "react";
import type { ReactNode } from "react";
import Vault from "../../../apps/app/src/places/vault/layout/index.tsx";
import { createSampleVault, northwind } from "../../../apps/app/src/places/vault/layout/sample.ts";
import AppsLayout from "../../../apps/app/src/places/apps/shell/AppsPlace.tsx";
import { createSampleApps } from "../../../apps/app/src/places/apps/shell/sample.ts";

export const title = "Wired screens";

const DOC = {
  emailId: "eml_welcome", name: "Welcome", mode: "plain", subject: "Welcome to the firm, {first}",
  plain: "Hi {first},\n\nThanks for choosing us. Here is what happens next:\n\n1. We review your intake form.\n2. We call you within one business day.\n\nTalk soon.",
};

export default function Mount(): ReactNode {
  const q = useMemo(() => new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? ""), []);
  const part = q.get("part") ?? "vault-policy";
  const vault = useMemo(() => createSampleVault(northwind), []);
  const apps = useMemo(() => createSampleApps(), []);
  if (part === "email-design") {
    const call = async (cap: string, input: unknown): Promise<unknown> => {
      if (cap === "email_builder.get") return { email: DOC };
      if (cap === "email_builder.list") return { emails: [{ emailId: "eml_welcome", name: "Welcome", updatedAt: Date.now() }] };
      if (cap === "email_builder.versions") return { versions: [{ version: 3, at: Date.now() - 3_600_000, by: "usr_irfad" }] };
      if (cap === "email_builder.saved_blocks.list") return { blocks: [] };
      if (cap === "agents.list") return { agents: [{ agentId: "agt_docs", name: "Docs", role: "Drafts documents" }] };
      return apps.data.call(cap, input);
    };
    return <AppsLayout data={{ ...apps.data, call, nav: { ...apps.data.nav, openEmailDesign: () => undefined } }} route={{ kind: "email", group: "campaigns", id: "eml_welcome" }} />;
  }
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    if (cap === "vault.policy.get") return { policy: { exportRoles: ["owner", "admin"], pullExpiryMax: "1d", blockRestrictedExport: true, revealNeedsReason: false } };
    if (cap === "access.roles.list") return { roles: [{ name: "owner" }, { name: "admin" }, { name: "member" }, { name: "billing" }] };
    return vault.data.call(cap, input);
  };
  const route = part === "vault-export" ? { surface: "export" as const, folderId: "fld_marketing" } : { surface: "policy" as const };
  return <Vault data={{ ...vault.data, call }} route={route} onRouteClose={() => undefined} />;
}
