// How a sandboxed CLI engine reaches Vyre's MCP endpoint (ruling 61). The sandbox has no network to the daemon's loopback, and none is opened. Instead the person's scratch folder, which the
// sandbox already holds, carries one unix socket per session. A tiny stdio program (the shim below) is what the CLI's MCP config starts: it reads JSON-RPC lines on stdin, sends them over the socket,
// and writes the replies to stdout. This side listens on the socket and posts each line to the real MCP endpoint with the session token as the bearer, so the endpoint's own token check still runs.
// The first line on a connection is {"auth": "<token>"}; a wrong token closes the connection before anything is posted.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** The program the CLI starts. Plain Node, no imports beyond the standard library. argv[2] is the socket; the token comes from VYRE_MCP_TOKEN. */
export const SHIM_SOURCE = `import net from "node:net";
const sock = process.argv[2];
const token = process.env.VYRE_MCP_TOKEN ?? "";
if (!sock || !token) { process.stderr.write("vyre mcp shim: no socket or token\\n"); process.exit(2); }
// A unix socket path holds about 100 characters, and a Mac's data folder is longer than that: connect by name from inside the socket's own folder.
let at = sock;
try { const i = sock.lastIndexOf("/"); if (i > 0) { process.chdir(sock.slice(0, i)); at = sock.slice(i + 1); } } catch {}
const c = net.connect(at);
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
  const socket = path.join(o.scratch, `mcp-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("")}.sock`);
  // The daemon binds through a short symlink to the scratch folder when the real path is too long for a unix socket (a Mac's data folder is). The file lands in the scratch folder; only the name
  // given to bind(2) is short. The shim, inside the sandbox, goes to the scratch folder and connects by file name.
  let link: string | null = null;
  let bindAt = socket;
  if (Buffer.byteLength(socket) > MAX_SOCKET_PATH) {
    const short = path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", `vyre-m${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("")}`);
    fs.symlinkSync(o.scratch, short, "dir");
    link = short;
    bindAt = path.join(short, path.basename(socket));
    if (Buffer.byteLength(bindAt) > MAX_SOCKET_PATH) { fs.rmSync(short, { force: true }); throw new Error(`the MCP socket path is too long for a unix socket: ${bindAt.length} characters`); }
  }
  const live = new Set<net.Socket>();
  const server = net.createServer({ allowHalfOpen: true }, (c) => {
    live.add(c);
    c.once("close", () => live.delete(c));
    c.on("error", () => c.destroy());
    c.setEncoding("utf8");
    let buf = "";
    let authed = false;
    let sessionId: string | undefined;
    // The shim ends its side when stdin ends; replies still owed are written before this side ends.
    let pending = 0;
    let ended = false;
    const settle = (): void => { if (ended && pending === 0 && !c.destroyed) c.end(); };
    c.once("end", () => { ended = true; settle(); });
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
        pending++;
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
            // Preserve the request id. MCP clients wait for the matching id; id:null
            // turns an endpoint outage into a permanently running agent turn.
            let id: unknown = null;
            try { id = (JSON.parse(line) as { id?: unknown }).id ?? null; } catch { /* invalid JSON keeps null */ }
            if (!c.destroyed) c.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message: "The Vyre endpoint could not be reached." } })}\n`);
          } finally {
            pending--;
            settle();
          }
        })();
      }
    });
  });
  await new Promise<void>((ok, bad) => { server.once("error", bad); server.listen(bindAt, () => ok()); });
  fs.chmodSync(socket, 0o600);
  return {
    stdio: { command: o.node ?? process.execPath, args: [shim, socket] },
    socket,
    async close() {
      for (const c of live) c.destroy();
      await new Promise<void>((ok) => server.close(() => ok()));
      fs.rmSync(socket, { force: true });
      if (link) fs.rmSync(link, { force: true });
    },
  };
}
