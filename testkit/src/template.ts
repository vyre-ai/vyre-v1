// The template events.db: built once per (schema, Space id) on this machine and copied for every test Space, so a Space boots without creating tables or the chain's genesis row.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LogStore, SCHEMA, sha256Hex } from "../../kernel/src/log/index.ts";

const dirs = new Map<string, string>();

/** Directory holding the template for a Space id. The key is a hash of the schema, so a schema change makes a new template and old ones are never reused. */
export async function templateFor(space: string): Promise<string> {
  const hit = dirs.get(space);
  if (hit && fs.existsSync(path.join(hit, "events.db"))) return path.join(hit, "events.db");
  const key = sha256Hex(`${SCHEMA}\n${space}`).slice(0, 16);
  const dir = path.join(os.tmpdir(), `vyre-testkit-template-${key}`);
  const file = path.join(dir, "events.db");
  if (!fs.existsSync(file)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-testkit-build-"));
    const store = new LogStore({ db: new DatabaseSync(path.join(tmp, "events.db")), space });
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    store.close();
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(tmp, "events.db"), `${file}.${process.pid}.part`);   // closed cleanly, so the db file is whole; rename is atomic: two test files racing never see a half copy
    fs.renameSync(`${file}.${process.pid}.part`, file);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  dirs.set(space, dir);
  return file;
}
