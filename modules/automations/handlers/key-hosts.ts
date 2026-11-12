// Where a Vault key may be sent: list, allow and remove the approved hosts of one item. Only a person who may use the item approves or removes; the list shows to anyone who can see the item.
// The Vault answers which items the caller sees and at what level (vault.items.list); this module keeps only item ids and host names, never a value.
import { allowKeyHost, keyHostsOf, normalHost, plannedHost, removeKeyHost } from "../key-hosts.ts";
import { keyRefResolver } from "../key-ref-port.ts";
import type { KeyHostDb } from "../key-hosts.ts";
import { allAutomations, raise } from "../projections.ts";
import { hostOfUrl } from "../../../lib/key-target.ts";
import { canView } from "./defs.ts";
import type { AutoCtx } from "../projections.ts";

interface SeenItem { id: string; handle: string; yourLevel: string }
const USE = new Set(["use", "edit", "manage"]);

/** The item the caller can see, by id (vit_...) or handle (#Name or #Name.field). Null when they cannot see it: the same answer as an item that does not exist. */
async function seenItem(ctx: AutoCtx, ref: unknown): Promise<SeenItem | null> {
  if (typeof ref !== "string" || ref.trim() === "" || !ctx.call) return null;
  const want = ref.trim();
  const bare = want.replace(/\.[A-Za-z][A-Za-z0-9_]*$/, "");
  const base = /^vit_[a-z0-9]+$/.test(bare) ? bare : (bare.startsWith("#") ? bare : `#${bare}`).toLowerCase();
  let out: unknown;
  try { out = await ctx.call("vault.items.list", { limit: 500 }); } catch { return null; }
  const items = (out as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  for (const raw of items) {
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r["id"] !== "string" || typeof r["handle"] !== "string") continue;
    if (r["id"] === base || String(r["handle"]).toLowerCase() === base) return { id: r["id"], handle: r["handle"], yourLevel: typeof r["yourLevel"] === "string" ? r["yourLevel"] : "view" };
  }
  return null;
}

const NOT_YOURS = "You cannot use this key, so you cannot choose where it is sent.";
const personOnly = (ctx: AutoCtx): void => {
  if (ctx.principal.kind !== "person") raise(ctx, "permission.role_lacks_permission", "Only a person chooses where a key is sent.", { reason: "people_only" });
};

/** The Automations (the caller can open) whose HTTP steps send this key to `host`, by name; and how many more the caller cannot open. */
function usersOf(ctx: AutoCtx, handle: string, host: string): { usedBy: string[]; hidden: number } {
  const usedBy: string[] = [];
  let hidden = 0;
  const want = handle.toLowerCase();
  for (const a of allAutomations(ctx.db)) {
    const uses = a.definition.nodes.some((n) => {
      const input = n.input as Record<string, unknown> | undefined;
      const h = (input?.["auth"] as { handle?: unknown } | undefined)?.handle;
      return n.key === "http_request" && typeof h === "string" && h.split(".")[0]!.toLowerCase() === want && typeof input?.["url"] === "string" && hostOfUrl(input["url"]) === host;
    });
    if (!uses) continue;
    if (canView(ctx, a)) usedBy.push(a.name); else hidden += 1;
  }
  return { usedBy: usedBy.sort(), hidden };
}

export async function keyHostsList(ctx: AutoCtx, input: { itemId?: unknown }): Promise<{ hosts: { host: string; by: string; at: number; usedBy: string[]; hidden?: number }[] }> {
  const item = await seenItem(ctx, input.itemId);
  if (!item) return { hosts: [] };
  return { hosts: keyHostsOf(ctx.db as unknown as KeyHostDb, item.id).map((h) => { const u = usersOf(ctx, item.handle, h.host); return { ...h, usedBy: u.usedBy, ...(u.hidden > 0 ? { hidden: u.hidden } : {}) }; }) };
}

export async function keyHostsAllow(ctx: AutoCtx, input: { vaultItemId?: unknown; host?: unknown }): Promise<{ hosts: { host: string; by: string; at: number }[] }> {
  personOnly(ctx);
  const host = typeof input.host === "string" ? normalHost(input.host) : null;
  if (!host) raise(ctx, "validation.bad_input", "That is not a host name.");
  const item = await seenItem(ctx, input.vaultItemId);
  if (!item || !USE.has(item.yourLevel)) raise(ctx, "permission.no_grant", NOT_YOURS);
  allowKeyHost(ctx.db as unknown as KeyHostDb, item.id, host, ctx.principal.id, ctx.now());
  return { hosts: keyHostsOf(ctx.db as unknown as KeyHostDb, item.id) };
}

export async function keyHostsRemove(ctx: AutoCtx, input: { itemId?: unknown; host?: unknown }): Promise<{ removed: boolean }> {
  personOnly(ctx);
  const host = typeof input.host === "string" ? normalHost(input.host) : null;
  if (!host) raise(ctx, "validation.bad_input", "That is not a host name.");
  const item = await seenItem(ctx, input.itemId);
  if (!item || !USE.has(item.yourLevel)) raise(ctx, "permission.no_grant", NOT_YOURS);
  return { removed: removeKeyHost(ctx.db as unknown as KeyHostDb, item.id, host, ctx.principal.id, ctx.now()) };
}

/**
 * What a held test read would send, as the server reads it: the item (by the host's one reading of the reference, for the person looking) and the host. The card names the key from here, never from
 * what the agent wrote, and Always allow approves this item id. An item the person cannot see in the Vault is not described.
 */
export async function keyHostsPending(ctx: AutoCtx, input: Record<string, unknown>): Promise<{ found: boolean; itemId?: string; handle?: string; name?: string; host?: string }> {
  const host = plannedHost(input);
  const resolve = keyRefResolver();
  const asker = ctx.actingFor ?? (ctx.principal.kind === "person" ? ctx.principal.id : undefined);
  const ref = resolve ? resolve(input["vaultItemId"], asker) : null;
  if (!ref || host === null) return { found: false, ...(host ? { host } : {}) };
  const seen = await seenItem(ctx, ref.id);
  if (!seen) return { found: false, host };
  return { found: true, itemId: ref.id, handle: ref.handle, name: ref.name, host };
}

/** What a held key binding would do: the keys (as the server reads them, for the person looking) and every domain of the connector. The card names all of them, never "and others". */
export async function keyHostsPendingBind(ctx: AutoCtx, input: { connector?: unknown; secrets?: unknown; connectionId?: unknown; handle?: unknown }): Promise<{ found: boolean; items: { itemId: string; handle: string; name: string }[]; hosts: string[] }> {
  const none = { found: false, items: [], hosts: [] };
  const resolve = keyRefResolver();
  if (!resolve || !ctx.call) return none;
  let connector = typeof input.connector === "string" ? input.connector : "";
  try {
    if (connector === "" && typeof input.connectionId === "string") connector = String(((await ctx.call("connections.get", { connectionId: input.connectionId })) as { connection?: { connector?: unknown } } | null)?.connection?.connector ?? "");
    const got = (await ctx.call("connectors.get", { key: connector })) as { connector?: { domains?: unknown } } | null;
    const hosts = Array.isArray(got?.connector?.domains) ? (got!.connector!.domains as unknown[]).flatMap((d) => (typeof d === "string" && normalHost(d) ? [normalHost(d)!] : [])) : [];
    const refs = input.secrets && typeof input.secrets === "object" ? Object.values(input.secrets as Record<string, unknown>) : [input.handle];
    const asker = ctx.actingFor ?? (ctx.principal.kind === "person" ? ctx.principal.id : undefined);
    const items: { itemId: string; handle: string; name: string }[] = [];
    for (const ref of refs) {
      const r = resolve(ref, asker);
      if (!r || !(await seenItem(ctx, r.id))) return { ...none, hosts };
      items.push({ itemId: r.id, handle: r.handle, name: r.name });
    }
    return { found: items.length > 0 && hosts.length > 0, items, hosts };
  } catch { return none; }
}
