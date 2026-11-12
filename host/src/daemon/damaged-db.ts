// When the Space cannot start because one of its databases is damaged, say which file and how to get the data back, in one line, and stop with DAMAGED_EXIT. Nothing is repaired: these
// files hold the Space itself (events.db the log of everything, modules.db every module's tables, space.db the Space's settings). logs.db holds only diagnostics and is set aside and made
// anew by openLogSink (daemon.ts), so it is not named here. vyre-server update reads this line ("vyred: <file> is damaged") to name the file after a failed update.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DAMAGED_EXIT = 3;
const CORRUPT = /database disk image is malformed|file is not a database|malformed database schema|SQLITE_CORRUPT|SQLITE_NOTADB/i;

export function isCorruption(e: unknown): boolean {
  return CORRUPT.test(e instanceof Error ? e.message : String(e));
}

/** The first of the Space's databases under `root` that does not pass quick_check, or null when none can be named. */
export function damagedDatabase(root: string): string | null {
  for (const name of ["events.db", "modules.db", "space.db"]) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    try {
      const d = new DatabaseSync(file, { readOnly: true });
      try {
        const r = d.prepare("PRAGMA quick_check").get() as { quick_check?: unknown } | undefined;
        if (r?.quick_check !== "ok") return name;
      } finally { d.close(); }
    } catch (e) { if (isCorruption(e)) return name; }
  }
  return null;
}

export function damagedLine(name: string | null, why: string): string {
  return `vyred: ${name ?? "a database in the data folder"} is damaged (${why.slice(0, 120)}), so the Space cannot start. It is not repaired here. Put back the last good backup on the server: vyre-server restore <backup file> --yes (vyre-server backup and update print where the backups are).`;
}

// The hold. A start that fails on a damaged database (main.ts) cannot tidy up what it had begun (stores, the scheduler), so it records which file is damaged in a marker outside
// the data folder (the OS temp folder: a container's own /tmp survives Docker's restart of that container) and exits. The next start finds the marker, checks that one file once,
// and, while it is still damaged, holds: it opens nothing else, writes nothing, keeps every port but answers every request (/healthz included) 503 with the damaged line, so an
// update rolls back, doctor says DOWN with the file and the restore command, and Docker's restart policy has nothing to loop on. A restore puts a good file in place: the next start
// (the restore restarts the server) finds it sound, removes the marker and starts as usual.
export function holdMarker(root: string): string {
  // a name per data folder (FNV-1a of its path; only a name, nothing secret)
  let h = 0x811c9dc5;
  for (const ch of path.resolve(root)) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return path.join(os.tmpdir(), `vyred-damaged-${h.toString(16).padStart(8, "0")}.json`);
}

export function markDamaged(root: string, name: string | null, why: string): void {
  try { fs.writeFileSync(holdMarker(root), JSON.stringify({ name, why: why.slice(0, 120) }), { mode: 0o600 }); } catch { /* no temp folder: the next start simply checks again */ }
}

/** The damaged line to hold on, when an earlier start marked a file that is still damaged; null (and the marker removed) when it is sound again or there is no marker. */
export function stillDamaged(root: string): string | null {
  const m = holdMarker(root);
  let mark: { name?: string | null; why?: string };
  try { mark = JSON.parse(fs.readFileSync(m, "utf8")) as typeof mark; } catch { return null; }
  const name = mark.name ?? null;
  const again = name ? (damagedOne(path.join(root, name)) ? name : null) : damagedDatabase(root);
  if (!again) { try { fs.rmSync(m, { force: true }); } catch { /* gone */ } return null; }
  return damagedLine(again, mark.why ?? "database disk image is malformed");
}

function damagedOne(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  try {
    const d = new DatabaseSync(file, { readOnly: true });
    try { return (d.prepare("PRAGMA quick_check").get() as { quick_check?: unknown } | undefined)?.quick_check !== "ok"; } finally { d.close(); }
  } catch (e) { return isCorruption(e); }
}

/** Answer every request 503 with the line until SIGTERM or SIGINT. Resolves with the exit code. */
export function hold(line: string, host: string, port: number): Promise<number> {
  const body = JSON.stringify({ ok: false, status: "damaged", error: { code: "space.damaged", message: line.replace(/^vyred: /, "") } });
  const server = http.createServer((_req, res) => { res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" }); res.end(body); });
  const keep = setInterval(() => {}, 1 << 30);
  server.on("error", (e) => { process.stderr.write(`vyred: the damaged-database answer could not listen on ${host}:${port}: ${e.message}\n`); });
  server.listen(port, host);
  return new Promise((resolve) => {
    const stop = (): void => { clearInterval(keep); server.close(() => resolve(0)); };
    process.once("SIGTERM", stop); process.once("SIGINT", stop);
  });
}

