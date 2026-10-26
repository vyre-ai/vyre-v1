// P-L3_18: what a person's read leaves behind. Looking at a synced type marks it in use (cn_type_use) so it polls at 2 minutes. A read capability could run in a transaction that is rolled
// back, which would lose the mark and leave the 2 minute tier dead; so this goes through the real daemon and gateway with a token (rule 27) and reads the mark back afterwards.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore, CORE_SPACE } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { DatabaseSync } from "node:sqlite";
import type { Tx } from "../../kernel/src/store/projection.ts";
import { dueSyncs } from "../../modules/connectors/handlers/cadence.ts";

const OLIVIA = "usr_olivia";
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-cadence-live-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

async function boot(dir: string): Promise<Daemon> {
  let token = "";
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "cadence-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => (h["authorization"] === `Bearer ${token}` ? { space: CORE_SPACE, principal: { kind: "person", id: OLIVIA }, device: "test-device" } : null),
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000, machine: 3_600_000 },
  });
  token = d.token;
  return d;
}

const post = (d: Daemon, cap: string, body: unknown, token: string | null = d.token): Promise<Response> =>
  fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

/** The Space store file the daemon keeps the connectors tables in, opened by a second connection: what a test sees here is what the daemon committed. */
function viaFile(dir: string, readOnly = false): { tx: Tx; close(): void } {
  const db = new DatabaseSync(path.join(dir, "space.db"), { readOnly });
  if (!readOnly) db.exec("PRAGMA busy_timeout = 5000");
  const run = (sql: string, ...a: unknown[]) => { const r = db.prepare(sql).run(...(a as never[])); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; };
  return { tx: { run, get: (sql, ...a) => db.prepare(sql).get(...(a as never[])) as never, all: (sql, ...a) => db.prepare(sql).all(...(a as never[])) as never, exec: (sql) => db.exec(sql) }, close: () => db.close() };
}
const markOf = (dir: string, type: string): number | undefined => {
  const f = viaFile(dir, true);
  try {
    if (!f.tx.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'cn_type_use'")) return undefined;
    return f.tx.get<{ at: number }>("SELECT at FROM cn_type_use WHERE type = ?", type)?.at;
  } finally { f.close(); }
};

test("a read of a synced type through the gateway commits the in-use mark, and the type is then due at 2 minutes, not 15", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    // the first call makes the tables; then the rows are put in through the same file
    const listed = await post(d, "sync_types.list", {});
    assert.equal(listed.status, 200, await listed.clone().text());
    const now = Date.now();
    const seed = viaFile(dir);
    seed.tx.run("INSERT INTO cn_connections (connection_id, connector, title, owner_kind, owner_id, state, created_at) VALUES ('con_live', 'acme', 'Acme', 'space', 'space', 'connected', ?)", now - 30 * 86_400_000);
    for (const t of ["read_t", "unread_t"]) {
      seed.tx.run(
        "INSERT INTO cn_synced_types (sync_type_id, type, connector, connection_id, remote, fields, match, polling, nightly, paused, schema_changes, created_at, updated_at) VALUES (?, ?, 'acme', 'con_live', 'x', '[]', '[]', ?, 0, 0, '[]', ?, ?)",
        `syt_${t}`, t, JSON.stringify({ activeSec: 120, idleSec: 900, dormantSec: 3600 }), now - 30 * 86_400_000, now - 30 * 86_400_000,
      );
    }
    seed.close();
    assert.equal(markOf(dir, "read_t"), undefined, "nobody has looked yet");

    const refused = await post(d, "sync_types.get", { type: "read_t" }, null);
    assert.equal(refused.status, 401, "no token, no read");
    assert.equal(markOf(dir, "read_t"), undefined, "a refused read marks nothing");

    const got = await post(d, "sync_types.get", { type: "read_t" });
    assert.equal(got.status, 200, await got.clone().text());
    const mark = markOf(dir, "read_t");
    assert.ok(mark !== undefined, "the read committed the in-use mark (a read that is rolled back would lose it)");
    assert.equal(markOf(dir, "unread_t"), undefined, "the other type was not read");

    // three minutes after their last run: only the one somebody read is due
    const check = viaFile(dir);
    try {
      check.tx.exec("CREATE TABLE IF NOT EXISTS sy_state (sync_type TEXT PRIMARY KEY, cursor TEXT, last_run_at INTEGER, pending_deletes TEXT)");
      const at = mark! + 60_000;
      for (const t of ["read_t", "unread_t"]) check.tx.run("INSERT OR REPLACE INTO sy_state (sync_type, cursor, last_run_at, pending_deletes) VALUES (?, NULL, ?, NULL)", `syt_${t}`, at - 3 * 60_000);
      assert.deepEqual(dueSyncs({ tx: check.tx, now: () => at }).map((x) => [x.type, x.useState]), [["read_t", "active"]]);
    } finally { check.close(); }
  } finally { await d.stop(); }
});
