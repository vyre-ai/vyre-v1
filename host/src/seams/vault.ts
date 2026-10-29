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

export { blockedAddress, checkModelAddress, refuseModelAddress, pinnedGet } from "../../../lib/net-guard.ts";
export type { PinnedRequest, PinnedResponse } from "../../../lib/net-guard.ts";
import { checkModelAddress, pinnedGet } from "../../../lib/net-guard.ts";
import type { PinnedRequest } from "../../../lib/net-guard.ts";

/**
 * providers.test (the vault module has no network of its own): reach the provider with the key and list the models it offers. The key is used for this one request and not kept; an error never carries it.
 * A local model address comes from the caller, so it is checked first (refuseModelAddress): never link-local, and on a node that is not the caller's own never loopback or private either.
 * `own(person)` is the same rule as the key's: this is the caller's own computer. The socket connects to the address that was checked (pinnedGet), so a name that answers differently the second time
 * (DNS rebinding) changes nothing. Redirects are not followed.
 */
export function createProviderProbe(o: { fetch?: typeof globalThis.fetch; own?: (personId: string) => boolean; resolve?: (host: string) => Promise<string[]>; request?: PinnedRequest } = {}) {
  const fetchFn = o.fetch ?? globalThis.fetch;
  const LISTS: Record<string, (key: string) => { url: string; headers: Record<string, string>; pick: (j: unknown) => string[] }> = {
    anthropic: (k) => ({ url: "https://api.anthropic.com/v1/models", headers: { "x-api-key": k, "anthropic-version": "2023-06-01" }, pick: ids("data", "id") }),
    openai: (k) => ({ url: "https://api.openai.com/v1/models", headers: { authorization: `Bearer ${k}` }, pick: ids("data", "id") }),
    openrouter: (k) => ({ url: "https://openrouter.ai/api/v1/auth/key", headers: { authorization: `Bearer ${k}` }, pick: () => [] }),
    xai: (k) => ({ url: "https://api.x.ai/v1/models", headers: { authorization: `Bearer ${k}` }, pick: ids("data", "id") }),
    "opencode-go": (k) => ({ url: "https://opencode.ai/inference/go/v1/models", headers: { authorization: `Bearer ${k}` }, pick: ids("data", "id") }),
    google: (k) => ({ url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`, headers: {}, pick: ids("models", "name") }),
  };
  function ids(list: string, key: string) {
    return (j: unknown): string[] => {
      const rows = (j as Record<string, unknown> | null)?.[list];
      return Array.isArray(rows) ? rows.map((r) => String((r as Record<string, unknown>)[key] ?? "")).filter(Boolean) : [];
    };
  }
  return async (p: { providerKey: string; connection: string; caller: string; apiKey?: string; address?: string; engine?: string }): Promise<{ ok: boolean; models: string[]; detail?: string }> => {
    let url: string, headers: Record<string, string> = {}, pick: (j: unknown) => string[] = ids("data", "id");
    if (p.connection === "local_model" || (p.address && !LISTS[p.providerKey])) {
      if (!p.address) return { ok: false, models: [], detail: "This local model has no address." };
      const checked = await checkModelAddress(p.address, o.own ? o.own(p.caller) : false, o.resolve);
      if ("why" in checked) return { ok: false, models: [], detail: checked.why };
      if (p.apiKey) headers = { authorization: `Bearer ${p.apiKey}` };
      try {
        // the built-in local model is given a server address (Ollama, LM Studio, llama.cpp: /v1/models); a custom endpoint is given its OpenAI base, which already ends in /v1
        const tail = p.engine === "custom" || /\/v1\/?$/.test(checked.url.pathname) ? "/models" : "/v1/models";
        const base = new URL(`${checked.url.pathname.replace(/\/$/, "")}${tail}`, checked.url);
        const r = await (o.request ?? pinnedGet)(base, { headers, ips: checked.ips });
        if (r.status === 401 || r.status === 403) return { ok: false, models: [], detail: "The model did not accept this key." };
        if (!r.ok) return { ok: false, models: [], detail: `The model answered ${r.status}.` };
        return { ok: true, models: ids("data", "id")(await r.json()) };
      } catch {
        return { ok: false, models: [], detail: "The model could not be reached." };
      }
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
