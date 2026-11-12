// At run time a key-bearing request goes only to a host approved for its key: listed under "Sent to" on the key (a person approved it, or saved or turned on a step that sends it there), or the
// exact host of the key's own saved address. Whoever saved the step. A host not on the list is not sent to: the step fails with the line a person can act on.
import { hostOfUrl } from "../../lib/key-target.ts";
import { keyHostApproved } from "./key-hosts.ts";
import type { KeyHostDb } from "./key-hosts.ts";
import { keyRefResolver } from "./key-ref-port.ts";
import { raise } from "./projections.ts";
import type { AutoCtx } from "./projections.ts";

export async function assertKeyMayGo(ctx: AutoCtx, handle: string, url: string): Promise<void> {
  const host = hostOfUrl(url);
  if (host === null) raise(ctx, "validation.bad_input", "That address cannot carry a key.");
  const resolve = keyRefResolver();
  if (!resolve) return;   // a host without the Vault's reading (a module test): the fill below refuses or fills as before
  const asker = ctx.actingFor ?? (ctx.principal?.kind === "person" ? ctx.principal.id : undefined);
  const ref = resolve(handle, asker);
  if (!ref) return;   // nothing resolves: the Vault's own fill refuses it, with its own line
  if (keyHostApproved(ctx.db as unknown as KeyHostDb, ref.id, host)) return;
  const hits = async (h: string): Promise<boolean> => {
    try {
      const m = ctx.call ? (await ctx.call("vault.items.match", { url: `https://${h}/` })) as { items?: { item?: { id?: unknown } }[] } | null : null;
      return (m?.items ?? []).some((x) => x.item?.id === ref.id);
    } catch { return false; }
  };
  const dot = host.indexOf(".");
  const parent = dot > 0 && !host.startsWith("[") ? host.slice(dot + 1) : "";
  if (await hits(host) && (parent === "" || !parent.includes(".") || !(await hits(parent)))) return;
  raise(ctx, "permission.no_grant", `${ref.handle} is no longer allowed to go to ${host}. Allow it again on the key's page, or change this step.`, { reason: "key_host_unapproved", host });
}
