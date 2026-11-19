// The MCP module owns protocol/auth/tool semantics; the host only adapts its structural request/response port to the daemon's shared Node HTTP server, and says which address a request reached: a token is bound to that
// address, so the answer can never come from the Host header alone (see `origin` in the daemon).
import type http from "node:http";
import { PROOF_HEADER, provesRelay } from "../seams/visitor-proof.ts";

export interface McpRuntime {
  handle(req: {
    method: string;
    headers: Record<string, string | undefined>;
    body: string;
    origin?: string;
  }): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
    /** A response that stays open: sent after the status and headers; ends when the promise settles. */
    stream?: (out: { write(chunk: string): void; closed: Promise<void> }) => Promise<void>;
  }>;
  /** The sign-in addresses (/oauth/*, /.well-known/oauth-*): null for any other path. */
  oauth(req: {
    method: string;
    path: string;
    search: string;
    headers: Record<string, string | undefined>;
    body: string;
    origin: string | null;
    visitor: string;
  }): Promise<{ status: number; headers: Record<string, string>; body: string } | null>;
}

const MAX_BODY = 1024 * 1024;
/** The most a stream may have written and not yet delivered before it is cut. */
const MAX_BUFFERED = 256 * 1024;
const SIGN_IN = /^\/(oauth\/|\.well-known\/oauth-)/;

/**
 * Who is asking, for the per-visitor limits. The relay forwards over the loopback, writes the address it saw in x-vyre-visitor and proves it is the relay with a secret that exists only in this process (seams/visitor-proof.ts).
 * The header is believed only with that proof, on a loopback connection. From anyone else (a client reaching the daemon directly, a local proxy that passes headers through, another process on the host) the header is
 * ignored and the connection's own address stands, so no one picks the identity the limits count.
 */
export function visitorOf(headers: Record<string, string | undefined>, remote: string): string {
  const loop = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  const said = headers["x-vyre-visitor"];
  return loop && provesRelay(headers[PROOF_HEADER]) && typeof said === "string" && said !== "" ? said.slice(0, 64) : remote;
}

export interface McpRouteDeps {
  runtime(): McpRuntime | null;
  /** The address this request reached, or null when this Space has none it can name. */
  origin(req: http.IncomingMessage): string | null;
}

export function createMcpRoute(deps: McpRouteDeps): {
  handle(req: http.IncomingMessage, res: http.ServerResponse): boolean;
} {
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
        const headers = Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]),
        );
        const body = Buffer.concat(chunks).toString("utf8");
        const origin = deps.origin(req);
        if (signIn) {
          const visitor = visitorOf(headers, req.socket.remoteAddress ?? "");
          const out = await live.oauth({
            method: req.method ?? "GET",
            path: url.pathname,
            search: url.search,
            headers,
            body,
            origin,
            visitor,
          });
          if (!out) {
            res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
            res.end(JSON.stringify({ error: "not found" }));
            return;
          }
          res.writeHead(out.status, { "cache-control": "no-store", ...out.headers });
          res.end(out.body);
          return;
        }
        const out = await live.handle({
          method: req.method ?? "GET",
          headers,
          body,
          ...(origin === null ? {} : { origin }),
        });
        res.writeHead(out.status, { ...out.headers, "cache-control": "no-store" });
        if (out.stream) {
          // an open stream: every write goes out at once; it ends when the app goes away or the server ends it
          const closed = new Promise<void>((resolve) => {
            // the response's own close: a request's close fires once its body is read, which is not the app going away.
            // An app that went away while the runtime was answering has already closed it: that settles at once.
            if (res.destroyed || res.writableEnded) resolve();
            else res.once("close", resolve);
          });
          res.flushHeaders();
          try {
            await out.stream({
              write: (chunk) => {
                if (res.writableEnded || res.destroyed) return;
                // a client that stops reading does not make the server hold what it was never sent: past this much waiting the stream is cut
                if (res.writableLength > MAX_BUFFERED) {
                  res.destroy();
                  return;
                }
                res.write(chunk);
              },
              closed,
            });
          } finally {
            res.end();
          }
          return;
        }
        res.end(out.body);
      })().catch(() => {
        if (!res.headersSent) res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: "MCP request failed" }));
      });
      return true;
    },
  };
}
