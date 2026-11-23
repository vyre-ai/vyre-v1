// Platform glue: everything the daemon asks of the machine it runs on (commands, free disk, file reads, the clock), behind one interface so probes and doctor run against recorded output in tests.
// The real implementation uses node:child_process and node:fs only. Nothing here assumes Linux or macOS beyond what a probe checks for itself.
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}
export interface RunOptions {
  timeoutMs?: number;
  input?: string;
}
export type OsName = "darwin" | "linux" | "win32" | "other";

export interface Platform {
  readonly os: OsName;
  readonly hostname: string;
  /** Run a command without a shell. Exit 127 = not found, 124 = timed out. Never rejects. */
  run(cmd: string, args: readonly string[], o?: RunOptions): Promise<RunResult>;
  /** Bytes free for an unprivileged user on the volume holding `dir`, or null when unknown. */
  freeBytes(dir: string): number | null;
  /** The text of a file, or null when it cannot be read. */
  readFile(file: string): string | null;
  /**
   * Ask Docker's own socket for its version, without starting a process: the daemon holds gigabytes, and forking a command from it (as the probe did every minute) cost a quarter of a second of the loop on the
   * mini. `null` when there is no socket to ask (the CLI answers then), else the version or why it did not answer.
   */
  dockerVersion?(timeoutMs: number): Promise<{ version: string } | { error: "down" | "timeout" } | null>;
  now(): number;
}

/** The unix socket Docker listens on for this process: DOCKER_HOST when it names one, else the default path when it exists. `null`: a TCP host, a context only the CLI resolves, or no socket. */
function dockerSocket(): string | null {
  const host = process.env["DOCKER_HOST"];
  if (host) return host.startsWith("unix://") ? host.slice("unix://".length) : null;
  const def = "/var/run/docker.sock";
  try {
    return fs.statSync(def).isSocket() ? def : null;
  } catch {
    return null;
  }
}

export function dockerVersionOverSocket(
  timeoutMs: number,
): Promise<{ version: string } | { error: "down" | "timeout" } | null> {
  const socketPath = dockerSocket();
  if (socketPath === null) return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = http.request({ socketPath, path: "/version", method: "GET", timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { Version?: unknown };
          resolve(res.statusCode === 200 && typeof v.Version === "string" ? { version: v.Version } : { error: "down" });
        } catch {
          resolve({ error: "down" });
        }
      });
    });
    req.on("timeout", () => {
      resolve({ error: "timeout" });
      req.destroy();
    });
    req.on("error", () => resolve({ error: "down" }));
    req.end();
  });
}

const osName = (p: string): OsName => (p === "darwin" || p === "linux" || p === "win32" ? p : "other");

export function nodePlatform(): Platform {
  return {
    os: osName(process.platform),
    hostname: os.hostname(),
    run: (cmd, args, o) =>
      new Promise<RunResult>((resolve) => {
        const child = execFile(
          cmd,
          [...args],
          { timeout: o?.timeoutMs ?? 5000, maxBuffer: 1 << 20, windowsHide: true },
          (err, stdout, stderr) => {
            if (!err) {
              resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
              return;
            }
            const e = err as NodeJS.ErrnoException & { killed?: boolean };
            const code = typeof e.code === "number" ? e.code : e.killed ? 124 : e.code === "ENOENT" ? 127 : 1;
            resolve({ code, stdout: String(stdout), stderr: String(stderr) || e.message });
          },
        );
        if (o?.input !== undefined) child.stdin?.end(o.input);
      }),
    freeBytes: (dir) => {
      try {
        const s = fs.statfsSync(dir);
        return Number(s.bavail) * Number(s.bsize);
      } catch {
        return null;
      }
    },
    readFile: (file) => {
      try {
        return fs.readFileSync(file, "utf8");
      } catch {
        return null;
      }
    },
    dockerVersion: dockerVersionOverSocket,
    now: () => Date.now(),
  };
}

/** A scripted platform for tests and for recorded `fdesetup` / `lsblk` / `findmnt` outputs: `commands` maps "cmd arg arg" to its result. */
export function fakePlatform(
  o: {
    os?: OsName;
    commands?: Record<string, Partial<RunResult>>;
    free?: number | null;
    files?: Record<string, string>;
    now?: () => number;
    hostname?: string;
  } = {},
): Platform {
  const commands = o.commands ?? {};
  return {
    os: o.os ?? "linux",
    hostname: o.hostname ?? "test-host",
    run: (cmd, args) => {
      const hit = commands[[cmd, ...args].join(" ")];
      return Promise.resolve(
        hit
          ? { code: hit.code ?? 0, stdout: hit.stdout ?? "", stderr: hit.stderr ?? "" }
          : { code: 127, stdout: "", stderr: `${cmd}: not found` },
      );
    },
    freeBytes: () => (o.free === undefined ? 100_000_000_000 : o.free),
    readFile: (file) => o.files?.[file] ?? null,
    now: o.now ?? Date.now,
  };
}
