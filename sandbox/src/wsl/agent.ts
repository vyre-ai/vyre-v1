// Runs INSIDE Vyre's WSL2 distribution, started by the daemon on Windows (wsl.ts startWslAgent), with the distribution's own Node. It holds what a Linux daemon holds for its sandboxes:
//   - the net wall: the egress proxy and its unix socket (net/host.ts), the same code and the same policy as on a Linux server; the policy is replaced at each turn's start ("policy");
//   - one unix socket per MCP session in the wall's folder, which each sandbox gets read-only. Each connection is relayed, line by line, over this process's stdin and stdout to the daemon, which
//     checks the session's token and posts to the MCP endpoint. Nothing listens on a port.
// It ends when its stdin ends: a daemon that stops takes the agent, and so the wall, with it.
import dns from "node:dns";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { GUEST_DIR } from "../net/guest.ts";
import { startNetWall } from "../net/host.ts";
import type { AgentOptions } from "./wsl.ts";
import type { EgressRule } from "../egress-policy.ts";

const o = JSON.parse(Buffer.from(process.argv[2] ?? "", "base64").toString("utf8")) as AgentOptions;
const send = (m: Record<string, unknown>): void => { process.stdout.write(`${JSON.stringify(m)}\n`); };

let policy = o.wall;
const routes = o.testRoutes ?? {};
const PUBLIC_LOOKING = "93.184.215.14";
const testing = Object.keys(routes).length > 0;
const egress = testing ? {
  lookup: async (host: string): Promise<readonly string[]> => (routes[host] !== undefined ? [PUBLIC_LOOKING] : (await dns.promises.lookup(host, { all: true })).map((a) => a.address)),
  connect: (host: string, port: number, ip: string): Promise<net.Socket> => new Promise((resolve, reject) => {
    const s = routes[host] !== undefined ? net.connect(routes[host] as number, "127.0.0.1") : net.connect(port, ip);
    s.once("connect", () => resolve(s));
    s.once("error", reject);
  }),
} : {};

fs.mkdirSync(o.base, { recursive: true, mode: 0o700 });
// the policy is plain data from the daemon; the proxy reads its allow list at each connection, so a policy sent at a turn's start applies from that turn on
// the shared rule (egress-policy.ts, plain JSON) when the daemon sends one, else the allow list as a list rule
const ruleNow = (): EgressRule => (policy["rule"] as EgressRule | undefined) ?? { egress: "list", allow: [...policy.allow] };
const wall = await startNetWall({ allow: () => policy.allow, rule: ruleNow, egress, baseDir: o.base });

const servers = new Map<string, { server: net.Server; file: string }>();
const conns = new Map<string, net.Socket>();
let next = 0;

function openMcp(id: string): void {
  if (!/^[a-z0-9]{6,40}$/.test(id) || servers.has(id)) return;
  const file = path.join(wall.dir, `mcp-${id}.sock`);
  const server = net.createServer({ allowHalfOpen: true }, (c) => {
    const cid = `${id}.${++next}`;
    conns.set(cid, c);
    c.setEncoding("utf8");
    send({ t: "conn", s: id, c: cid });
    let buf = "";
    c.on("data", (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) { send({ t: "l", c: cid, l: buf.slice(0, i) }); buf = buf.slice(i + 1); }
    });
    c.once("end", () => send({ t: "end", c: cid }));
    c.on("error", () => c.destroy());
    c.once("close", () => conns.delete(cid));
  });
  server.listen(file, () => {
    fs.chmodSync(file, 0o666);
    servers.set(id, { server, file });
    send({ t: "mcp-ok", s: id, path: `${GUEST_DIR}/mcp-${id}.sock` });
  });
}

function closeMcp(id: string): void {
  const s = servers.get(id);
  if (!s) return;
  servers.delete(id);
  s.server.close();
  fs.rmSync(s.file, { force: true });
  for (const [cid, c] of conns) if (cid.startsWith(`${id}.`)) c.destroy();
}

let inBuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d: string) => {
  inBuf += d;
  let i: number;
  while ((i = inBuf.indexOf("\n")) >= 0) {
    const line = inBuf.slice(0, i).trim();
    inBuf = inBuf.slice(i + 1);
    if (line === "") continue;
    let m: { t?: string; s?: string; c?: string; l?: string; wall?: AgentOptions["wall"] };
    try { m = JSON.parse(line) as typeof m; } catch { continue; }
    if (m.t === "mcp" && typeof m.s === "string") openMcp(m.s);
    else if (m.t === "close" && typeof m.s === "string") closeMcp(m.s);
    else if (m.t === "policy" && m.wall && Array.isArray(m.wall.allow)) policy = m.wall;
    else if (m.t === "l" && typeof m.c === "string" && typeof m.l === "string") { const c = conns.get(m.c); if (c && !c.destroyed) c.write(`${m.l}\n`); }
    else if (m.t === "end" && typeof m.c === "string") conns.get(m.c)?.end();
    else if (m.t === "kill" && typeof m.c === "string") conns.get(m.c)?.destroy();
  }
});
const stop = async (): Promise<void> => { for (const id of [...servers.keys()]) closeMcp(id); await wall.close().catch(() => undefined); process.exit(0); };
process.stdin.once("end", () => void stop());
process.on("SIGTERM", () => void stop());

let splitUsr = false;
try { splitUsr = !fs.lstatSync("/bin").isSymbolicLink(); } catch { /* no /bin: merged */ }
send({ t: "ready", wallDir: wall.dir, splitUsr, node: process.execPath });
