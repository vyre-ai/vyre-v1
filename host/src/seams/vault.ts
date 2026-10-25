// ctx.vault for module code (ruling 31/32, ARCH 6.11): `use(handle)` names a handle and `fill(handle, into)` asks the vault module to put the value in a place, through the same invoke pipeline as any
// caller, so authorize (Use level), audit and the history row are the normal ones and the value never passes through the module that asked. The places (git_credential, container_env, route_auth, env...)
// are sinks the host registers per kind in DaemonOptions.seams.vaultSinks; a kind with no sink is refused by the vault module ("no place to fill").
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
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

/** An address the probe may not reach (SSRF): link-local always (cloud metadata is 169.254.169.254); loopback, private, unique-local and unspecified unless this is the caller's own computer. */
export function blockedAddress(ip: string, own: boolean): string | null {
  const v4 = (a: number, b: number): string | null => {
    if (a === 169 && b === 254) return "a link-local address";
    if (own) return null;
    if (a === 127) return "a loopback address";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "a private network address";
    if (a === 0) return "an unspecified address";
    if (a === 100 && b >= 64 && b <= 127) return "a shared network address";
    return null;
  };
  if (net.isIPv4(ip)) { const [a, b] = ip.split(".").map(Number); return v4(a!, b!); }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    const mapped = /^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(low);
    if (mapped) return v4(Number(mapped[1]), Number(mapped[2]));
    const first = parseInt(low.split(":")[0] || "0", 16);
    if ((first & 0xffc0) === 0xfe80) return "a link-local address";
    if (own) return null;
    if (low === "::1") return "a loopback address";
    if (low === "::") return "an unspecified address";
    if ((first & 0xfe00) === 0xfc00) return "a private network address";
    return null;
  }
  return "not an address";
}

/** Where a local model may be reached from this node: http or https, and every address its name resolves to allowed (a name that resolves to a refused address is refused whole). `ips` are the addresses to connect to. */
export async function checkModelAddress(address: string, own: boolean, resolve: (host: string) => Promise<string[]> = async (h) => (await dns.lookup(h, { all: true })).map((r) => r.address)): Promise<{ why: string } | { url: URL; ips: string[] }> {
  let u: URL;
  try { u = new URL(address); } catch { return { why: "That is not an address." }; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { why: "A local model is reached over http or https." };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let ips: string[];
  try { ips = net.isIP(host) ? [host] : await resolve(host); } catch { return { why: "That address could not be found." }; }
  if (!ips.length) return { why: "That address could not be found." };
  for (const ip of ips) {
    const why = blockedAddress(ip, own);
    if (why) return { why: own ? "That address is not allowed." : `A local model on this server cannot be ${why}.` };
  }
  return { url: u, ips };
}

/** Null when the address may be probed from this node, else why not. */
export async function refuseModelAddress(address: string, own: boolean, resolve?: (host: string) => Promise<string[]>): Promise<string | null> {
  const r = await checkModelAddress(address, own, resolve);
  return "why" in r ? r.why : null;
}

export interface PinnedResponse { status: number; ok: boolean; json(): Promise<unknown> }
export type PinnedRequest = (url: URL, o: { headers: Record<string, string>; ips: readonly string[]; timeoutMs?: number }) => Promise<PinnedResponse>;

/**
 * GET `url` connecting to one of `ips` (the addresses that were checked), whatever the name would resolve to now: the Host header and the TLS server name stay the name\'s, the socket goes to the checked
 * address. A redirect is not followed (it answers as a non-ok status). This is what closes the gap between checking an address and connecting to it (DNS rebinding).
 */
export const pinnedGet: PinnedRequest = (url, o) => new Promise((resolve, reject) => {
  const secure = url.protocol === "https:";
  const lib = secure ? https : http;
  const ips = [...o.ips];
  const req = lib.request({
    host: url.hostname.replace(/^\[|\]$/g, ""), port: url.port || (secure ? 443 : 80), path: `${url.pathname}${url.search}`, method: "GET",
    headers: { ...o.headers, host: url.host }, ...(secure ? { servername: net.isIP(url.hostname) ? undefined : url.hostname } : {}),
    lookup: (_host: string, opts: { all?: boolean }, cb: (err: Error | null, a: unknown, f?: number) => void) => {
      const pick = ips.map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 }));
      if (opts && opts.all) cb(null, pick); else cb(null, pick[0]!.address, pick[0]!.family);
    },
    timeout: o.timeoutMs ?? 10_000,
  } as http.RequestOptions, (res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on("data", (c: Buffer) => { size += c.length; if (size > 1_000_000) { req.destroy(new Error("too large")); return; } chunks.push(c); });
    res.on("end", () => {
      const status = res.statusCode ?? 0;
      resolve({ status, ok: status >= 200 && status < 300, json: async () => JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    });
  });
  req.on("timeout", () => req.destroy(new Error("timeout")));
  req.on("error", reject);
  req.end();
});

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
    google: (k) => ({ url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(k)}`, headers: {}, pick: ids("models", "name") }),
  };
  function ids(list: string, key: string) {
    return (j: unknown): string[] => {
      const rows = (j as Record<string, unknown> | null)?.[list];
      return Array.isArray(rows) ? rows.map((r) => String((r as Record<string, unknown>)[key] ?? "")).filter(Boolean) : [];
    };
  }
  return async (p: { providerKey: string; connection: string; caller: string; apiKey?: string; address?: string }): Promise<{ ok: boolean; models: string[]; detail?: string }> => {
    let url: string, headers: Record<string, string> = {}, pick: (j: unknown) => string[] = ids("data", "id");
    if (p.connection === "local_model") {
      if (!p.address) return { ok: false, models: [], detail: "This local model has no address." };
      const checked = await checkModelAddress(p.address, o.own ? o.own(p.caller) : false, o.resolve);
      if ("why" in checked) return { ok: false, models: [], detail: checked.why };
      if (p.apiKey) headers = { authorization: `Bearer ${p.apiKey}` };
      try {
        const base = new URL(`${checked.url.pathname.replace(/\/$/, "")}/v1/models`, checked.url);
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
