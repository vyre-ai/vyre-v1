// An in-memory Caddy admin API for tests: the config tree, /load, /id/<id> and the routes array of a server, with Caddy's status codes for the cases the driver meets
// (404 for an unknown id on GET, 400 for a duplicate @id on append). Every request is kept in `calls` so a test can assert what reached Caddy.
import type { AdminFetch } from "./admin.ts";

type Json = Record<string, unknown>;
export interface FakeCall { method: string; path: string; body?: unknown }

export class FakeCaddy {
  config: Json | null = null;
  calls: FakeCall[] = [];
  /** answer the next request with this status and body instead of handling it */
  failNext: { status: number; body: string } | null = null;
  /** make every request fail like a connection refused */
  down = false;
  /** runs just before an append is checked, so a test can play a second writer */
  beforeAppend: ((route: Json) => void) | null = null;

  fetch: AdminFetch = async (url, init) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(init.body) as unknown) : undefined;
    this.calls.push({ method, path: u.pathname, ...(body !== undefined ? { body } : {}) });
    if (this.down) throw new Error("connect ECONNREFUSED 127.0.0.1:2019");
    if (this.failNext) { const f = this.failNext; this.failNext = null; return reply(f.status, f.body); }
    return this.handle(method, u.pathname, body);
  };

  private servers(): Json[] {
    const s = ((this.config?.["apps"] as Json | undefined)?.["http"] as Json | undefined)?.["servers"] as Json | undefined;
    return s ? Object.values(s).filter((v): v is Json => !!v && typeof v === "object") : [];
  }

  private find(id: string): { routes: Json[]; index: number } | null {
    for (const s of this.servers()) {
      const routes = s["routes"];
      if (!Array.isArray(routes)) continue;
      const index = (routes as Json[]).findIndex((r) => r["@id"] === id);
      if (index >= 0) return { routes: routes as Json[], index };
    }
    return null;
  }

  private handle(method: string, path: string, body: unknown): { status: number; text(): Promise<string> } {
    if (path === "/config/" && method === "GET") return reply(200, JSON.stringify(this.config));
    if (path === "/load" && method === "POST") { this.config = JSON.parse(JSON.stringify(body)) as Json; return reply(200, ""); }
    const id = path.startsWith("/id/") ? decodeURIComponent(path.slice(4)) : null;
    if (id !== null) {
      const hit = this.find(id);
      if (!hit) return reply(404, JSON.stringify({ error: `unknown object ID '${id}'` }));
      if (method === "GET") return reply(200, JSON.stringify(hit.routes[hit.index]));
      if (method === "PATCH") { hit.routes[hit.index] = JSON.parse(JSON.stringify(body)) as Json; return reply(200, ""); }
      if (method === "DELETE") { hit.routes.splice(hit.index, 1); return reply(200, ""); }
    }
    const m = /^\/config\/apps\/http\/servers\/([^/]+)\/routes$/.exec(path);
    if (m && method === "POST") {
      const server = ((this.config?.["apps"] as Json | undefined)?.["http"] as Json | undefined)?.["servers"] as Json | undefined;
      const s = server?.[m[1]!] as Json | undefined;
      if (!s) return reply(400, JSON.stringify({ error: "invalid traversal path" }));
      const route = JSON.parse(JSON.stringify(body)) as Json;
      this.beforeAppend?.(route);
      if (this.find(String(route["@id"]))) return reply(400, JSON.stringify({ error: `duplicate ID '${String(route["@id"])}' found in configuration` }));
      (s["routes"] as Json[]).push(route);
      return reply(200, "");
    }
    return reply(404, JSON.stringify({ error: `no handler for ${method} ${path}` }));
  }
}

const reply = (status: number, text: string): { status: number; text(): Promise<string> } => ({ status, text: async () => text });
