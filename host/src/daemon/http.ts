// The daemon's HTTP face on node:http: `GET /healthz` (no auth, no secrets) and everything else through the gateway. The live socket upgrades on the same server (ws.ts owns the upgrade).
import http from "node:http";
import type { GatewayReq, GatewayRes } from "../gateway.ts";

export const MAX_BODY_BYTES = 5 * 1024 * 1024;

async function readBody(req: http.IncomingMessage): Promise<{ ok: true; json: unknown } | { ok: false; status: number; why: string }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const b = c as Buffer;
    size += b.length;
    if (size > MAX_BODY_BYTES) return { ok: false, status: 413, why: "the request body is too large" };
    chunks.push(b);
  }
  if (!size) return { ok: true, json: undefined };
  try { return { ok: true, json: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown }; }
  catch { return { ok: false, status: 400, why: "the request body is not JSON" }; }
}

const send = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store", ...headers });
  res.end(text);
};

export interface HttpDeps {
  gateway(req: GatewayReq): Promise<GatewayRes>;
  /** public facts only: ok, version, roles, head. Never a token, path or key. */
  health(): unknown;
  /** types a GET's query values by the capability schema (query.ts); absent = text as sent */
  coerce?(method: string, path: string, query: Record<string, string>): Record<string, unknown>;
}

export function requestListener(d: HttpDeps): http.RequestListener {
  return (req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://vyred");
        const method = (req.method ?? "GET").toUpperCase();
        if (url.pathname === "/healthz" && (method === "GET" || method === "HEAD")) { send(res, 200, d.health()); return; }
        const headers: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(", ") : v;
        headers["x-vyre-remote"] = req.socket.remoteAddress ?? "";   // after the copy: the socket's word, never the client's
        let body: unknown;
        if (method !== "GET" && method !== "HEAD") {
          const b = await readBody(req);
          if (!b.ok) { send(res, b.status, { error: { code: "validation.bad_input", message: b.why } }); return; }
          body = b.json;
        }
        const query: Record<string, string> = {};
        for (const [k, v] of url.searchParams) query[k] = v;
        const typed = d.coerce && method === "GET" ? d.coerce(method, url.pathname, query) : query;
        const r = await d.gateway({ method, path: url.pathname, headers, query: typed as Record<string, string>, ...(body !== undefined ? { body } : {}) });
        send(res, r.status, r.body, r.headers);
      } catch {
        send(res, 500, { error: { code: "internal.unexpected", message: "Something went wrong on our side." } });
      }
    })();
  };
}
