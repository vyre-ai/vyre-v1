// The Fix buttons of a machine's Doctor findings, run on the machine itself (lane l-machines): clear old caches, stop idle engine sessions, restart a service. The Space server runs them here
// (the command queue, commands.ts); an added server or a member's computer runs them when the Space asks over its link (kind "fix"). Each answers with one plain line for the page.
import fs from "node:fs";
import path from "node:path";

export type Fix = "clear_caches" | "stop_idle" | "restart_service";
export const isFix = (v: unknown): v is Fix => v === "clear_caches" || v === "stop_idle" || v === "restart_service";

export interface FixDeps {
  dataDir: string;
  now(): number;
  /** Close every idle engine session; the count closed. Absent where no engine runs. */
  closeIdle?(): Promise<number>;
  /** Restart a named service; false when this machine has no such service. */
  restart?(service: string): Promise<boolean>;
}

/** Folders under the data directory that Vyre rebuilds when it needs them. Nothing else is touched: no chats, files, work folders or databases. */
const REBUILDABLE = ["cache", "tmp", "scratch"] as const;
/** A scratch folder younger than this may belong to a turn that is running. */
const SCRATCH_MIN_AGE_MS = 60 * 60_000;

function sizeOf(p: string): number {
  let n = 0;
  let st: fs.Stats;
  try { st = fs.lstatSync(p); } catch { return 0; }
  if (st.isDirectory()) { for (const e of fs.readdirSync(p)) n += sizeOf(path.join(p, e)); return n; }
  return st.size;
}

/** Remove what is rebuildable and old enough. Returns the bytes freed. */
export function clearCaches(dataDir: string, now: number): number {
  let freed = 0;
  for (const name of REBUILDABLE) {
    const dir = path.join(dataDir, name);
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const e of entries) {
      const p = path.join(dir, e);
      try {
        const st = fs.lstatSync(p);
        if (name === "scratch" && now - st.mtimeMs < SCRATCH_MIN_AGE_MS) continue;
        const n = sizeOf(p);
        fs.rmSync(p, { recursive: true, force: true });
        freed += n;
      } catch { /* in use or already gone: left */ }
    }
  }
  return freed;
}

const mb = (n: number): string => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

export async function runFix(fix: Fix, service: string | undefined, d: FixDeps): Promise<string> {
  if (fix === "clear_caches") return `Cleared ${mb(clearCaches(d.dataDir, d.now()))} of caches and temporary files.`;
  if (fix === "stop_idle") {
    if (!d.closeIdle) return "No engine runs on this machine.";
    const n = await d.closeIdle();
    return n === 0 ? "No idle engine sessions." : `Stopped ${n} idle engine session${n === 1 ? "" : "s"}.`;
  }
  if (!service || !d.restart) return "This machine has no service to restart.";
  return (await d.restart(service)) ? `Restarted ${service}.` : `This machine has no service called ${service}.`;
}
