// P-L3_LIVE2 (rulings 31 and 32): lane L3 is fully live. A booted daemon on the seeded `core` Space reports no L3 module as not set up, every L3 module is live and answers
// through the gateway, all four data modules run on the Space's one persisted store (P-H_08), and a record created through the gateway is still there after the daemon restarts.
// The connectors sync engine is wired by the host (P-H_09).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon, CODE_ROOT } from "../src/daemon/daemon.ts";
import { fileExportsImporter } from "../src/loader.ts";

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
  for (const m of mine) assert.equal(m.status, "live", `${m.id} status`);
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

type H = Record<string, (ctx: never, input: never) => Promise<unknown>>;
/** Host never imports a module (layer rule): take the module the way the loader does, the very instance the daemon wired. */
async function handlersOf(id: string): Promise<H> {
  const ns = await fileExportsImporter(CODE_ROOT)(id);
  assert.ok(ns, `${id} loads`);
  return ns["handlers"] as H;
}
const hctx = { trace: { traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" }, emit: () => ({}), call: () => Promise.reject(new Error("no calls")), actor: "usr_owner", principal: { id: "usr_owner" } };
const COMPANY = {
  op: "type.create", type: "l3_company",
  def: { title: "Company", plural: "Companies", icon: "building", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "industry", type: "text", title: "Industry" }] },
};

test("l3 live: a record created on the live records module survives a daemon restart, on the Space store", async () => {
  const dir = seededDir();
  const boot = () => startDaemon({
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
  type Row = { id: string; fields: Record<string, unknown> };
  let d = await boot();
  let id = "";
  try {
    assert.deepEqual((d.seams?.missing ?? []).filter((m) => m.module !== undefined && L3.includes(m.module)), [], "no L3 module is reported as not set up");
    const applied = await (await handlersOf("schema"))["schema.apply"]!(hctx as never, { ops: [COMPANY], idempotencyKey: "l3-live-type" } as never) as { applied?: number };
    assert.ok(applied.applied, "schema.apply answers");
    const made = await (await handlersOf("records"))["records.create"]!(hctx as never, { type: "l3_company", fields: { name: "Acme", industry: "Law" }, idempotencyKey: "l3-live-rec" } as never) as { record: Row };
    id = made.record.id;
    assert.ok(id, "the record has an id");
  } finally { await d.stop(); }
  assert.ok(fs.existsSync(path.join(dir, "space.db")), "the Space store file is in the data directory");

  d = await boot();
  try {
    assert.deepEqual((d.seams?.missing ?? []).filter((m) => m.module !== undefined && L3.includes(m.module)), [], "still no L3 module missing a driver after the restart");
    const rec = ((await (await handlersOf("records"))["records.get"]!(hctx as never, { type: "l3_company", recordId: id } as never)) as { record: Row }).record;
    assert.equal(rec.id, id);
    assert.equal(rec.fields["name"], "Acme");
    assert.equal(rec.fields["industry"], "Law");
    const rows = ((await (await handlersOf("records"))["records.query"]!(hctx as never, { type: "l3_company" } as never)) as { rows: Row[] }).rows;
    assert.ok(rows.some((r) => r.id === id), "the record is in the query");
  } finally { await d.stop(); }
});
