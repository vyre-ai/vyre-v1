// The Caddy admin API client (ARCH 7.6, 7.13): JSON over HTTP at localhost:2019. Caddy has one config tree; this class reads and writes it by path or by @id and reports
// what Caddy said. A 404 on a read is "not there" (undefined), every other non-2xx is a CaddyError with Caddy's own message.
export type AdminFetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

export class CaddyError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "CaddyError";
    this.status = status;
    this.body = body;
  }
}

export interface AdminOptions {
  fetch?: AdminFetch;
  /** default http://localhost:2019 */
  baseUrl?: string;
  /** default 5000 */
  timeoutMs?: number;
}

export class CaddyAdmin {
  private f: AdminFetch;
  private base: string;
  private timeoutMs: number;

  constructor(o: AdminOptions = {}) {
    this.f = o.fetch ?? ((url, init) => globalThis.fetch(url, init as never));
    this.base = (o.baseUrl ?? "http://localhost:2019").replace(/\/$/, "");
    this.timeoutMs = o.timeoutMs ?? 5000;
  }

  /** One call. `path` starts with /config/, /id/ or /load. Returns the parsed body, or undefined for a 404 or an empty/`null` body. */
  async call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<unknown | undefined> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    timer.unref();
    let r: { status: number; text(): Promise<string> };
    try {
      r = await this.f(`${this.base}${path}`, {
        method, signal: ctl.signal,
        ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      const why = ctl.signal.aborted ? `no answer within ${this.timeoutMs} ms` : e instanceof Error ? e.message : String(e);
      throw new CaddyError(`Caddy admin API did not answer: ${why}`, 0, "");
    } finally {
      clearTimeout(timer);
    }
    const text = await r.text();
    if (r.status === 404 && method === "GET") return undefined;
    if (r.status < 200 || r.status >= 300) {
      let msg = text.slice(0, 300);
      try { const e = JSON.parse(text) as { error?: unknown }; if (typeof e.error === "string") msg = e.error; } catch { /* plain text body */ }
      throw new CaddyError(`Caddy refused ${method} ${path} (${r.status}): ${msg}`, r.status, text);
    }
    if (!text.trim()) return undefined;
    try {
      const v: unknown = JSON.parse(text);
      return v === null ? undefined : v;
    } catch {
      throw new CaddyError(`Caddy answered ${method} ${path} with something that is not JSON`, r.status, text.slice(0, 300));
    }
  }

  get(path: string): Promise<unknown | undefined> { return this.call("GET", path); }
  /** The whole running config, or undefined when Caddy has none loaded. */
  config(): Promise<Record<string, unknown> | undefined> { return this.get("/config/") as Promise<Record<string, unknown> | undefined>; }
  /** Replace the entire config atomically (Caddy validates it first and keeps the old one if it is refused). */
  load(config: unknown): Promise<unknown> { return this.call("POST", "/load", config); }
  byId(id: string): Promise<unknown | undefined> { return this.get(`/id/${encodeURIComponent(id)}`); }
  replaceById(id: string, value: unknown): Promise<unknown> { return this.call("PATCH", `/id/${encodeURIComponent(id)}`, value); }
  deleteById(id: string): Promise<unknown> { return this.call("DELETE", `/id/${encodeURIComponent(id)}`); }
  append(path: string, value: unknown): Promise<unknown> { return this.call("POST", path, value); }
}
