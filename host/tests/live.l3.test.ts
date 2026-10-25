// P-L3_LIVE (rulings 31 and 32): a booted daemon on the seeded `core` Space reports no L3 module as not set up, the L3 modules that are live answer through the gateway, and the two
// gaps that keep L3 from being all live are named here so a later packet removes them on purpose:
//   records     is live since P-L3_REC2: all 29 capabilities have a handler, and the site table and value proposal consumers are registered.
//   connectors  is live, but its sync engine is not wired (P-H_09): preview, confirm_deletes, resolve_conflict, replay_conflict, undo_push and connectors.push refuse until then.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";

const L3 = ["connectors", "import", "projects", "records", "schema", "sources"];
const LIVE = ["connectors", "import", "projects", "records", "schema", "sources"];

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-l3-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

test("l3 live: host/modules.json has all six L3 modules live", () => {
  const file = JSON.parse(fs.readFileSync(new URL("../modules.json", import.meta.url), "utf8")) as { modules: { id: string; owner: string; status: string }[] };
  const mine = file.modules.filter((m) => m.owner === "L3");
  assert.deepEqual(mine.map((m) => m.id).sort(), [...L3].sort());
  for (const m of mine) assert.equal(m.status, LIVE.includes(m.id) ? "live" : "stub", `${m.id} status`);
});

test("l3 live: a booted daemon has a driver for every L3 module, and the live ones answer through the gateway", async () => {
  const dir = seededDir();
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "l3-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  try {
    const notSetUp = (d.seams?.missing ?? []).filter((m) => m.module !== undefined && L3.includes(m.module));
    assert.deepEqual(notSetUp, [], "no L3 module is reported as not set up");
    const row = (d.db!.all("SELECT detail FROM health_probe WHERE name = ?", "module_drivers")[0] ?? { detail: "" }) as { detail: string };
    for (const id of L3) assert.ok(!new RegExp(`\\b${id}\\b \\(`).test(row.detail), `health does not list ${id} as not set up`);
    const consumers = d.hooks!.consumers.map((c) => c.name);
    for (const name of ["records.site_tables", "records.value_source"]) assert.ok(consumers.includes(name), `${name} is registered`);
    const wired = d.seams?.wired ?? [];
    for (const setter of ["setSourcesSecretResolver", "setImportHost"]) assert.ok(wired.includes(setter), `${setter} is wired`);

    const call = (p: string, body: unknown) => fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(body) });
    for (const [p, what] of [["/v1/sources/kinds", "sources"], ["/v1/projects/templates/list", "projects"], ["/v1/schema/types/list", "schema"]] as const) {
      const r = await call(p, {});
      assert.equal(r.status, 200, `${what}: ${p} answers through the live handler`);
      assert.ok(((await r.json()) as { data?: unknown }).data !== undefined, `${what}: a data body`);
    }
  } finally { await d.stop(); }
});
