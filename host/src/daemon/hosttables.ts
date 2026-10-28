// The tables the daemon itself writes into modules.db, and the migration runner for every module's own tables.
// health_* and network_* belong to modules/health and modules/network (their migrations create the same tables with IF NOT EXISTS). The daemon creates them first so a probe row or a queued
// command never meets a missing table, whichever module packet has landed. daemon.boot.test.ts compares these columns with the module migrations whenever those files exist.
import fs from "node:fs";
import path from "node:path";
import type { HostDb } from "./sqlite.ts";

export const HOST_TABLES = `
CREATE TABLE IF NOT EXISTS host_migration (module TEXT NOT NULL, file TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (module, file));

CREATE TABLE IF NOT EXISTS health_probe (
  name TEXT PRIMARY KEY, state TEXT NOT NULL, detail TEXT, latency_ms INTEGER, values_json TEXT, at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS health_service (
  name TEXT PRIMARY KEY, state TEXT NOT NULL, started_at INTEGER NOT NULL, restarts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS health_restart (
  id TEXT PRIMARY KEY, service TEXT NOT NULL, by_principal TEXT NOT NULL, on_behalf TEXT, at INTEGER NOT NULL, done_at INTEGER
);
CREATE INDEX IF NOT EXISTS health_restart_open ON health_restart(done_at, at);

CREATE TABLE IF NOT EXISTS network_config (
  id INTEGER PRIMARY KEY, address TEXT NOT NULL, mode TEXT NOT NULL, domain TEXT, relay_address TEXT, public_ingress INTEGER NOT NULL, ingress_detail TEXT, reported_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS network_cert (host TEXT PRIMARY KEY, expires_at INTEGER, reason TEXT, reported_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS network_dns (domain TEXT PRIMARY KEY, ok INTEGER NOT NULL, records_json TEXT NOT NULL, checked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS network_server (server_id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, state TEXT NOT NULL, heartbeat_at INTEGER);
CREATE TABLE IF NOT EXISTS network_endpoint (kind TEXT NOT NULL, url TEXT NOT NULL, state TEXT NOT NULL, rtt_ms INTEGER, heartbeat_at INTEGER, PRIMARY KEY (kind, url));
CREATE TABLE IF NOT EXISTS network_command (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL, by_principal TEXT NOT NULL, at INTEGER NOT NULL, done_at INTEGER
);
CREATE TABLE IF NOT EXISTS network_result (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL, state TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL
);
`;

/** Every `modules/<id>/migrations/*.sql` under `codeRoot` that has not run yet, in module then file order. Returns what ran. */
export function migrate(db: HostDb, codeRoot: string, now: () => number): { module: string; file: string }[] {
  db.exec(HOST_TABLES);
  const ran: { module: string; file: string }[] = [];
  const modulesDir = path.join(codeRoot, "modules");
  let ids: string[] = [];
  try { ids = fs.readdirSync(modulesDir).sort(); } catch { return ran; }
  for (const id of ids) {
    const dir = path.join(modulesDir, id, "migrations");
    let files: string[];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort(); } catch { continue; }
    for (const file of files) {
      if (db.all("SELECT 1 AS x FROM host_migration WHERE module = ? AND file = ?", id, file).length) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      db.tx(() => {
        db.exec(sql);
        db.run("INSERT INTO host_migration (module, file, at) VALUES (?, ?, ?)", id, file, now());
      });
      ran.push({ module: id, file });
    }
  }
  return ran;
}
