// Where a Vault key may be sent: list, allow and remove the approved hosts of one item. Only a person who may use the item approves or removes; the list shows to anyone who can see the item.
// The Vault answers which items the caller sees and at what level (vault.items.list); this module keeps only item ids and host names, never a value.
import { allowKeyHost, keyHostsOf, normalHost, removeKeyHost } from "../key-hosts.ts";
import type { KeyHostDb } from "../key-hosts.ts";
import { raise } from "../projections.ts";
import type { AutoCtx } from "../projections.ts";

interface SeenItem { id: string; handle: string; yourLevel: string }
const USE = new Set(["use", "edit", "manage"]);

/** The item the caller can see, by id (vit_...) or handle (#Name or #Name.field). Null when they cannot see it: the same answer as an item that does not exist. */
async function seenItem(ctx: AutoCtx, ref: unknown): Promise<SeenItem | null> {
  if (typeof ref !== "string" || ref.trim() === "" || !ctx.call) return null;
  const want = ref.trim();
  const base = want.startsWith("#") ? want.replace(/\.[A-Za-z][A-Za-z0-9_]*$/, "").toLowerCase() : want;
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

export async function keyHostsList(ctx: AutoCtx, input: { itemId?: unknown }): Promise<{ hosts: { host: string; by: string; at: number }[] }> {
  const item = await seenItem(ctx, input.itemId);
  if (!item) return { hosts: [] };
  return { hosts: keyHostsOf(ctx.db as unknown as KeyHostDb, item.id) };
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
  return { removed: removeKeyHost(ctx.db as unknown as KeyHostDb, item.id, host) };
}
