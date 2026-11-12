// At run time a key-bearing request goes only to a host approved for its key: listed under "Sent to" on the key (a person approved it, or saved or turned on a step that sends it there), or the
// exact host of the key's own saved address. Whoever saved the step. A host not on the list is not sent to: the step fails with the line a person can act on.
import { hostOfUrl } from "../../lib/key-target.ts";
import { keyHostApproved } from "./key-hosts.ts";
import type { KeyHostDb } from "./key-hosts.ts";
import { keyRefResolver } from "./key-ref-port.ts";
import { raise } from "./projections.ts";
import type { AutoCtx } from "./projections.ts";

/** Is this key allowed to go to this host now: listed for it, or the exact host of its own saved address. Null when it is; else the line a person reads. Unresolvable keys answer null (the Vault refuses them itself). */
export async function keyHostLine(ctx: AutoCtx, handle: string, url: string): Promise<{ handle: string; host: string; line: string } | null> {
  const host = hostOfUrl(url);
  const resolve = keyRefResolver();
  if (!resolve || host === null) return null;
  const asker = ctx.actingFor ?? (ctx.principal?.kind === "person" ? ctx.principal.id : undefined);
  const ref = resolve(handle, asker);
  if (!ref) return null;
  if (keyHostApproved(ctx.db as unknown as KeyHostDb, ref.id, host)) return null;
  const hits = async (h: string): Promise<boolean> => {
    try {
      const m = ctx.call ? (await ctx.call("vault.items.match", { url: `https://${h}/` })) as { items?: { item?: { id?: unknown } }[] } | null : null;
      return (m?.items ?? []).some((x) => x.item?.id === ref.id);
    } catch { return false; }
  };
  const dot = host.indexOf(".");
  const parent = dot > 0 && !host.startsWith("[") ? host.slice(dot + 1) : "";
  if (await hits(host) && (parent === "" || !parent.includes(".") || !(await hits(parent)))) return null;
  return { handle: ref.handle, host, line: `${ref.handle} is no longer allowed to go to ${host}. Allow it again on the key's page, or change this step.` };
}

/** The key-bearing steps of a definition whose host is not allowed for their key, before any Run: the builder and "Used in" show them. */
export async function blockedKeySteps(ctx: AutoCtx, nodes: readonly { id: string; key: string; input?: unknown }[]): Promise<{ nodeId: string; handle: string; host: string; line: string }[]> {
  const out: { nodeId: string; handle: string; host: string; line: string }[] = [];
  for (const n of nodes) {
    const input = n.input as Record<string, unknown> | undefined;
    const handle = (input?.["auth"] as { handle?: unknown } | undefined)?.handle;
    if (n.key !== "http_request" || typeof handle !== "string" || typeof input?.["url"] !== "string" || input["url"].includes("{")) continue;
    const b = await keyHostLine(ctx, handle, input["url"]);
    if (b) out.push({ nodeId: n.id, ...b });
  }
  return out;
}

export async function assertKeyMayGo(ctx: AutoCtx, handle: string, url: string): Promise<void> {
  if (hostOfUrl(url) === null) raise(ctx, "validation.bad_input", "That address cannot carry a key.");
  const b = await keyHostLine(ctx, handle, url);
  if (b) raise(ctx, "permission.no_grant", b.line, { reason: "key_host_unapproved", host: b.host });
}
