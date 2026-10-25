// The sandbox around a CLI engine (P-L2_23, security review S8 finding 1). A CLI engine (Claude Code, Codex, Grok) is a program the daemon starts; without a wrap it can read every file the
// daemon's user can read. This builds the `wrap` the local launcher takes, so the engine runs in the person's sandbox: Seatbelt on a Mac, bubblewrap with the network wall on Linux. It lives here
// because agent code may not import the sandbox package.
//   - The working folder is one folder per person and thread under the Space data directory. It is the first read-write mount (bwrap does --chdir to the first mount) and the process's cwd.
//   - bwrap starts with --clearenv, so the spawn's environment (the key, VYRE_MCP_TOKEN) is copied into the sandbox spec and travels as --setenv. Seatbelt inherits the environment, so the proxy
//     variables are put in front of the command with env(1).
//   - Where the engine has to run in the person's container (host placement, Windows without WSL) there is no local wrap: the spawn fails with sandbox.unavailable and never falls back to the
//     unwrapped launcher.
import fs from "node:fs";
import path from "node:path";
import { SandboxError, bwrapWallCommand, proxyEnv, seatbeltCommand } from "../../sandbox/src/index.ts";
import type { Roots, SandboxSpec } from "../../sandbox/src/index.ts";
import type { LocalLauncherOptions } from "../../agent/src/drivers/cli/launcher.ts";

/** What the host knows about the sandbox it runs a CLI engine in. The wall (egress proxy) is started by the host and outlives the turns. */
export type EngineSandbox =
  | { kind: "bwrap"; wallDir: string; programRead?: readonly string[]; node?: string }
  | { kind: "seatbelt"; proxyPort: number; programRead?: readonly string[] }
  /** The engine belongs in the person's container, which has no local launcher yet. */
  | { kind: "docker" | "server"; reason?: string };

export interface SandboxPlan {
  sandbox: EngineSandbox;
  /** The Space data directory; work folders live under `<dataDir>/work/<person>/<thread>`, scratch under `<dataDir>/scratch/<person>`. */
  dataDir: string;
  /** Hosts the engine may reach through the proxy (its provider's API). */
  egressHosts: readonly string[];
}

const SAFE = /[^a-zA-Z0-9_-]/g;
const part = (id: string): string => {
  const s = id.replace(SAFE, "_");
  if (s === "" || s === "." || s === "..") throw new SandboxError("sandbox.policy", "a person or thread id cannot name a folder");
  return s;
};

/** The folder one person's one thread works in. It is made if it is not there. Different people and different threads never share one. */
export function workFolder(dataDir: string, person: string, thread: string): string {
  const dir = path.join(dataDir, "work", part(person), part(thread));
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

export function scratchFolder(dataDir: string, person: string): string {
  const dir = path.join(dataDir, "scratch", part(person));
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync(dir);
}

const sandboxId = (person: string): string => `vyre-sbx-${part(person).toLowerCase().replace(/_/g, "-")}`;

/**
 * `wrap` for createLocalLauncher. The work folder arrives as `start.cwd` (the opener's workFolder, made by workFolder() above) and names the person: `<dataDir>/work/<person>/<thread>`. A spawn
 * with any other folder is refused: the engine must never run in the daemon's own folder or anywhere else.
 */
export function sandboxWrap(plan: SandboxPlan): NonNullable<LocalLauncherOptions["wrap"]> {
  return (argv, start) => {
    const s = plan.sandbox;
    if (s.kind === "docker" || s.kind === "server") {
      throw new SandboxError("sandbox.unavailable", s.reason ?? "this engine has to run in the person's container, which cannot start a local engine yet");
    }
    if (start.cwd === undefined) throw new SandboxError("sandbox.policy", "a CLI engine needs a work folder");
    const workRoot = fs.realpathSync(path.join(plan.dataDir, "work"));
    const rel = path.relative(workRoot, start.cwd).split(path.sep);
    if (rel.length !== 2 || rel.some((x) => x === "" || x === "..")) throw new SandboxError("sandbox.policy", "the work folder is not one of the Space's person-and-thread folders");
    const person = rel[0] as string;
    const scratch = scratchFolder(plan.dataDir, person);
    const roots: Roots = { work: [path.join(plan.dataDir, "work")], scratch: [path.join(plan.dataDir, "scratch")] };
    const spec: SandboxSpec = {
      id: sandboxId(person), person, kind: s.kind, scratch,
      mounts: [{ host: start.cwd, mode: "rw" }],
      egressHosts: plan.egressHosts,
      env: start.env,
    };
    if (s.kind === "bwrap") {
      const w = bwrapWallCommand(spec, roots, argv, { wallDir: s.wallDir, ...(s.node ? { node: s.node } : {}), ...(s.programRead ? { programRead: s.programRead } : {}) });
      return [w.cmd, ...w.args];
    }
    const w = seatbeltCommand(spec, roots, argv, { proxyPort: s.proxyPort, ...(s.programRead ? { programRead: s.programRead } : {}) });
    // sandbox-exec keeps the caller's environment, so the proxy variables go in front with env(1).
    return ["/usr/bin/env", ...Object.entries(proxyEnv(`http://127.0.0.1:${s.proxyPort}`)).map(([k, v]) => `${k}=${v}`), w.cmd, ...w.args];
  };
}
