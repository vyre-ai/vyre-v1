// What runs inside a walled sandbox (S8, spec 4.17): a sandbox with no network at all, only loopback, and one thing it can reach: a unix socket that leads to the egress proxy.
// A process in the sandbox speaks HTTP proxy to 127.0.0.1:3128 (the variables HTTP_PROXY and HTTPS_PROXY say so); this bridge, a few lines of plain Node that ship with the image, turns each
// of those connections into a connection to the socket, and the socket is the host's proxy and nothing else. There is no address to scan, no gateway, no host service to find: a process that
// unsets the variables has nowhere to go.
// The bridge is written to the folder the sandbox gets (read-only) by startNetWall, so the image needs only `node`, which the person-sandbox image is built on.

/** Where the folder with the socket and the bridge appears inside the sandbox. */
export const GUEST_DIR = "/run/vyre-net";
export const GUEST_SOCKET = `${GUEST_DIR}/proxy.sock`;
export const GUEST_BRIDGE = `${GUEST_DIR}/bridge.mjs`;
/** The loopback port the sandbox's proxy variables name. */
export const GUEST_PORT = 3128;

/**
 * usage: node bridge.mjs <socket> <port> [-- <program> <args>...]
 * With no program the bridge is the container's main process. With one it starts the program once the port is listening, passes its exit status on, and ends with it (bwrap).
 */
export const BRIDGE_SOURCE = `import net from "node:net";
import { spawn } from "node:child_process";
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
  child.on("exit", (code, signal) => { server.close(); process.exit(code === null ? (signal ? 128 : 1) : code); });
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => child.kill(s));
});
`;
