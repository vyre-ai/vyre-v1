// POST /local/chrome/agents { spaces } and DELETE /local/chrome/agents: the person opens their own Chrome to the agents of the Spaces they name, or closes it (the Vyre for Chrome panel and the
// desktop shell make this call; loopback and the daemon's admin token only). Nothing is stored: a restart closes it, as the extension's own opt-in is never kept.
import type http from "node:http";

const PATH = "/local/chrome/agents";
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function answer(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  res.end(text);
}

export function createChromeAgentsRoute(d: { token: string; optIn(spaces: string[]): void; opened(): string[]; sameToken(a: string, b: string): boolean }): { handle(req: http.IncomingMessage, res: http.ServerResponse): boolean } {
  return {
    handle(req, res) {
      if ((req.url ?? "/").split("?")[0] !== PATH) return false;
      const auth = String(req.headers["authorization"] ?? "");
      if (!LOOPBACK.has(req.socket.remoteAddress ?? "") || !auth.startsWith("Bearer ") || !d.sameToken(auth.slice(7).trim(), d.token)) { answer(res, 401, { error: { code: "auth.unauthenticated", message: "Authentication is required." } }); return true; }
      if (req.method === "GET") { answer(res, 200, { data: { spaces: d.opened() } }); return true; }
      if (req.method === "DELETE") { d.optIn([]); answer(res, 200, { data: { spaces: [] } }); return true; }
      if (req.method !== "POST") { answer(res, 405, { error: { code: "validation.method", message: "That method is not allowed here." } }); return true; }
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => { if (chunks.reduce((n, x) => n + x.length, 0) < 65_536) chunks.push(c); });
      req.on("end", () => {
        let spaces: string[] = [];
        try { const b = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { spaces?: unknown }; spaces = Array.isArray(b.spaces) ? b.spaces.filter((s): s is string => typeof s === "string" && /^spc_[a-z0-9]+$/.test(s)).slice(0, 50) : []; } catch { answer(res, 400, { error: { code: "validation.bad_input", message: "Send { spaces: [..] }." } }); return; }
        d.optIn(spaces);
        answer(res, 200, { data: { spaces } });
      });
      return true;
    },
  };
}
