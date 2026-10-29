// The host sends one connector read. The module receives only the status.
// The Vault value stays in this function and is not returned.

import type { SeamDriverDeps } from "./index.ts";

export function connectorReadSender(d: Pick<SeamDriverDeps, "vault" | "fetch" | "space">): (plan: { method: string; url: string; vaultItemId: string }) => Promise<{ status: number }> {
  return async (plan) => {
    let value = "";
    try {
      value = await d.vault.secret(plan.vaultItemId, d.space);
    } catch {
      return { status: 0 };
    }
    try {
      const response = await d.fetch(plan.url, { method: plan.method, headers: { authorization: `Bearer ${value}` } });
      return { status: response.status };
    } catch {
      return { status: 0 };
    }
  };
}
