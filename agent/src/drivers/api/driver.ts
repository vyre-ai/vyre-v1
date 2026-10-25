// The five API drivers behind the engine's driver port (ARCH 6.6). The frozen agent/src/driver.ts is not on main yet, so the port is written here to its spec text and the pool's PoolDriver;
// when it lands, `ApiDriver` is the one place to adapt.
import { anthropic } from "./anthropic.ts";
import { classify } from "./errors.ts";
import { google } from "./google.ts";
import { openai, openaiCompatible, openrouter, xai } from "./openai.ts";
import type { ApiSession, SessionDeps } from "./session.ts";
import { createApiSession } from "./session.ts";
import type { SessionSpec } from "../../turn-engine/types.ts";
import type { AccountRef, Authorizer, Clock, Fetch, FetchResponse, ModelInfo, ProviderAdapter, ProviderId } from "./types.ts";
import { PROVIDER_IDS } from "./types.ts";

export interface ProbeOutcome { ok: boolean; models?: number; error?: { code: string; message: string } }

/** The driver as the pool and the engine see it. */
export interface ApiDriver {
  readonly kind: "api";
  readonly id: ProviderId;
  /** Only what the account can reach. Throws a DriverError when the provider refuses. */
  models(acct: AccountRef): Promise<ModelInfo[]>;
  /** "Test this account": the model list with no Space data. */
  probe(acct: AccountRef): Promise<ProbeOutcome>;
  open(spec: SessionSpec): Promise<ApiSession>;
}

export class DriverError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "DriverError"; this.code = code; }
}

export interface ApiDriverDeps {
  authorize: Authorizer;
  context: SessionDeps["context"];
  fetch?: Fetch;
  clock?: Clock;
  summarize?: SessionDeps["summarize"];
  retry?: SessionDeps["retry"];
  idleMs?: number;
  maxSteps?: number;
  random?: () => number;
  /** The account a session runs on: the agent's accountRef (the accounts module resolved it before the engine opened the session), with the address the account names for itself. */
  accountOf?: (spec: SessionSpec) => AccountRef;
}

/** https, or plain http to this machine only. A key is never sent anywhere else. */
export function okBase(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || (x.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(x.hostname));
  } catch { return false; }
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) => new Promise<void>((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const t = setTimeout(() => { signal?.removeEventListener("abort", done); resolve(); }, ms);
    const done = (): void => { clearTimeout(t); resolve(); };
    signal?.addEventListener("abort", done, { once: true });
  }),
};

export const realFetch: Fetch = async (url, init) => {
  const res = await globalThis.fetch(url, init);
  return {
    ok: res.ok,
    status: res.status,
    headers: res.headers,
    body: res.body as unknown as AsyncIterable<Uint8Array> | null,
    text: () => res.text(),
    json: () => res.json() as Promise<unknown>,
  } satisfies FetchResponse;
};

export const ADAPTERS: Readonly<Record<ProviderId, ProviderAdapter>> = Object.freeze({ anthropic, openai, openrouter, google, xai });

export function createApiDriver(adapter: ProviderAdapter, deps: ApiDriverDeps): ApiDriver {
  const doFetch = deps.fetch ?? realFetch;
  const clock = deps.clock ?? realClock;
  const accountOf = deps.accountOf ?? ((spec: SessionSpec): AccountRef => ({ ref: spec.agent.accountRef ?? "" }));

  const baseOf = (acct: AccountRef): string => {
    const base = acct.base ?? adapter.defaultBase;
    if (!okBase(base)) throw new DriverError("provider.bad_address", "That address is not a place a key may be sent.");
    return base;
  };

  async function get(acct: AccountRef): Promise<ModelInfo[]> {
    const base = baseOf(acct);
    const wire = adapter.modelsRequest();
    let auth: Record<string, string>;
    try { auth = await deps.authorize(acct, adapter.id); } catch { throw new DriverError("provider.auth_failed", "No usable key for this account."); }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    try {
      let res: FetchResponse;
      try { res = await doFetch(`${base.replace(/\/+$/, "")}${wire.path}`, { method: "GET", headers: { ...wire.headers, ...auth }, signal: ac.signal }); }
      catch { throw new DriverError("provider.network", "Could not reach the provider."); }
      if (!res.ok) {
        const text = (await res.text().catch(() => "")).slice(0, 200);
        throw new DriverError(classify(res.status, text).code, `The provider answered ${res.status}.`);
      }
      return adapter.parseModels(await res.json().catch(() => null));
    } finally { clearTimeout(timer); }
  }

  return {
    kind: "api",
    id: adapter.id,
    models: get,
    async probe(acct) {
      try {
        const models = await get(acct);
        return { ok: true, models: models.length };
      } catch (e) {
        const code = e instanceof DriverError ? e.code : "provider.network";
        return { ok: false, error: { code, message: e instanceof DriverError ? e.message : "Could not reach the provider." } };
      }
    },
    async open(spec) {
      const account = accountOf(spec);
      const base = baseOf(account);
      return createApiSession({
        adapter, account, base, fetch: doFetch, authorize: deps.authorize, clock, context: deps.context,
        ...(deps.summarize ? { summarize: deps.summarize } : {}),
        ...(deps.retry ? { retry: deps.retry } : {}),
        ...(deps.idleMs !== undefined ? { idleMs: deps.idleMs } : {}),
        ...(deps.maxSteps !== undefined ? { maxSteps: deps.maxSteps } : {}),
        ...(deps.random ? { random: deps.random } : {}),
      }, spec);
    },
  };
}

/** The five providers, one driver each. An OpenAI-compatible endpoint (OpenCode Go, a local model) is `createApiDriver(openaiCompatible({...}), deps)` with its own id. */
export function createApiDrivers(deps: ApiDriverDeps): ApiDriver[] {
  return PROVIDER_IDS.map((id) => createApiDriver(ADAPTERS[id], deps));
}

export { openaiCompatible };
