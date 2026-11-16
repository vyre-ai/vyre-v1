// Scan a data folder for text: every value of every table of every sqlite file, and every other file's bytes (F77, the proof that an erase left nothing behind).
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Every text value of every table of every sqlite file under dir: `file:table` -> the canaries found in it. */
export function scan(dir: string, canaries: string[]): Map<string, Set<string>> {
  const hits = new Map<string, Set<string>>();
  const files: string[] = [];
  const walk = (p: string): void => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const q = path.join(p, e.name);
      if (e.isDirectory()) walk(q);
      else files.push(q);
    }
  };
  walk(dir);
  for (const f of files) {
    if (/\.db$/.test(f)) {
      const db = new DatabaseSync(f, { readOnly: true });
      try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
        for (const { name } of tables) {
          let rows: Record<string, unknown>[] = [];
          try {
            rows = db.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
          } catch {
            continue;
          }
          const dump = rows
            .map((r) =>
              Object.values(r)
                .map((v) => (v instanceof Uint8Array ? Buffer.from(v).toString("latin1") : String(v)))
                .join("\u0001"),
            )
            .join("\n");
          for (const c of canaries)
            if (dump.includes(c))
              (
                hits.get(`${path.basename(f)}:${name}`) ??
                hits.set(`${path.basename(f)}:${name}`, new Set()).get(`${path.basename(f)}:${name}`)!
              ).add(c);
        }
      } finally {
        db.close();
      }
    } else {
      const raw = fs.readFileSync(f).toString("latin1");
      for (const c of canaries)
        if (raw.includes(c))
          (
            hits.get(`file:${path.relative(dir, f)}`) ??
            hits.set(`file:${path.relative(dir, f)}`, new Set()).get(`file:${path.relative(dir, f)}`)!
          ).add(c);
    }
  }
  return hits;
}
