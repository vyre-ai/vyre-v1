// ctx.vault for module code (ruling 31/32, ARCH 6.11): `use(handle)` names a handle and `fill(handle, into)` asks the vault module to put the value in a place, through the same invoke pipeline as any
// caller, so authorize (Use level), audit and the history row are the normal ones and the value never passes through the module that asked. The places (git_credential, container_env, route_auth, env...)
// are sinks the host registers per kind in DaemonOptions.seams.vaultSinks; a kind with no sink is refused by the vault module ("no place to fill").
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { CtxSeed, InvokeResult } from "../invoke.ts";
import { fail } from "../routes/errors.ts";

export type VaultInvoke = (cap: string, input: unknown, seed: CtxSeed) => Promise<InvokeResult>;

export function createVaultService(invoke: VaultInvoke, space: string, seed: CtxSeed): Ctx["vault"] {
  return {
    use: (handle) => ({ handle }),
    async fill(handle, into) {
      const r = await invoke("vault.fill", { handle, target: { kind: into.kind, ref: into.ref } }, {
        space, principal: seed.principal, actingFor: seed.actingFor, run: seed.run, thread: seed.thread, device: seed.device, origin: seed.origin ?? "module", depth: (seed.depth ?? 0) + 1,
        ...(seed.trace ? { trace: seed.trace } : {}),
      });
      if (r.status === "held") throw fail("internal.unavailable", r.traceId, { message: "Filling this needs approval first." });
    },
  };
}

const HANDLE_FORM = (name: string): string => `#${name.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "item"}`;

/**
 * The invoke pipeline's `resolveItem` (a vault name or handle becomes the item id before authorize). Handles are unique across the vault, so a handle (or the handle a name makes) is tried first; a name
 * that is not a handle falls back to a shared item of that name. A handle may carry `.field`, which is not part of the lookup. Authorize then decides whether the caller may use what was found.
 */
export function resolveVaultItem(db: { all(sql: string, ...a: unknown[]): unknown[] }, type: string, kind: "name" | "handle", value: string): string | null {
  if (type !== "vault_item") return null;
  if (/^vit_[a-z0-9]+$/.test(value)) return value;
  const bare = kind === "handle" ? value.replace(/\.[A-Za-z][A-Za-z0-9_]*$/, "") : value;
  const handle = (bare.startsWith("#") ? bare : kind === "handle" ? `#${bare}` : HANDLE_FORM(bare)).toLowerCase();
  try {
    const live = db.all("SELECT id, name, handle, scope FROM vault_meta WHERE deleted_at IS NULL") as { id: string; name: string; handle: string; scope: string }[];
    const byHandle = live.find((r) => String(r.handle).toLowerCase() === handle);
    if (byHandle) return byHandle.id;
    if (kind === "name") return live.find((r) => r.scope === "shared" && String(r.name).toLowerCase() === bare.trim().toLowerCase())?.id ?? null;
  } catch { /* the vault has no tables yet: nothing to find */ }
  return null;
}
