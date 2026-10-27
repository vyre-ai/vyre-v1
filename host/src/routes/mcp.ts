// The MCP module owns protocol/auth/tool semantics; the host only adapts its
// structural request/response port to the daemon's shared Node HTTP server.
import type http from "node:http";

export interface McpRuntime {
  handle(req: { method: string; headers: Record<string, string | undefined>; body: string }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

const MAX_BODY = 1024 * 1024;

export function createMcpRoute(runtime: () => McpRuntime | null): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  return {
    handle(req, res) {
      if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") return false;
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
        const live = runtime();
        if (!live) {
          res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(JSON.stringify({ error: "MCP is not available" }));
          return;
        }
        const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]));
        const out = await live.handle({ method: req.method ?? "GET", headers, body: Buffer.concat(chunks).toString("utf8") });
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
