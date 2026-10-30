// The Vault policy page's reads and writes (vault.policy.get, access.roles.list, vault.policy.set), apart from the page so a test can drive them with a fake door.
import type { VaultData } from "./data.tsx";
import type { Expiry } from "./model.ts";

export interface VaultPolicy { exportRoles: string[]; pullExpiryMax: Expiry; blockRestrictedExport: true; revealNeedsReason: boolean }

export type PolicyLoad = { state: "denied" } | { state: "ready"; saved: VaultPolicy; roles: string[] };

/** The stored policy and the roles that can be allowed to export. A person who may not manage Vault policy gets "denied", any other failure throws. */
export async function loadVaultPolicy(call: VaultData["call"]): Promise<PolicyLoad> {
  let got: { policy: VaultPolicy };
  try { got = (await call("vault.policy.get", {})) as { policy: VaultPolicy }; }
  catch (e) { if (((e as { code?: string } | null)?.code ?? "").startsWith("permission.")) return { state: "denied" }; throw e; }
  const listed = ((await call("access.roles.list", {}).catch(() => ({ roles: [] }))) as { roles: Array<{ name: string }> }).roles.map((r) => r.name);
  // a role the policy already names stays listed even when the role list cannot name it
  return { state: "ready", saved: got.policy, roles: [...new Set([...listed, ...got.policy.exportRoles])] };
}

export async function saveVaultPolicy(call: VaultData["call"], policy: VaultPolicy): Promise<VaultPolicy> {
  return ((await call("vault.policy.set", { policy })) as { policy: VaultPolicy }).policy;
}

export const policyDirty = (a: VaultPolicy, b: VaultPolicy): boolean =>
  a.pullExpiryMax !== b.pullExpiryMax || a.revealNeedsReason !== b.revealNeedsReason || [...a.exportRoles].sort().join("|") !== [...b.exportRoles].sort().join("|");

export const toggledRole = (p: VaultPolicy, name: string): VaultPolicy => ({ ...p, exportRoles: p.exportRoles.includes(name) ? p.exportRoles.filter((r) => r !== name) : [...p.exportRoles, name] });
