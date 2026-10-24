// `vyre server start|stop|restart|status|logs` and `vyre-server doctor`: running the daemon from a terminal. start runs host/src/daemon/main.ts detached with its output in logs/vyred.out and waits for
// /healthz; stop sends SIGTERM to the pid in vyred.pid (only when that pid answers as vyred, so a stale pid file stops nothing); doctor works with the daemon down (daemon/doctor.ts).
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CODE_ROOT } from "../daemon/daemon.ts";
import { alive, clearInfo, pathsFor, readInfo } from "../daemon/config.ts";
import { formatDoctor, runDoctor } from "../daemon/doctor.ts";
import type { DaemonInfo } from "../daemon/config.ts";
import { parseArgs, flagText } from "./args.ts";
import type { Parsed } from "./args.ts";
import { resolveTarget, callCap, NotRunning, showError, notRunningHint } from "./client.ts";
import { EXIT, errLine, line } from "./io.ts";
import type { CliIo } from "./io.ts";

const MAIN = path.join(CODE_ROOT, "host/src/daemon/main.ts");

export function defaultSpawn(args: string[], logFile: string): { pid: number } {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const fd = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [MAIN, ...args], { detached: true, stdio: ["ignore", fd, fd], env: process.env });
  child.unref();
  return { pid: child.pid ?? 0 };
}

async function health(io: CliIo, info: DaemonInfo): Promise<{ ok: boolean; body: Record<string, unknown> | null }> {
  try {
    const r = await io.fetch(`${info.url}/healthz`);
    if (!r.ok) return { ok: false, body: null };
    return { ok: true, body: JSON.parse(await r.text()) as Record<string, unknown> };
  } catch { return { ok: false, body: null }; }
}

function dataDirOf(io: CliIo, p: Parsed): string {
  return resolveTarget(io, p.flags)?.dataDir ?? path.resolve(flagText(p, "data-dir") ?? io.env["VYRE_DATA_DIR"] ?? path.join(io.env["HOME"] ?? ".", ".vyre"));
}

async function start(io: CliIo, p: Parsed): Promise<number> {
  const dataDir = dataDirOf(io, p);
  const paths = pathsFor(dataDir);
  const live = readInfo(paths);
  if (live && alive(live.pid) && (await health(io, live)).ok) { line(io, `vyred is already running on ${live.url} (pid ${live.pid}).`); return EXIT.OK; }
  clearInfo(paths);
  const args = ["--data-dir", dataDir];
  for (const f of ["role", "space", "port", "host", "owner", "relay", "caddy-admin"]) { const v = flagText(p, f); if (v !== undefined) args.push(`--${f}`, v); }
  const spawnIt = io.spawnDaemon ?? defaultSpawn;
  const started = spawnIt(args, path.join(paths.logDir, "vyred.out"));
  const wait = Number(io.env["VYRE_UP_WAIT_MS"]) || 15_000;
  for (let t = 0; t < wait; t += 100) {
    await io.sleep(100);
    const info = readInfo(paths);
    if (info && (await health(io, info)).ok) { line(io, `vyred started on ${info.url} (pid ${info.pid}).`); return EXIT.OK; }
  }
  errLine(io, `vyred (pid ${started.pid}) did not answer within ${Math.round(wait / 1000)} s. Read ${path.join(paths.logDir, "vyred.out")}.`);
  return EXIT.FAILED;
}

async function stop(io: CliIo, p: Parsed): Promise<number> {
  const paths = pathsFor(dataDirOf(io, p));
  const info = readInfo(paths);
  if (!info || !alive(info.pid)) { clearInfo(paths); line(io, "vyred is not running."); return EXIT.OK; }
  if (!(await health(io, info)).ok) { errLine(io, `pid ${info.pid} is alive but does not answer as vyred at ${info.url}; stopped nothing.`); return EXIT.FAILED; }
  (io.signal ?? ((pid, sig) => { process.kill(pid, sig); }))(info.pid, "SIGTERM");
  for (let t = 0; t < 10_000; t += 100) {
    await io.sleep(100);
    if (!readInfo(paths) && !(await health(io, info)).ok) { line(io, `vyred stopped (pid ${info.pid}).`); return EXIT.OK; }
  }
  errLine(io, `vyred (pid ${info.pid}) did not stop within 10 s.`);
  return EXIT.FAILED;
}

async function status(io: CliIo, p: Parsed): Promise<number> {
  const info = readInfo(pathsFor(dataDirOf(io, p)));
  const h = info && alive(info.pid) ? await health(io, info) : { ok: false, body: null };
  if (!info || !h.ok) { errLine(io, `vyred is not running. ${notRunningHint}`); return EXIT.NOT_RUNNING; }
  if (p.flags.has("json")) { line(io, JSON.stringify({ ...info, ...h.body })); return EXIT.OK; }
  line(io, `vyred ${info.version} runs as pid ${info.pid} on ${info.url}`);
  line(io, `roles ${info.roles.join(",")}  space ${info.space ?? "-"}  head ${String(h.body?.["head"] ?? "-")}`);
  const services = (h.body?.["services"] as { name: string; state: string; restarts: number }[] | undefined) ?? [];
  for (const s of services) line(io, `  ${s.state.padEnd(8)} ${s.name}${s.restarts ? `  (${s.restarts} restarts)` : ""}`);
  return EXIT.OK;
}

function logs(io: CliIo, p: Parsed): number {
  const file = path.join(pathsFor(dataDirOf(io, p)).logDir, "vyred.out");
  let text: string;
  try { text = fs.readFileSync(file, "utf8"); } catch { errLine(io, `no log yet at ${file}`); return EXIT.FAILED; }
  const n = Number(flagText(p, "lines") ?? 50) || 50;
  io.out(`${text.split("\n").slice(-n - 1).join("\n")}`);
  return EXIT.OK;
}

export async function doctorCommand(io: CliIo, p: Parsed, o: { alwaysOffline: boolean }): Promise<number> {
  const asJson = p.flags.has("json");
  const target = o.alwaysOffline || p.flags.has("offline") ? null : resolveTarget(io, p.flags);
  if (target) {
    try {
      const r = await callCap(io, target, "health.doctor", {});
      if (r.ok) {
        const d = r.data as { ok: boolean; findings: { key: string; state: string; next: string }[] };
        if (asJson) line(io, JSON.stringify(d, null, 2));
        else { for (const f of d.findings) line(io, `${f.state.padEnd(8)} ${f.key}${f.state === "healthy" ? "" : `\n         Next: ${f.next}`}`); line(io, d.ok ? "Everything checks out." : "Some checks need attention."); }
        return d.ok ? EXIT.OK : EXIT.FAILED;
      }
      // the gateway answered but the doctor failed (permission, or a stub): the local one still works
      errLine(io, `${r.error.code}: ${r.error.message}. Running the local doctor instead.`);
    } catch (e) {
      if (!(e instanceof NotRunning)) throw e;
      errLine(io, "The server does not answer. Running the local doctor instead.");
    }
  }
  const role = flagText(p, "role") === "device" ? "device" : "space";
  const report = await runDoctor({ dataDir: dataDirOf(io, p), role, platform: io.platform, fetch: io.fetch, now: io.now });
  io.out(asJson ? `${JSON.stringify(report, null, 2)}\n` : formatDoctor(report));
  return report.ok ? EXIT.OK : EXIT.FAILED;
}

export async function serverCommand(io: CliIo, argv: readonly string[]): Promise<number> {
  const p = parseArgs(argv, new Set(["json", "offline"]));
  const sub = p.positional[0];
  switch (sub) {
    case "start": return start(io, p);
    case "stop": return stop(io, p);
    case "restart": { const c = await stop(io, p); return c === EXIT.OK ? start(io, p) : c; }
    case "status": return status(io, p);
    case "logs": return logs(io, p);
    case "doctor": return doctorCommand(io, p, { alwaysOffline: false });
    default:
      errLine(io, sub ? `vyre server ${sub}: not a command. Use start, stop, restart, status, logs or doctor.` : "vyre server: use start, stop, restart, status, logs or doctor.");
      return EXIT.USAGE;
  }
}
