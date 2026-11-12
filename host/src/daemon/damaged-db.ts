// When the Space cannot start because one of its databases is damaged, say which file and how to get the data back, in one line, and stop with DAMAGED_EXIT. Nothing is repaired: these
// files hold the Space itself (events.db the log of everything, modules.db every module's tables, space.db the Space's settings). logs.db holds only diagnostics and is set aside and made
// anew by openLogSink (daemon.ts), so it is not named here. vyre-server update reads this line ("vyred: <file> is damaged") to name the file after a failed update.
import fs from "node:fs";
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
