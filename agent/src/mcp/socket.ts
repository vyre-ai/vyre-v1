// The per-session MCP socket (ruling 61): a CLI engine inside a sandbox cannot reach the daemon's loopback port, so Vyre's tools come to it as a unix socket bind-mounted into the sandbox and a
// tiny stdio shim (shim.ts) that the CLI's MCP config runs as its server. The listener here carries one JSON-RPC message per line from the shim into the same McpServer.handle the HTTP
// endpoint uses, so tool lists, scopes, the invoke pipeline, the Gate and the audit are the same code. The token is still checked: every frame carries it and `handle` refuses an unknown,
// expired or revoked one (401). The socket file is the person's session only (directory 0700, socket 0600).
//
//   frame in    {"n": 1, "token": "...", "session"?: "...", "body": "<json-rpc text>"}\n
//   frame out   {"n": 1, "status": 200, "session"?: "...", "body": "<json-rpc text>"}   (n echoes the frame it answers; answers may come in any order)\n
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { McpServer } from "./types.ts";

interface Answer { n?: number; status: number; session?: string; body: string }
export interface McpSocket { path: string; close(): Promise<void> }

const MAX_FRAME = 2 * 1024 * 1024;
/** sockaddr_un.sun_path holds 104 bytes on a Mac and 108 on Linux. */
const MAX_PATH = 100;

export async function listenMcpSocket(server: Pick<McpServer, "handle">, socketPath: string): Promise<McpSocket> {
  if (!path.isAbsolute(socketPath) || Buffer.byteLength(socketPath) > MAX_PATH) throw new RangeError("the socket path must be absolute and shorter than 100 bytes");
  fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  try { fs.unlinkSync(socketPath); } catch { /* none left from an earlier run */ }

  const conns = new Set<net.Socket>();
  const srv = net.createServer((conn) => {
    conns.add(conn);
    conn.once("close", () => conns.delete(conn));
    conn.on("error", () => conn.destroy());
    conn.setEncoding("utf8");
    let buf = "";
    const reply = (o: Answer): void => { if (!conn.destroyed) conn.write(`${JSON.stringify(o)}\n`); };
    conn.on("data", (chunk: string) => {
      buf += chunk;
      if (buf.length > MAX_FRAME && !buf.includes("\n")) { reply({ status: 413, body: "" }); conn.destroy(); return; }
      for (let at = buf.indexOf("\n"); at >= 0; at = buf.indexOf("\n")) {
        const line = buf.slice(0, at);
        buf = buf.slice(at + 1);
        if (line.trim() === "") continue;
        void frame(line, reply);
      }
    });
  });

  async function frame(line: string, reply: (o: Answer) => void): Promise<void> {
    let f: { n?: unknown; token?: unknown; session?: unknown; body?: unknown };
    try { f = JSON.parse(line) as typeof f; } catch { reply({ status: 400, body: "" }); return; }
    const n = typeof f.n === "number" ? f.n : undefined;
    const say = (o: Answer): void => reply(n === undefined ? o : { ...o, n });
    if (typeof f.token !== "string" || f.token === "" || typeof f.body !== "string") { say({ status: 401, body: "" }); return; }
    try {
      const r = await server.handle({
        method: "POST",
        headers: { authorization: `Bearer ${f.token}`, "content-type": "application/json", accept: "application/json", ...(typeof f.session === "string" ? { "mcp-session-id": f.session } : {}) },
        body: f.body,
      });
      const session = r.headers["mcp-session-id"];
      say({ status: r.status, ...(session === undefined ? {} : { session }), body: r.body });
    } catch {
      say({ status: 500, body: "" });
    }
  }

  await new Promise<void>((resolve, reject) => { srv.once("error", reject); srv.listen(socketPath, () => { srv.off("error", reject); resolve(); }); });
  fs.chmodSync(socketPath, 0o600);
  return {
    path: socketPath,
    close: () => new Promise<void>((resolve) => {
      for (const c of conns) c.destroy();
      srv.close(() => { try { fs.unlinkSync(socketPath); } catch { /* already gone */ } resolve(); });
    }),
  };
}
