// Replay: run the recorded-response cases of connector.toml with no network. The same request building the platform runtime does (templates, domains, status to error),
// kept small here so the connector folder proves itself without importing the platform.
import type { ActionDef, Compiled, TestCase } from "./compile.ts";

const PLACEHOLDER = /\{input\.([A-Za-z0-9_.]+)\}/g;
const WHOLE = /^\{input\.([A-Za-z0-9_.]+)\}$/;
const pick = (input: unknown, path: string): unknown => path.split(".").reduce<unknown>((cur, k) => (cur !== null && typeof cur === "object" ? (cur as Record<string, unknown>)[k] : undefined), input);

function fill(t: unknown, input: unknown): unknown {
  if (typeof t === "string") {
    const w = WHOLE.exec(t);
    if (w) { const v = pick(input, w[1]!); if (v === undefined) throw new Error(`input.${w[1]} has no value`); return v; }
    return t.replace(PLACEHOLDER, (_m, p: string) => { const v = pick(input, p); if (v === undefined || v === null) throw new Error(`input.${p} has no value`); return encodeURIComponent(String(v)); });
  }
  if (Array.isArray(t)) return t.map((x) => fill(x, input));
  if (t && typeof t === "object") return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, fill(v, input)]));
  return t;
}

export interface Sent { method: string; url: string; query: Record<string, string>; body?: unknown }
export interface ReplayResult { ok: boolean; message?: string; output?: unknown; sent: Sent[] }

const ERRORS: [number, string][] = [[401, "provider.auth_failed"], [403, "provider.auth_failed"], [429, "provider.rate_limited"]];
const errorOf = (status: number): string | undefined => ERRORS.find(([s]) => s === status)?.[1] ?? (status >= 500 ? "provider.unavailable" : status >= 400 ? "provider.bad_response" : undefined);

const domainOk = (host: string, domains: string[]): boolean => domains.includes(host);

/** One action against recorded responses. Returns the output, or the catalogue error code the runtime would raise. */
export function replayAction(c: Compiled, a: ActionDef, input: unknown, responses: TestCase["responses"]): { output?: unknown; error?: string; sent: Sent[] } {
  const sent: Sent[] = [];
  const url = new URL(fill(a.url, input) as string);
  if (url.protocol !== "https:" || !domainOk(url.hostname, c.def.domains)) throw new Error(`egress refused for ${url.hostname}`);
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(a.query ?? {})) { query[k] = String(fill(v, input)); url.searchParams.set(k, query[k]); }
  const method = a.method ?? "GET";
  const body = a.body === undefined ? undefined : fill(a.body, input);
  sent.push({ method, url: `${url.origin}${url.pathname}`, query, ...(body !== undefined ? { body } : {}) });
  const hit = responses.find((r) => (r.method ?? "GET").toUpperCase() === method && r.url === `${url.origin}${url.pathname}`);
  if (!hit) throw new Error(`no recorded response for ${method} ${url.origin}${url.pathname}`);
  const err = errorOf(hit.status ?? 200);
  if (err) return { error: err, sent };
  return { output: hit.body, sent };
}

export function replayCase(c: Compiled, t: TestCase): ReplayResult {
  const a = c.def.actions.find((x) => x.name === t.action);
  if (!a) return { ok: false, message: `no action ${t.action}`, sent: [] };
  let r: ReturnType<typeof replayAction>;
  try { r = replayAction(c, a, t.input ?? {}, t.responses); } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e), sent: [] }; }
  if (t.expect?.error) return { ok: r.error === t.expect.error, ...(r.error === t.expect.error ? {} : { message: `expected ${t.expect.error}, got ${r.error ?? "an output"}` }), sent: r.sent };
  if (r.error) return { ok: false, message: `unexpected ${r.error}`, sent: r.sent };
  if (t.expect?.requests !== undefined && r.sent.length !== t.expect.requests) return { ok: false, message: `expected ${t.expect.requests} requests, made ${r.sent.length}`, sent: r.sent };
  return { ok: true, output: r.output, sent: r.sent };
}
