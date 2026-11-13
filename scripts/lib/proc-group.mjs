// A test file's processes as one unit. `node --test FILE` runs FILE in a child process of its own, and a test may start more (a daemon, a browser): killing only the process the
// runner spawned leaves those running, re-parented to init, for hours (12 Nov 2026: fifteen fails-then-hangs fixtures on one box). So the runners spawn each file in a process
// group of its own (detached; on Windows a process tree), and end the whole group: when the watchdog fires, and once the file's process has closed (anything it left behind).
import { spawn, spawnSync } from "node:child_process";

const WIN = process.platform === "win32";
const live = new Set();

/** spawn(), with the child leading a process group of its own (POSIX) so the group can be ended as one. */
export function spawnGroup(cmd, args, opts) {
  const p = spawn(cmd, args, { ...opts, detached: !WIN });
  live.add(p);
  p.once("close", () => live.delete(p));
  return p;
}

/** True while any process of the group led by pid is still there. */
export function groupAlive(pid) {
  if (WIN) {
    const r = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { encoding: "utf8" });
    return (r.stdout ?? "").includes(String(pid));
  }
  try {
    process.kill(-pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/** End the child's whole group (SIGKILL; on Windows taskkill /T /F) and wait, up to waitMs, until none of it is left. Returns true when it is gone. */
export async function killGroup(p, waitMs = 5000) {
  if (!p.pid) return true;
  if (WIN) spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-p.pid, "SIGKILL");
    } catch {
      /* the group is gone already */
    }
  }
  const until = Date.now() + waitMs;
  while (groupAlive(p.pid)) {
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

/** A runner stopped by Ctrl-C or a signal ends every group it started: the groups are not in the terminal's own group, so the signal does not reach them by itself. */
let wired = false;
export function endGroupsOnExit() {
  if (wired) return;
  wired = true;
  const endAll = () => {
    for (const p of live) {
      if (WIN) spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { stdio: "ignore" });
      else {
        try {
          process.kill(-p.pid, "SIGKILL");
        } catch {
          /* gone */
        }
      }
    }
  };
  process.once("exit", endAll);
  for (const s of ["SIGINT", "SIGTERM", "SIGHUP"])
    process.once(s, () => {
      endAll();
      process.exit(s === "SIGINT" ? 130 : 143);
    });
}
