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

/**
 * providers.test (the vault module has no network of its own): reach the provider with the key and list the models it offers. The key is used for this one request and not kept; an error message never
 * carries it. Providers without a public model list answer that they cannot be tested from here.
 */
export function createProviderProbe(fetchFn: typeof globalThis.fetch = globalThis.fetch) {
  const LISTS: Record<string, (key: string) => { url: string; headers: Record<string, string>; pick: (j: unknown) => string[] }> = {
    anthropic: (k) => ({ url: "https://api.anthropic.com/v1/models", headers: { "x-api-key": k, "anthropic-version": "2023-06-01" }, pick: ids("data", "id") }),
    openai: (k) => ({ url: "https://api.openai.com/v1/models", headers: { authorization: `Bearer ${k}` }, pick: ids("data", "id") }),
    openrouter: (k) => ({ url: "https://openrouter.ai/api/v1/auth/key", headers: { authorization: `Bearer ${k}` }, pick: () => [] }),
    xai: (k) => ({ url: "https://api.x.ai/v1/models", headers: { authorization: `Bearer ${k}` }, pick: ids("data", "id") }),
    google: (k) => ({ url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`, headers: {}, pick: ids("models", "name") }),
  };
  function ids(list: string, key: string) {
    return (j: unknown): string[] => {
      const rows = (j as Record<string, unknown> | null)?.[list];
      return Array.isArray(rows) ? rows.map((r) => String((r as Record<string, unknown>)[key] ?? "")).filter(Boolean) : [];
    };
  }
  return async (p: { providerKey: string; connection: string; apiKey?: string; address?: string }): Promise<{ ok: boolean; models: string[]; detail?: string }> => {
    let url: string, headers: Record<string, string> = {}, pick: (j: unknown) => string[] = ids("data", "id");
    if (p.connection === "local_model") {
      if (!p.address) return { ok: false, models: [], detail: "This local model has no address." };
      url = `${p.address.replace(/\/$/, "")}/v1/models`;
      if (p.apiKey) headers = { authorization: `Bearer ${p.apiKey}` };
    } else {
      const make = LISTS[p.providerKey];
      if (!make) return { ok: false, models: [], detail: "This provider cannot be tested from here." };
      if (!p.apiKey) return { ok: false, models: [], detail: "There is no key to test." };
      ({ url, headers, pick } = make(p.apiKey));
    }
    try {
      const r = await fetchFn(url, { headers, redirect: "error", signal: AbortSignal.timeout(10_000) });
      if (r.status === 401 || r.status === 403) return { ok: false, models: [], detail: "The provider did not accept this key." };
      if (!r.ok) return { ok: false, models: [], detail: `The provider answered ${r.status}.` };
      return { ok: true, models: pick(await r.json()) };
    } catch {
      return { ok: false, models: [], detail: "The provider could not be reached." };
    }
  };
}
