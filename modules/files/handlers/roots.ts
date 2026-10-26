// The root folders files.tree makes (Personal, Agents, Projects, ..., and the Knowledge children) are folders in the access projection too (ruling 65), or nothing could be created in them:
// authorize answers permission.not_found for a folder it has never heard of. The module cannot write the log, so the host does it through `resources.ensure` (idempotent: the same folder is the
// same resource after a reboot), as it does for Kits. No event goes out and no read emits one: the roots are registered the first time any files capability runs for a caller, before its handler.
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { ensureReady } from "./tree.ts";

export interface FilesHost {
  resources: { ensure(r: { id: string; type: "folder"; parentId: string | null; ownerId?: string }): Promise<void> };
}

let configured: FilesHost | null = null;
/** The host calls this once at start. Null clears (and forgets what it registered). */
export function configureFilesHost(h: FilesHost | null): void {
  configured = h;
  registered.clear();
}

/** Roots this process has already asked the host to register; ensure is idempotent, this only saves asking again. */
const registered = new Set<string>();

type Row = Record<string, unknown>;

/** Makes the Space roots and the caller's Personal root exist as access resources. Parents first, so a child never names a folder access does not know. */
export async function registerRoots(ctx: Ctx): Promise<void> {
  ensureReady(ctx);   // every files capability makes the root rows, whether or not a host is there to register them
  const host = configured;
  if (!host) return;
  const rows = ctx.db.all(
    "SELECT id, parent_id, root_key, system_key, owner FROM files_folder WHERE (root_key IS NOT NULL OR system_key IS NOT NULL) AND deleted_at IS NULL ORDER BY length(path), path",
  ) as Row[];
  const mine = `personal:${ctx.principal.id}`;
  for (const row of rows) {
    const id = String(row["id"]);
    const key = typeof row["root_key"] === "string" ? row["root_key"] : "";
    if (key.startsWith("personal:") && key !== mine) continue;   // somebody else's Personal root is registered when they call
    if (registered.has(id)) continue;
    const personal = key === mine;
    await host.resources.ensure({ id, type: "folder", parentId: typeof row["parent_id"] === "string" ? row["parent_id"] : null, ...(personal ? { ownerId: ctx.principal.id } : {}) });
    registered.add(id);
  }
}

type Handler = (ctx: Ctx, input: unknown) => Promise<unknown> | unknown;

/** Every files handler registers the roots first. */
export function withRoots<T extends Record<string, Handler>>(handlers: T): T {
  const out: Record<string, Handler> = {};
  for (const [name, h] of Object.entries(handlers)) out[name] = async (ctx, input) => { await registerRoots(ctx); return h(ctx, input); };
  return out as T;
}
