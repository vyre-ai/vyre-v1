// What the sites module may ask the host to do as itself (svc_host) for a site's own action: the Vault folder, item and shares of a webhook secret, and the task that asks the owner to give GitHub the new one. Nothing else: this is no way round a hold.
import type { InvokeResult } from "../invoke.ts";

export const SITES_AS_HOST: ReadonlySet<string> = new Set([
  "vault.folders.create",
  "vault.item.put",
  "vault.item.update",
  "vault.share",
  "tasks.create",
]);

export function sitesAsHost(
  call: (cap: string, input: unknown) => Promise<InvokeResult | { status?: string; output?: unknown }>,
): (cap: string, input: unknown) => Promise<unknown> {
  return async (cap, input) => {
    if (!SITES_AS_HOST.has(cap)) throw new Error(`${cap} is not something a site's own action may ask the host to do`);
    const r = (await call(cap, input)) as { status?: string; output?: unknown };
    if (r.status !== "ok") throw new Error(`${cap}: ${r.status ?? "failed"}`);
    return r.output;
  };
}
