// Every local socket the daemon makes (the MCP bridge of a CLI engine, the network wall of a sandbox) gets its path here, so a long data folder can never break one. A unix socket path holds
// about 104 bytes on a Mac and 108 on Linux; a Windows profile, a Mac's "~/Library/Application Support/<app>/..." or a deep home is already longer (the rc.14 Windows report: 116 characters).
//   - Windows: a named pipe, \\.\pipe\vyre-<tag>-<random>. Node listens and connects on one like on a unix socket. libuv opens the first instance with FILE_FLAG_FIRST_PIPE_INSTANCE, so a name
//     someone else took first fails to listen instead of being shared.
//   - Mac and Linux: the socket stays in the folder it belongs to (the sandbox's rule for that folder still decides who may reach it). When that path is too long it is reached through a short
//     link: a private (0700, random-named) folder under a short temp root holds one symlink to the folder. bind() and connect() follow the link to the real folder.
//   - A client that cannot see the link (inside bubblewrap /tmp is its own) uses `real` and connects relative to its folder (the MCP shim does that, modules/engine/mcp-bridge.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SandboxError } from "./types.ts";

/** Room for a unix socket path, under the smallest sun_path (104 bytes on a Mac, with its NUL). */
export const MAX_SOCKET_PATH = 100;

export interface LocalSocket {
  /** What the server listens on. */
  listen: string;
  /** What a client outside a sandbox connects to (the same as `listen`). */
  connect: string;
  /** The socket's real place: the folder it was asked for, joined with its name (Windows: the pipe). */
  real: string;
  /** Takes away what was made for it: the socket file and the link folder. Never throws. */
  remove(): void;
}

const randomHex = (bytes: number): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

/** A pipe name nobody else is likely to hold: \\.\pipe\vyre-<tag>-<16 hex>. */
export function pipeName(tag: string): string {
  const t = tag.replace(/[^a-z0-9-]/gi, "").toLowerCase().slice(0, 16) || "sock";
  return `\\\\.\\pipe\\vyre-${t}-${randomHex(8)}`;
}

/** A temp root short enough for a socket folder: the system's temp folder when it is short, /tmp otherwise (a long TMPDIR must not break it either). */
export function shortTempRoot(tmp: string = os.tmpdir()): string {
  try {
    const real = fs.realpathSync(tmp);
    if (Buffer.byteLength(real) <= 40) return real;
  } catch { /* a temp folder that is not there: /tmp */ }
  return fs.realpathSync("/tmp");
}

export interface SocketOptions { platform?: NodeJS.Platform; tmp?: string }

/** The socket `name` in `dir` (made if it is not there), or a pipe on Windows. `tag` names the pipe. */
export function localSocket(dir: string, name: string, tag: string, o: SocketOptions = {}): LocalSocket {
  const platform = o.platform ?? process.platform;
  if (platform === "win32") {
    const pipe = pipeName(tag);
    return { listen: pipe, connect: pipe, real: pipe, remove: () => undefined };
  }
  fs.mkdirSync(dir, { recursive: true });
  const real = path.join(fs.realpathSync(dir), name);
  const rmSock = (): void => { try { fs.rmSync(real, { force: true }); } catch { /* gone */ } };
  if (Buffer.byteLength(real) <= MAX_SOCKET_PATH) return { listen: real, connect: real, real, remove: rmSock };
  const alias = fs.mkdtempSync(path.join(shortTempRoot(o.tmp), "vyre-"));
  const rmAlias = (): void => { try { fs.rmSync(alias, { recursive: true, force: true }); } catch { /* gone */ } };
  const short = path.join(alias, "s", name);
  if (Buffer.byteLength(short) > MAX_SOCKET_PATH) {
    rmAlias();
    throw new SandboxError("sandbox.net", `the socket path is too long for a unix socket: ${short.length} characters`);
  }
  fs.symlinkSync(path.dirname(real), path.join(alias, "s"));
  return { listen: short, connect: short, real, remove: () => { rmSock(); rmAlias(); } };
}
