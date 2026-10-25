// The host side of a walled sandbox (S8): the egress proxy on the machine's loopback, a unix socket in a folder of its own that leads to it, and the bridge program for the inside. The folder is
// what the sandbox gets, read-only: the socket and bridge.mjs, nothing else. Only this process and the sandbox ever hold the other end of the socket.
//
// The proxy listens on 127.0.0.1 of the host. The sandbox has no network, so it cannot open that port; the socket is its only way to it. The socket's mode is 0666 inside a folder only this sandbox
// is given: anything that can open the folder can use the proxy, which is the allow-list and nothing more.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createEgressProxy } from "../egress.ts";
import type { EgressOptions } from "../egress.ts";
import { SandboxError } from "../types.ts";
import { BRIDGE_SOURCE } from "./guest.ts";

export interface NetWallOptions {
  /** Host patterns the proxy lets through (the person's egress list). */
  allow: readonly string[];
  /** How the proxy resolves and connects, and who watches. Default: the system's. */
  egress?: Partial<EgressOptions>;
  /** Where to make the folder. Default: the system's temp folder. Linux hosts only (a unix socket path must stay under 100 characters). */
  baseDir?: string;
}

export interface NetWall {
  /** The folder the sandbox is given (read-only): proxy.sock and bridge.mjs. */
  dir: string;
  socket: string;
  /** The proxy's own port on the host's loopback, for tests that must prove the sandbox cannot use it directly. */
  proxyPort: number;
  close(): Promise<void>;
}

const MAX_SOCKET_PATH = 100;

export async function startNetWall(o: NetWallOptions): Promise<NetWall> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(o.baseDir ?? os.tmpdir(), "vyre-net-")));
  const socket = path.join(dir, "proxy.sock");
  if (Buffer.byteLength(socket) > MAX_SOCKET_PATH) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new SandboxError("sandbox.net", `the socket path is too long for a unix socket: ${socket.length} characters`);
  }
  const proxy = createEgressProxy({ ...o.egress, allow: o.allow });
  const live = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const up = net.connect({ host: "127.0.0.1", port });
    for (const s of [client, up]) { live.add(s); s.once("close", () => live.delete(s)); }
    client.on("error", () => up.destroy());
    up.on("error", () => client.destroy());
    client.pipe(up);
    up.pipe(client);
  });
  let port = 0;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    for (const s of live) s.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await proxy.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  try {
    port = (await proxy.listen(0, "127.0.0.1")).port;
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socket, () => { server.off("error", reject); resolve(); }); });
    // The sandbox user is not this process's user: it needs to walk the folder and connect to the socket.
    fs.chmodSync(dir, 0o755);
    fs.chmodSync(socket, 0o666);
    fs.writeFileSync(path.join(dir, "bridge.mjs"), BRIDGE_SOURCE, { mode: 0o644 });
  } catch (e) {
    await close().catch(() => undefined);
    throw e;
  }
  return { dir, socket, proxyPort: port, close };
}
