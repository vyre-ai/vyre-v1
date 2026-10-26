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
import { dueSyncs, liveConnectors, usedAtOf } from "../../modules/connectors/impl.ts";
import { ensureSyncTables } from "../../modules/connectors/handlers/sync.ts";

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

test("a read of a synced type through the gateway leaves the in-use mark, and the type is then due at 2 minutes, not 15", async () => {
  const d = await boot(seededDir());
  try {
    const h = liveConnectors();
    ensureSyncTables(h.tx);
    const now = Date.now();
    h.tx.run("INSERT INTO cn_connections (connection_id, connector, title, owner_kind, owner_id, state, created_at) VALUES ('con_live', 'acme', 'Acme', 'space', 'space', 'connected', ?)", now - 30 * 86_400_000);
    for (const t of ["read_t", "unread_t"]) {
      h.tx.run(
        "INSERT INTO cn_synced_types (sync_type_id, type, connector, connection_id, remote, fields, match, polling, nightly, paused, schema_changes, created_at, updated_at) VALUES (?, ?, 'acme', 'con_live', 'x', '[]', '[]', ?, 0, 0, '[]', ?, ?)",
        `syt_${t}`, t, JSON.stringify({ activeSec: 120, idleSec: 900, dormantSec: 3600 }), now - 30 * 86_400_000, now - 30 * 86_400_000,
      );
    }
    assert.equal(usedAtOf(h.tx, "read_t"), undefined, "nobody has looked yet");

    const refused = await post(d, "sync_types.get", { type: "read_t" }, null);
    assert.equal(refused.status, 401, "no token, no read");
    assert.equal(usedAtOf(h.tx, "read_t"), undefined, "a refused read marks nothing");

    const got = await post(d, "sync_types.get", { type: "read_t" });
    assert.equal(got.status, 200, await got.clone().text());
    const mark = usedAtOf(h.tx, "read_t");
    assert.ok(mark !== undefined, "the read left the in-use mark (a read that is rolled back would lose it)");
    assert.equal(usedAtOf(h.tx, "unread_t"), undefined, "the other type was not read");

    // three minutes after their last run: only the one somebody read is due
    h.tx.exec("CREATE TABLE IF NOT EXISTS sy_state (sync_type TEXT PRIMARY KEY, cursor TEXT, last_run_at INTEGER, pending_deletes TEXT)");
    const at = mark! + 60_000;
    for (const t of ["read_t", "unread_t"]) h.tx.run("INSERT OR REPLACE INTO sy_state (sync_type, cursor, last_run_at, pending_deletes) VALUES (?, NULL, ?, NULL)", `syt_${t}`, at - 3 * 60_000);
    assert.deepEqual(dueSyncs({ tx: h.tx, now: () => at }).map((x) => [x.type, x.useState]), [["read_t", "active"]]);
  } finally { await d.stop(); }
});
