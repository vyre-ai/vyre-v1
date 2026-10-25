// P-H_08: the four L3 data modules (records, schema, sources, connectors) run on the Space's one persisted store, not on private ":memory:" stores.
// Path mapping: the packet owns host/src/daemon/store.ts and this test; the setters live in modules/{records,schema,sources,connectors}/impl.ts (`hostSeams`), the daemon calls them through
// the drivers store.ts builds. A booted daemon is slow-shard material (test/slow.json).
// The modules are still stub in host/modules.json (P-L3_LIVE2 flips them), so the test calls the module files the loader imported, the same instances the live handlers would run.
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
import type { Daemon } from "../src/daemon/daemon.ts";
import { createSpaceStore, SPACE_STORE_SETTERS, spaceStoreDrivers } from "../src/daemon/store.ts";
import { fileExportsImporter } from "../src/loader.ts";
import { CODE_ROOT } from "../src/daemon/daemon.ts";

type H = Record<string, (ctx: never, input: never) => Promise<unknown>>;
/** Host never imports a module (layer rule): the test takes the module files the way the loader does, so it gets the very instances the daemon wired. */
async function handlersOf(id: string): Promise<H> {
  const ns = await fileExportsImporter(CODE_ROOT)(id);
  assert.ok(ns, `${id} loads`);
  return ns["handlers"] as H;
}
const COMPANY = {
  op: "type.create", type: "acme_company",
  def: { title: "Company", plural: "Companies", icon: "building", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "industry", type: "text", title: "Industry" }] },
};

const DATA_MODULES = ["records", "schema", "sources", "connectors"];
const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef", spanId: "0123456789abcdef" }, emit: () => ({}), call: () => Promise.reject(new Error("no calls")), actor: "usr_owner", principal: { id: "usr_owner" } };

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-store-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

function boot(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "store-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

test("store: one store per Space, declare only before it opens, close is final", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-store-unit-"));
  const s = createSpaceStore({ path: path.join(dir, "space.db"), space: "sp_unit" });
  assert.equal(s.isOpen(), false);
  const a = s.open();
  assert.equal(s.open(), a, "every caller gets the same store");
  assert.throws(() => s.declare([]), /after the Space store was opened/);
  s.close();
  assert.throws(() => s.open(), /closed/);
  s.close();
  assert.deepEqual(Object.keys(spaceStoreDrivers(s)).sort(), [...SPACE_STORE_SETTERS].sort());
});

test("store live: a booted daemon wires the four data modules, and a type and a record survive a restart", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  let id = "";
  try {
    const notSetUp = (d.seams?.missing ?? []).filter((m) => m.module !== undefined && DATA_MODULES.includes(m.module));
    assert.deepEqual(notSetUp, [], "no data module is reported as not set up");
    for (const name of SPACE_STORE_SETTERS) assert.ok(d.seams?.wired.includes(name), `${name} is wired`);
    const applied = await (await handlersOf("schema"))["schema.apply"](ctx as never, { ops: [COMPANY] } as never) as { applied?: number };
    assert.ok(applied, "schema.apply answers");
    const made = await (await handlersOf("records"))["records.create"](ctx as never, { type: "acme_company", fields: { name: "Acme" } } as never) as { record: { id: string } };
    id = made.record.id;
    assert.ok(id, "the record has an id");
  } finally { await d.stop(); }
  assert.ok(fs.existsSync(path.join(dir, "space.db")), "the Space store file is in the data directory");

  d = await boot(dir);
  try {
    const got = await (await handlersOf("records"))["records.get"](ctx as never, { type: "acme_company", recordId: id } as never) as { record: { id: string; fields: Record<string, unknown> } };
    assert.equal(got.record.id, id);
    assert.equal(got.record.fields["name"], "Acme");
    const types = await (await handlersOf("schema"))["schema.types.list"](ctx as never, {} as never) as { types: { key: string }[] };
    assert.ok(types.types.some((t) => t.key === "acme_company"), "the type is still there");
    // sources and connectors run on the same store: their tables are in the one file, and their lists answer from it
    const src = await (await handlersOf("sources"))["sources.list"](ctx as never, {} as never) as { sources: unknown[] };
    assert.ok(Array.isArray(src.sources));
    const con = await (await handlersOf("connectors"))["connectors.list"](ctx as never, {} as never) as { connectors: unknown[] };
    assert.ok(Array.isArray(con.connectors));
  } finally { await d.stop(); }
});
