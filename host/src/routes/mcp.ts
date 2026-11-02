// The MCP module owns protocol/auth/tool semantics; the host only adapts its structural request/response port to the daemon's shared Node HTTP server, and says which address a request reached: a token is bound to that
// address, so the answer can never come from the Host header alone (see `origin` in the daemon).
import type http from "node:http";

export interface McpRuntime {
  handle(req: { method: string; headers: Record<string, string | undefined>; body: string; origin?: string }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  /** The sign-in addresses (/oauth/*, /.well-known/oauth-*): null for any other path. */
  oauth(req: { method: string; path: string; search: string; headers: Record<string, string | undefined>; body: string; origin: string | null; visitor: string }): Promise<{ status: number; headers: Record<string, string>; body: string } | null>;
}

const MAX_BODY = 1024 * 1024;
const SIGN_IN = /^\/(oauth\/|\.well-known\/oauth-)/;

export interface McpRouteDeps {
  runtime(): McpRuntime | null;
  /** The address this request reached, or null when this Space has none it can name. */
  origin(req: http.IncomingMessage): string | null;
}

export function createMcpRoute(deps: McpRouteDeps): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  return {
    handle(req, res) {
      const url = new URL(req.url ?? "/", "http://localhost");
      const signIn = SIGN_IN.test(url.pathname);
      if (url.pathname !== "/mcp" && !signIn) return false;
      void (async () => {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += b.length;
          if (size > MAX_BODY) {
            res.writeHead(413, { "content-type": "application/json", "cache-control": "no-store" });
            res.end(JSON.stringify({ error: "request too large" }));
            return;
          }
          chunks.push(b);
        }
        const live = deps.runtime();
        if (!live) {
          res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(JSON.stringify({ error: "MCP is not available" }));
          return;
        }
        const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]));
        const body = Buffer.concat(chunks).toString("utf8");
        const origin = deps.origin(req);
        if (signIn) {
          const visitor = typeof headers["x-vyre-visitor"] === "string" && headers["x-vyre-visitor"] !== "" ? headers["x-vyre-visitor"] : req.socket.remoteAddress ?? "";
          const out = await live.oauth({ method: req.method ?? "GET", path: url.pathname, search: url.search, headers, body, origin, visitor });
          if (!out) { res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify({ error: "not found" })); return; }
          res.writeHead(out.status, { "cache-control": "no-store", ...out.headers });
          res.end(out.body);
          return;
        }
        const out = await live.handle({ method: req.method ?? "GET", headers, body, ...(origin === null ? {} : { origin }) });
        res.writeHead(out.status, { ...out.headers, "cache-control": "no-store" });
        res.end(out.body);
      })().catch(() => {
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: "MCP request failed" }));
      });
      return true;
    },
  };
}
