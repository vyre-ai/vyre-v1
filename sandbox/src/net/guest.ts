// What runs inside a walled sandbox (S8, spec 4.17): a sandbox with no network at all, only loopback, and one thing it can reach: a unix socket that leads to the egress proxy.
// A process in the sandbox speaks HTTP proxy to 127.0.0.1:3128 (the variables HTTP_PROXY and HTTPS_PROXY say so); this bridge, a few lines of plain Node that ship with the image, turns each
// of those connections into a connection to the socket, and the socket is the host's proxy and nothing else. There is no address to scan, no gateway, no host service to find: a process that
// unsets the variables has nowhere to go.
// The bridge is written to the folder the sandbox gets (read-only) by startNetWall, so the image needs only `node`, which the person-sandbox image is built on.

/** Where the folder with the socket and the bridge appears inside the sandbox. */
export const GUEST_DIR = "/run/vyre-net";
export const GUEST_SOCKET = `${GUEST_DIR}/proxy.sock`;
export const GUEST_BRIDGE = `${GUEST_DIR}/bridge.mjs`;
/** The CONNECT helper for programs that do not speak HTTP proxy (ssh's ProxyCommand): `node connect.mjs <proxy port> <host> <port>`. */
export const GUEST_CONNECT = `${GUEST_DIR}/connect.mjs`;
/** The loopback port the sandbox's proxy variables name. */
export const GUEST_PORT = 3128;

/**
 * usage: node bridge.mjs <socket> <port> [-- <program> <args>...]
 * With no program the bridge is the container's main process. With one it starts the program once the port is listening, passes its exit status on (128 plus the signal number when it died on a signal), and ends with it (bwrap).
 */
export const BRIDGE_SOURCE = `import net from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
const [socket, portArg, ...rest] = process.argv.slice(2);
const program = rest[0] === "--" ? rest.slice(1) : rest;
const port = Number(portArg);
const server = net.createServer((client) => {
  const up = net.connect(socket);
  client.on("error", () => up.destroy());
  up.on("error", () => client.destroy());
  client.pipe(up);
  up.pipe(client);
});
server.on("error", (e) => { console.error("bridge: " + e.message); process.exit(70); });
server.listen(port, "127.0.0.1", () => {
  if (program.length === 0) return;
  const child = spawn(program[0], program.slice(1), { stdio: "inherit" });
  child.on("error", (e) => { console.error("bridge: could not start " + program[0] + ": " + e.message); process.exit(127); });
  // a program that died on a signal ends the bridge the way a shell reports it, 128 plus the signal number (SIGKILL 137, SIGXCPU 152, SIGABRT 134), so the host can tell a processor-time or memory kill from any other end
  child.on("exit", (code, signal) => { server.close(); process.exit(code === null ? (signal ? 128 + (os.constants.signals[signal] ?? 0) : 1) : code); });
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
});
`;

/**
 * usage: node connect.mjs <proxy port on 127.0.0.1> <host> <port>
 * Asks the proxy for a tunnel (CONNECT host:port) and then carries stdin and stdout through it: ssh runs it as its ProxyCommand, so `git clone git@host:repo` reaches a public host through the wall.
 * A refusal or a host that does not answer ends it at once with one line on stderr saying so, which ssh and git show as they are; it never waits on a tunnel that will not open.
 */
export const CONNECT_SOURCE = `import net from "node:net";
const [portArg, host, target] = process.argv.slice(2);
const authority = host && host.includes(":") ? "[" + host + "]:" + target : host + ":" + target;
const s = net.connect(Number(portArg), "127.0.0.1");
s.setTimeout(30000, () => { process.stderr.write("vyre: " + authority + " did not answer through the network proxy\\n"); process.exit(1); });
s.on("error", (e) => { process.stderr.write("vyre: the network proxy is not reachable: " + e.message + "\\n"); process.exit(1); });
s.on("connect", () => s.write("CONNECT " + authority + " HTTP/1.1\\r\\nHost: " + authority + "\\r\\n\\r\\n"));
let buf = Buffer.alloc(0);
const onData = (d) => {
  buf = Buffer.concat([buf, d]);
  const end = buf.indexOf("\\r\\n\\r\\n");
  if (end < 0) { if (buf.length > 8192) process.exit(1); return; }
  s.off("data", onData);
  s.setTimeout(0);
  const status = buf.subarray(0, buf.indexOf("\\r\\n")).toString("latin1");
  if (!/^HTTP\\/1\\.[01] 200/.test(status)) {
    process.stderr.write("vyre: " + authority + " cannot be reached from here (" + status.replace(/^HTTP\\/1\\.[01] /, "") + "): this Space's network policy refused it, or the host did not answer\\n");
    process.exit(1);
  }
  const rest = buf.subarray(end + 4);
  if (rest.length > 0) process.stdout.write(rest);
  process.stdin.pipe(s);
  s.pipe(process.stdout);
  s.on("close", () => process.exit(0));
};
s.on("data", onData);
`;
