// P-L10_09b: the two shipped Kits, Default and Harbor Studio, installed BY NAME on a booted daemon through modules/kits (kits.list, then kits.install over HTTP as the Space owner), and what
// each leaves in the Space is read back: the record type it creates (note_board, commission) and the agents it creates. This is the server-side half of the installer's "first boot, then a Kit"
// path; the installer itself is proven in the installer-docker job. The test lives in host/tests because kits/ may not import host/ (boundaries); path mapping from kits/default/tests/runner.heavy.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-kits-shipped-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

/** A code root that is the real one, except host/modules.json lists kits as live (the live flip is P-CI_02); kits/ is the real shipped directory. */
function codeRootWithKitsLive(): string {
  const root = tmp("vyre-kits-shipped-root-");
  for (const name of fs.readdirSync(CODE_ROOT)) {
    if (name.startsWith(".") || name === "host") continue;
    fs.symlinkSync(path.join(CODE_ROOT, name), path.join(root, name));
  }
  fs.mkdirSync(path.join(root, "host"));
  for (const name of fs.readdirSync(path.join(CODE_ROOT, "host"))) {
    if (name !== "modules.json") fs.symlinkSync(path.join(CODE_ROOT, "host", name), path.join(root, "host", name));
  }
  const list = JSON.parse(fs.readFileSync(path.join(CODE_ROOT, "host/modules.json"), "utf8")) as { modules: { id: string; status: string }[] };
  const kits = list.modules.find((m) => m.id === "kits");
  assert.ok(kits, "kits is in host/modules.json");
  kits.status = "live";
  fs.writeFileSync(path.join(root, "host/modules.json"), JSON.stringify(list));
  return root;
}

async function boot(dir: string, codeRoot: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot,
    platform: fakePlatform({
      os: "linux", hostname: "kits-shipped", free: 80e9,
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

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

const KITS: { key: string; types: string[]; agents: string[] }[] = [
  { key: "default", types: ["note_board"], agents: ["Assistant"] },
  { key: "harbor-studio", types: ["commission"], agents: ["Producer", "Art Director"] },
];

test("the shipped Default and Harbor Studio Kits install by name on a booted daemon, and their record types and agents are in the Space", async () => {
  const dir = seededDir();
  const d = await boot(dir, codeRootWithKitsLive());
  try {
    const listed = await call(d, "kits.list", {});
    assert.equal(listed.status, 200, JSON.stringify(listed.data));
    const byKey = new Map((listed.data.kits as { key: string; kitId: string; installed: boolean }[]).map((k) => [k.key, k]));
    for (const k of KITS) {
      const kit = byKey.get(k.key);
      assert.ok(kit, `${k.key} is shipped`);
      assert.equal(kit.installed, false, `${k.key} starts uninstalled`);
      const done = await call(d, "kits.install", { kitId: kit.kitId, accepted: true });
      assert.equal(done.status, 200, `installing ${k.key}: ${JSON.stringify(done.data)}`);
      assert.equal(done.data.kit.installed, true, `${k.key} reads installed`);
    }
    const types = JSON.stringify((await call(d, "schema.types.list", {})).data);
    for (const k of KITS) for (const t of k.types) assert.ok(types.includes(`"${t}"`), `${k.key} created the record type ${t}`);
    const agents = await call(d, "agents.list", {});
    assert.equal(agents.status, 200, JSON.stringify(agents.data));
    const names = JSON.stringify(agents.data);
    for (const k of KITS) for (const a of k.agents) assert.ok(names.includes(`"${a}"`), `${k.key} created the agent ${a}`);
    for (const k of KITS) {
      const got = await call(d, "kits.get", { kitId: byKey.get(k.key)!.kitId });
      assert.equal(got.data.kit.installed, true, `${k.key} still reads installed`);
    }
  } finally { await d.stop(); }
});
