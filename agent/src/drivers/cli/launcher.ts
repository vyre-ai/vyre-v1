// A launcher that starts the CLI as a child process of this one. The host wraps the argv for the sandbox kind (Seatbelt on a Mac, bwrap on Linux: `wrap`); on the Space host the same
// Launcher port is implemented over the person's container. The environment is built here from a short allow-list plus what the driver asks for; the host's own environment never goes through.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { CliExit, CliProcess, LaunchSpec, Launcher } from "./types.ts";

export class LaunchError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = "LaunchError"; this.code = code; }
}

export interface LocalLauncherOptions {
  /** Wrap the argv for a sandbox (`sandbox-exec -f profile ...`, `bwrap ...`). Default: run it as given. */
  wrap?: (argv: readonly string[]) => readonly string[];
  /** Environment every process gets. Default: PATH, HOME, LANG and TMPDIR of this process. */
  baseEnv?: Readonly<Record<string, string>>;
}

const TAIL = 4096;

function defaultBase(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ["PATH", "HOME", "LANG", "TMPDIR"]) { const v = process.env[k]; if (v !== undefined) out[k] = v; }
  return out;
}

export function createLocalLauncher(o: LocalLauncherOptions = {}): Launcher {
  return {
    spawn(spec: LaunchSpec): Promise<CliProcess> {
      const argv = o.wrap ? o.wrap(spec.argv) : spec.argv;
      const [cmd, ...args] = argv;
      if (cmd === undefined) return Promise.reject(new LaunchError("engine.cli_missing", "No program to start."));
      return new Promise<CliProcess>((resolve, reject) => {
        let child: ChildProcess;
        try {
          child = spawn(cmd, args, { ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}), env: { ...(o.baseEnv ?? defaultBase()), ...spec.env }, stdio: ["pipe", "pipe", "pipe"] });
        } catch (e) {
          reject(new LaunchError("engine.cli_missing", e instanceof Error ? e.message : "could not start"));
          return;
        }
        let tail = "";
        child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", (d: string) => { tail = (tail + d).slice(-TAIL); });
        child.stdin?.on("error", () => undefined);
        const exited = new Promise<CliExit>((done) => {
          child.once("close", (code, signal) => done({ code, signal }));
          child.once("error", () => done({ code: null, signal: null }));
        });
        child.once("error", (e: Error) => {
          const missing = (e as NodeJS.ErrnoException).code === "ENOENT";
          reject(new LaunchError(missing ? "engine.cli_missing" : "engine.cli_failed", missing ? `${cmd} is not installed here.` : e.message));
        });
        child.once("spawn", () => {
          const out = child.stdout;
          if (!out) { reject(new LaunchError("engine.cli_failed", "The process has no output.")); return; }
          resolve({
            pid: child.pid,
            stdout: out as AsyncIterable<Uint8Array | string>,
            write: (data) => new Promise<void>((ok, bad) => {
              const stdin = child.stdin;
              if (!stdin || stdin.destroyed || !stdin.writable) { bad(new Error("stdin is closed")); return; }
              stdin.write(data, (e) => (e ? bad(e) : ok()));
            }),
            endInput: () => { try { child.stdin?.end(); } catch { /* already closed */ } },
            exited,
            stderrTail: () => tail,
            kill: (signal = "SIGTERM") => { try { child.kill(signal); } catch { /* already gone */ } },
          });
        });
      });
    },
  };
}
