// How a sandboxed CLI engine reaches Vyre's MCP endpoint (ruling 61). The sandbox has no network to the daemon's loopback, and none is opened. Instead the person's scratch folder, which the
// sandbox already holds, carries one unix socket per session. A tiny stdio program (the shim below) is what the CLI's MCP config starts: it reads JSON-RPC lines on stdin, sends them over the socket,
// and writes the replies to stdout. This side listens on the socket and posts each line to the real MCP endpoint with the session token as the bearer, so the endpoint's own token check still runs.
// The first line on a connection is {"auth": "<token>"}; a wrong token closes the connection before anything is posted.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import crypto from "node:crypto";

/** The program the CLI starts. Plain Node, no imports beyond the standard library. argv[2] is the socket; the token comes from VYRE_MCP_TOKEN. */
export const SHIM_SOURCE = `import net from "node:net";
const sock = process.argv[2];
const token = process.env.VYRE_MCP_TOKEN ?? "";
if (!sock || !token) { process.stderr.write("vyre mcp shim: no socket or token\\n"); process.exit(2); }
const c = net.connect(sock);
c.on("error", (e) => { process.stderr.write("vyre mcp shim: " + e.message + "\\n"); process.exit(1); });
c.on("connect", () => { c.write(JSON.stringify({ auth: token }) + "\\n"); process.stdin.pipe(c); });
c.pipe(process.stdout);
c.on("close", () => process.exit(0));
`;

const MAX_SOCKET_PATH = 100;

export interface McpBridgeOptions {
  /** The person's scratch folder: the sandbox holds it read-write, so the socket and the shim live there. */
  scratch: string;
  /** The Node that runs the shim inside the sandbox. Default: this process's. */
  node?: string;
  fetch?: typeof fetch;
}

export interface McpBridge { stdio: { command: string; args: string[] }; socket: string; close(): Promise<void> }

/** Frames a reply from the MCP endpoint into lines: one JSON body is one line; an event stream gives one line per `data:` event. */
function replyLines(contentType: string, text: string): string[] {
  if (contentType.includes("text/event-stream")) {
    return text.split(/\r?\n\r?\n/).map((ev) => ev.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n")).filter((d) => d !== "");
  }
  const t = text.trim();
  return t === "" ? [] : [t.replace(/\r?\n/g, " ")];
}

export async function openMcpBridge(m: { url: string; token: string }, o: McpBridgeOptions): Promise<McpBridge> {
  const doFetch = o.fetch ?? fetch;
  fs.mkdirSync(o.scratch, { recursive: true });
  const shim = path.join(o.scratch, "mcp-shim.mjs");
  fs.writeFileSync(shim, SHIM_SOURCE, { mode: 0o644 });
  const socket = path.join(o.scratch, `mcp-${crypto.randomBytes(6).toString("hex")}.sock`);
  if (Buffer.byteLength(socket) > MAX_SOCKET_PATH) throw new Error(`the MCP socket path is too long for a unix socket: ${socket.length} characters`);
  const live = new Set<net.Socket>();
  const server = net.createServer((c) => {
    live.add(c);
    c.once("close", () => live.delete(c));
    c.on("error", () => c.destroy());
    c.setEncoding("utf8");
    let buf = "";
    let authed = false;
    let sessionId: string | undefined;
    c.on("data", (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line === "") continue;
        if (!authed) {
          let tok: unknown;
          try { tok = (JSON.parse(line) as { auth?: unknown }).auth; } catch { tok = undefined; }
          if (tok !== m.token) { c.destroy(); return; }
          authed = true;
          continue;
        }
        void (async () => {
          try {
            const r = await doFetch(m.url, {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${m.token}`, ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
              body: line,
            });
            const sid = r.headers.get("mcp-session-id");
            if (sid) sessionId = sid;
            for (const out of replyLines(r.headers.get("content-type") ?? "", await r.text())) if (!c.destroyed) c.write(`${out}\n`);
          } catch {
            if (!c.destroyed) c.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "The Vyre endpoint could not be reached." } })}\n`);
          }
        })();
      }
    });
  });
  await new Promise<void>((ok, bad) => { server.once("error", bad); server.listen(socket, () => ok()); });
  fs.chmodSync(socket, 0o600);
  return {
    stdio: { command: o.node ?? process.execPath, args: [shim, socket] },
    socket,
    async close() {
      for (const c of live) c.destroy();
      await new Promise<void>((ok) => server.close(() => ok()));
      fs.rmSync(socket, { force: true });
    },
  };
}
