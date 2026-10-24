// ctx.http: egress restricted to the connector's declared domains (ARCH B2, ConnectorDef.domains). https only, exact host or a subdomain of a listed domain,
// and redirects are followed by hand so a redirect cannot leave the list. A module with no connector has an empty list: every call is refused.
import { fail } from "../routes/errors.ts";

export interface FetchLike { (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; redirect?: "manual" }): Promise<{ status: number; headers: { get(n: string): string | null }; text(): Promise<string> }> }
export type GuardedFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;

export function hostAllowed(host: string, domains: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return domains.some((d) => { const x = d.toLowerCase().replace(/^\*\./, ""); return h === x || h.endsWith(`.${x}`); });
}

export function guardedFetch(domains: readonly string[], traceId: string, doFetch: FetchLike = (u, i) => globalThis.fetch(u, i as RequestInit) as never): GuardedFetch {
  const check = (raw: string): URL => {
    let u: URL;
    try { u = new URL(raw); } catch { throw fail("validation.bad_input", traceId, { details: { errors: ["url: not a URL"] } }); }
    if (u.protocol !== "https:" || u.username || u.password || !hostAllowed(u.hostname, domains)) {
      throw fail("permission.no_grant", traceId, { message: "This module may not reach that address.", details: { host: u.hostname, allowed: [...domains] } });
    }
    return u;
  };
  return async (url, init) => {
    let u = check(url);
    let method = init?.method, body = init?.body;
    for (let hop = 0; hop < 5; hop++) {
      const r = await doFetch(u.toString(), { ...(method ? { method } : {}), ...(init?.headers ? { headers: init.headers } : {}), ...(body !== undefined ? { body } : {}), redirect: "manual" });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
        u = check(new URL(r.headers.get("location")!, u).toString());
        if (r.status === 303 || ((r.status === 301 || r.status === 302) && method === "POST")) { method = "GET"; body = undefined; }
        continue;
      }
      return { status: r.status, text: () => r.text() };
    }
    throw fail("provider.bad_response", traceId, { details: { why: "too many redirects" } });
  };
}
