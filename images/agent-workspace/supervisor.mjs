// The job supervisor of an agent's workspace (27 Nov 2026, rc.44). It is the container's main program (the CMD), so it is what Docker restarts after a reboot, and what restarts a job that dies. A job is a folder
// ~/.vyre/jobs/<id>/ with `spec.json` (what the agent asked for) and, written here, `status.json` and `log`. The daemon never talks to it: it writes a spec and reads the status through `docker exec`, so nothing
// about the supervisor needs a socket, a port or a key. Every second it looks at the folder:
//   a spec with desired "running" and no live process is started (in its own process group, output appended to `log`, which is cut to its last 256 KB when it grows past 1 MB);
//   a spec with desired "stopped" and a live process is stopped (SIGTERM to the group, SIGKILL after 5 s) and the status says stopped;
//   a job that exits is started again after a wait that grows (1 s to 60 s) when its policy says so (`always`, or `on-failure` and it did not exit 0), and says so in its status; `never` leaves it ended.
// After a reboot the supervisor starts again with the folder as it was, so every job whose desired state is "running" is started again: that is the whole of "survives a restart".
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.env.VYRE_JOBS_DIR || path.join(process.env.HOME || "/home/agent", ".vyre", "jobs");
const TICK_MS = Number(process.env.VYRE_JOBS_TICK_MS || 1000);
const MAX_LOG = 1024 * 1024;
const KEEP_LOG = 256 * 1024;
const GRACE_MS = Number(process.env.VYRE_JOBS_GRACE_MS || 5000);
const ID = /^[A-Za-z0-9_-]{1,64}$/;

const read = (f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};
const write = (f, v) => {
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v));
  fs.renameSync(tmp, f);
};

/** id -> { child, startedAt, restarts, waitUntil, stopping, killAt, lastExit } */
const jobs = new Map();

function trimLog(file) {
  try {
    const st = fs.statSync(file);
    if (st.size <= MAX_LOG) return;
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(KEEP_LOG);
    fs.readSync(fd, buf, 0, KEEP_LOG, st.size - KEEP_LOG);
    fs.closeSync(fd);
    fs.writeFileSync(file, buf);
  } catch {
    /* no log yet */
  }
}

function status(id, extra) {
  const j = jobs.get(id);
  write(path.join(ROOT, id, "status.json"), {
    id,
    state: extra.state,
    pid: j?.child?.pid ?? null,
    startedAt: j?.startedAt ?? null,
    restarts: j?.restarts ?? 0,
    exitCode: extra.exitCode ?? j?.lastExit?.code ?? null,
    endedAt: extra.endedAt ?? j?.lastExit?.at ?? null,
    updatedAt: Date.now(),
    ...(extra.note ? { note: extra.note } : {}),
  });
}

function start(id, spec) {
  const dir = path.join(ROOT, id);
  const logFile = path.join(dir, "log");
  trimLog(logFile);
  const out = fs.openSync(logFile, "a");
  const j = jobs.get(id) ?? { restarts: 0, waitUntil: 0 };
  j.specAt = spec.at;
  j.pendingRestart = false;
  j.waitUntil = 0;
  const child = spawn("sh", ["-c", spec.command], {
    cwd: spec.cwd && fs.existsSync(spec.cwd) ? spec.cwd : process.env.HOME,
    env: { ...process.env, ...(spec.env ?? {}) },
    detached: true,
    stdio: ["ignore", out, out],
  });
  fs.closeSync(out);
  j.child = child;
  j.startedAt = Date.now();
  j.stopping = false;
  j.killAt = 0;
  jobs.set(id, j);
  child.on("error", (e) => {
    fs.appendFileSync(logFile, `\n[supervisor] could not start: ${e.message}\n`);
  });
  child.on("exit", (code, signal) => {
    const at = Date.now();
    const cur = jobs.get(id);
    if (!cur || cur.child !== child) return;
    cur.child = null;
    cur.lastExit = { code: code ?? (signal ? 128 : 1), at };
    const ranFor = at - cur.startedAt;
    // a job that ran a minute is a healthy one: its next wait starts over
    if (ranFor > 60_000) cur.restarts = 0;
    fs.appendFileSync(logFile, `\n[supervisor] exited ${signal ? `by ${signal}` : `with code ${code}`} after ${Math.round(ranFor / 1000)} s\n`);
    const want = read(path.join(dir, "spec.json"));
    const wanted = want?.desired === "running" && !cur.stopping;
    const again = want?.restart === "always" || (want?.restart !== "never" && (code ?? 1) !== 0);
    if (wanted && again) {
      cur.pendingRestart = true;
      cur.restarts += 1;
      cur.waitUntil = at + Math.min(60_000, 1000 * 2 ** Math.min(6, cur.restarts - 1));
      status(id, { state: "restarting", exitCode: cur.lastExit.code, endedAt: at, note: "Waiting to start again" });
    } else {
      status(id, { state: cur.stopping || want?.desired === "stopped" ? "stopped" : code === 0 ? "done" : "failed", exitCode: cur.lastExit.code, endedAt: at });
    }
  });
  status(id, { state: "running" });
}

function stop(id) {
  const j = jobs.get(id);
  if (!j?.child) return false;
  if (!j.stopping) {
    j.stopping = true;
    j.killAt = Date.now() + GRACE_MS;
    try {
      process.kill(-j.child.pid, "SIGTERM");
    } catch {
      /* gone */
    }
  } else if (Date.now() >= j.killAt) {
    try {
      process.kill(-j.child.pid, "SIGKILL");
    } catch {
      /* gone */
    }
  }
  return true;
}

export function tick() {
  let ids = [];
  try {
    ids = fs.readdirSync(ROOT).filter((i) => ID.test(i));
  } catch {
    return;
  }
  for (const id of ids) {
    const spec = read(path.join(ROOT, id, "spec.json"));
    if (spec === null || typeof spec.command !== "string") continue;
    const j = jobs.get(id);
    const live = j?.child != null;
    if (spec.desired === "running") {
      // a job is started when it is new to this supervisor (a first start, or after a reboot), when it died and its policy says to start it again and its wait is over, or when it was asked for again (a new `at`)
      if (!live && Date.now() >= (j?.waitUntil ?? 0) && (!j || j.pendingRestart || spec.at !== j.specAt)) start(id, spec);
    } else if (live) {
      stop(id);
    } else {
      const st = read(path.join(ROOT, id, "status.json"));
      if (st !== null && (st.state === "running" || st.state === "restarting")) status(id, { state: "stopped" });
    }
  }
}

function main() {
  fs.mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  const timer = setInterval(tick, TICK_MS);
  const bye = () => {
    clearInterval(timer);
    for (const [id] of jobs) {
      const j = jobs.get(id);
      if (j?.child) {
        try {
          process.kill(-j.child.pid, "SIGTERM");
        } catch {
          /* gone */
        }
      }
    }
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGTERM", bye);
  process.on("SIGINT", bye);
  tick();
}

if (import.meta.url === `file://${process.argv[1]}`) main();
