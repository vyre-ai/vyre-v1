// How a sandboxed CLI engine reaches Vyre's MCP endpoint (ruling 61). The sandbox has no network to the daemon's loopback, and none is opened. Instead the person's scratch folder, which the
// sandbox already holds, carries one unix socket per session. A tiny stdio program (the shim below) is what the CLI's MCP config starts: it reads JSON-RPC lines on stdin, sends them over the socket,
// and writes the replies to stdout. This side listens on the socket and posts each line to the real MCP endpoint with the session token as the bearer, so the endpoint's own token check still runs.
// The first line on a connection is {"auth": "<token>"}; a wrong token closes the connection before anything is posted.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { localSocket } from "../../sandbox/src/sock.ts";
import { toWslPath } from "../../sandbox/src/wsl/wsl.ts";
import type { WslAgent } from "../../sandbox/src/wsl/wsl.ts";

/** The program the CLI starts. Plain Node, no imports beyond the standard library. argv[2] is the socket (a pipe on Windows); the token comes from VYRE_MCP_TOKEN. */
export const SHIM_SOURCE = `import net from "node:net";
import path from "node:path";
const sock = process.argv[2];
const token = process.env.VYRE_MCP_TOKEN ?? "";
// vyre-hook mode: "<shim> <socket> hook <Event>" is what a CLI engine's generated hooks config runs. It sends the event the CLI wrote on stdin to Vyre and answers the way the CLI reads a hook: exit 2 with
// the reason on stderr stops the call, a note goes out as additional context. Any trouble reaching Vyre lets the call go on: a hook never stops work by failing.
if (process.argv[3] === "hook") {
  const event = process.argv[4] ?? "";
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => { raw += d; });
  process.stdin.on("end", () => {
    let payload = {};
    try { payload = JSON.parse(raw); } catch {}
    const done = (r) => {
      if (r && r.block) { process.stderr.write(String(r.block).slice(0, 400) + "\\n"); process.exit(2); }
      if (r && Array.isArray(r.notes) && r.notes.length > 0) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: r.notes.join("\\n") } }) + "\\n");
      process.exit(0);
    };
    if (!sock || !token) done(null);
    const timer = setTimeout(() => done(null), 50000);
    timer.unref();
    let c;
    try {
      if (sock.startsWith("\\\\") || Buffer.byteLength(sock) <= 100) c = net.connect(sock);
      else { process.chdir(path.dirname(sock)); c = net.connect(path.basename(sock)); }
    } catch { done(null); }
    let buf = "";
    c.on("error", () => done(null));
    c.on("connect", () => {
      c.write(JSON.stringify({ auth: token }) + "\\n");
      c.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "vyre/hook", params: { event, payload } }) + "\\n");
    });
    c.on("data", (d) => {
      buf += d;
      const i = buf.indexOf("\\n");
      if (i < 0) return;
      let r = null;
      try { r = JSON.parse(buf.slice(0, i)).result; } catch {}
      done(r);
    });
    c.on("close", () => done(null));
  });
} else {
if (!sock || !token) { process.stderr.write("vyre mcp shim: no socket or token\\n"); process.exit(2); }
// a pipe (Windows) or a short path is connected as it is; a path too long for a unix socket is reached from its own folder
let c;
if (sock.startsWith("\\\\") || Buffer.byteLength(sock) <= 100) c = net.connect(sock);
else { process.chdir(path.dirname(sock)); c = net.connect(path.basename(sock)); }
c.on("error", (e) => { process.stderr.write("vyre mcp shim: " + e.message + "\\n"); process.exit(1); });
c.on("connect", () => { c.write(JSON.stringify({ auth: token }) + "\\n"); process.stdin.pipe(c); });
c.pipe(process.stdout);
c.on("close", () => process.exit(0));
}
`;

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

/** The far end of one shim connection, whatever carries it (a unix socket here, the WSL agent's relay in sandbox/src/wsl). */
export interface McpWire { write(line: string): void; end(): void; destroy(): void }

/**
 * One connection from the shim: the first line is {"auth": "<token>"}, and a wrong token destroys the connection before anything is posted. Every later line is posted to the endpoint with the session
 * token as the bearer, and the replies come back as lines. When the shim ends its side, the replies still owed are written before this side ends.
 */
export function mcpConnection(m: { url: string; token: string }, doFetch: typeof fetch, wire: McpWire): { data(chunk: string): void; end(): void } {
  let buf = "";
  let authed = false;
  let sessionId: string | undefined;
  let pending = 0;
  let ended = false;
  let dead = false;
  const settle = (): void => { if (ended && pending === 0 && !dead) wire.end(); };
  return {
    end() { ended = true; settle(); },
    data(chunk) {
      if (dead) return;
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line === "") continue;
        if (!authed) {
          let tok: unknown;
          try { tok = (JSON.parse(line) as { auth?: unknown }).auth; } catch { tok = undefined; }
          if (tok !== m.token) { dead = true; wire.destroy(); return; }
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
            for (const out of replyLines(r.headers.get("content-type") ?? "", await r.text())) if (!dead) wire.write(out);
          } catch {
            // Preserve the request id. MCP clients wait for the matching id; id:null
            // turns an endpoint outage into a permanently running agent turn.
            let id: unknown = null;
            try { id = (JSON.parse(line) as { id?: unknown }).id ?? null; } catch { /* invalid JSON keeps null */ }
            if (!dead) wire.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32603, message: "The Vyre endpoint could not be reached." } }));
          } finally {
            pending--;
            settle();
          }
        })();
      }
    },
  };
}

export async function openMcpBridge(m: { url: string; token: string }, o: McpBridgeOptions): Promise<McpBridge> {
  const doFetch = o.fetch ?? fetch;
  fs.mkdirSync(o.scratch, { recursive: true });
  const shim = path.join(o.scratch, "mcp-shim.mjs");
  fs.writeFileSync(shim, SHIM_SOURCE, { mode: 0o644 });
  const name = `mcp-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("")}.sock`;
  // The socket lives in the scratch folder, so the sandbox's rule for that folder decides who reaches it. A data folder can be longer than a unix socket path holds (a Mac's Application Support, a
  // Windows profile): sandbox/src/sock.ts listens through a short private link there, and on Windows on a named pipe. Seatbelt resolves the link, so a Mac's shim is given the link; inside
  // bubblewrap /tmp is its own, so a Linux shim is given the real path and connects from the folder.
  const sock = localSocket(o.scratch, name, "mcp");
  const socket = process.platform === "linux" ? sock.real : sock.connect;
  const live = new Set<net.Socket>();
  const server = net.createServer({ allowHalfOpen: true }, (c) => {
    live.add(c);
    c.once("close", () => live.delete(c));
    c.on("error", () => c.destroy());
    c.setEncoding("utf8");
    const conn = mcpConnection(m, doFetch, { write: (l) => { if (!c.destroyed) c.write(`${l}\n`); }, end: () => { if (!c.destroyed) c.end(); }, destroy: () => c.destroy() });
    c.on("data", (chunk: string) => conn.data(chunk));
    c.once("end", () => conn.end());
  });
  try {
    await new Promise<void>((ok, bad) => { server.once("error", bad); server.listen(sock.listen, () => ok()); });
    if (process.platform !== "win32") fs.chmodSync(sock.listen, 0o600);
  } catch (e) {
    sock.remove();
    throw e;
  }
  return {
    stdio: { command: o.node ?? process.execPath, args: [shim, socket] },
    socket,
    async close() {
      for (const c of live) c.destroy();
      await new Promise<void>((ok) => server.close(() => ok()));
      sock.remove();
    },
  };
}

/**
 * The bridge for an engine in the Windows sandbox (sandbox/src/wsl): the same shim, written to the scratch folder, run by the VM's Node. Its socket is one the WSL agent opens in the wall's folder
 * (bound read-only into the sandbox). Each connection to it is relayed over the agent's own stdin and stdout and served here by mcpConnection, so the session's token is checked on this side and no
 * port is opened anywhere.
 */
export async function openWslMcpBridge(agent: Pick<WslAgent, "openMcp" | "closeMcp" | "node">, m: { url: string; token: string }, o: { scratch: string; fetch?: typeof fetch }): Promise<McpBridge> {
  const doFetch = o.fetch ?? fetch;
  fs.mkdirSync(o.scratch, { recursive: true });
  const shim = path.join(o.scratch, "mcp-shim.mjs");
  fs.writeFileSync(shim, SHIM_SOURCE, { mode: 0o644 });
  const id = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
  const socket = await agent.openMcp(id, (wire) => mcpConnection(m, doFetch, wire));
  return { stdio: { command: agent.node, args: [toWslPath(shim), socket] }, socket, async close() { agent.closeMcp(id); } };
}
