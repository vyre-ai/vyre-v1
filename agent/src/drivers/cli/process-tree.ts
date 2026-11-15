// Ending an engine and everything it started. The engine on a person's computer runs behind a wrapper (bwrap on Linux, sandbox-exec on a Mac, a job wrapper on Windows), and the engine starts tools of its
// own. A signal to the wrapper alone can leave the engine alive: bwrap puts the engine in a session of its own (--new-session) and its own process namespace, so the engine is neither in the wrapper's process
// group nor reliably ended when the wrapper is. So the tree is read BEFORE the first signal (once the wrapper is gone, its children belong to init and can no longer be found) and every process in it is
// signalled. A process is remembered with when it started, so a number that was reused by something else is never signalled.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

export interface ProcRow {
  pid: number;
  ppid: number;
  /** when it started, in whatever form this system gives: the same process always reads the same */
  start: string;
}

/** Every process on this computer (Linux: /proc; macOS and other Unix: ps). Windows has no table here: taskkill walks the tree itself. */
export function listProcesses(platform: NodeJS.Platform = process.platform): ProcRow[] {
  if (platform === "win32") return [];
  if (platform === "linux") {
    const rows: ProcRow[] = [];
    for (const name of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = fs.readFileSync(`/proc/${name}/stat`, "utf8");
        // "pid (comm) state ppid ..."; comm may hold spaces and brackets, so the fields are counted from the last ")"
        const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        rows.push({ pid: Number(name), ppid: Number(rest[1]), start: rest[19] ?? "" });
      } catch {
        /* it ended while the table was read */
      }
    }
    return rows;
  }
  try {
    const out = execFileSync("ps", ["-Ao", "pid=,ppid=,lstart="], { encoding: "utf8", timeout: 2000 });
    return out
      .split("\n")
      .map((l) => /^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(l))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), start: m[3] as string }));
  } catch {
    return [];
  }
}

/** The root and every process below it, found through parent links. */
export function treeOf(root: number, rows: readonly ProcRow[]): ProcRow[] {
  const byParent = new Map<number, ProcRow[]>();
  for (const r of rows) byParent.set(r.ppid, [...(byParent.get(r.ppid) ?? []), r]);
  const self = rows.find((r) => r.pid === root);
  const out: ProcRow[] = self ? [self] : [];
  for (let i = 0; i < out.length; i++) for (const c of byParent.get(out[i]!.pid) ?? []) if (c.pid !== root) out.push(c);
  return out;
}

/** The command that ends a Windows process and its children (a job wrapper does not carry a signal down). */
export function windowsKill(pid: number): { cmd: string; args: string[] } {
  return { cmd: "taskkill", args: ["/PID", String(pid), "/T", "/F"] };
}

export interface TreeKiller {
  /** Signal the process, and every process that has ever been below it. */
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

/** What one engine's process tree is. Each kill reads the tree again and adds to what it already knows, so a second signal still reaches an engine whose wrapper is gone. */
export function treeKiller(
  rootPid: number | undefined,
  o: {
    platform?: NodeJS.Platform;
    list?: () => ProcRow[];
    send?: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
    run?: (cmd: string, args: string[]) => void;
  } = {},
): TreeKiller {
  const platform = o.platform ?? process.platform;
  const list = o.list ?? ((): ProcRow[] => listProcesses(platform));
  const send =
    o.send ??
    ((pid: number, signal: "SIGTERM" | "SIGKILL"): void => {
      try {
        process.kill(pid, signal);
      } catch {
        /* already gone */
      }
    });
  const run =
    o.run ??
    ((cmd: string, args: string[]): void => {
      try {
        execFileSync(cmd, args, { stdio: "ignore", timeout: 5000 });
      } catch {
        /* already gone, or taskkill found nothing */
      }
    });
  const known = new Map<number, string>();
  return {
    kill(signal) {
      if (rootPid === undefined) return;
      if (platform === "win32") {
        const w = windowsKill(rootPid);
        run(w.cmd, w.args);
        return;
      }
      const rows = list();
      const now = new Map(rows.map((r) => [r.pid, r.start]));
      for (const r of treeOf(rootPid, rows)) known.set(r.pid, r.start);
      // children first, so a parent cannot start another before it is told; a number now held by a different process (another start time) is left alone
      for (const [pid, start] of [...known].reverse()) {
        if (now.get(pid) === start) send(pid, signal);
        else if (!now.has(pid)) known.delete(pid);
      }
    },
  };
}
