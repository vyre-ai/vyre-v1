// P-H_13 (rulings 31 and 32): a booted daemon gives the kits module its Kit source through the generic host seam, with kits live. Nothing is faked inside the daemon:
// the loader collects `hostSeams.setKitsHost` from modules/kits/impl.ts, the daemon wires it with host/src/seams/kits.ts, and a person installs a Kit over HTTP, whose step
// (schema.apply, a live module) lands in the Space, and reads it back. host/modules.json still says kits is a stub (the live flip is P-CI_02, ruling 25), so this test boots
// from a copy of the code root whose modules.json has kits live; every other file is a symlink to the real one.
// Kits are registered as access resources by the host (daemon.ts, setKitsHost), not by this test.
// Path mapping: the packet owns modules/kits/impl.ts and this test; the driver sits in host/src/seams/kits.ts and is registered in host/src/daemon/daemon.ts.
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
import { createKitsHost } from "../src/seams/kits.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

const KIT = {
  key: "livekit", title: "Live Kit", version: "1.0.0", channel: "stable", description: "One record type, to prove install and apply on a booted daemon.",
  items: [{
    key: "rt.live_note", content: "structure", type: "record_type", title: "Live note", recordType: "live_note",
    apply: {
      cap: "schema.apply",
      input: {
        ops: [{ op: "type.create", type: "live_note", def: { title: "Live note", plural: "Live notes", icon: "note", group: "Notes", label: "internal", titleField: "title", fields: [{ key: "title", type: "text", title: "Title", required: true }] } }],
        idempotencyKey: "kit.livekit.rt.live_note", reason: "Kit install",
      },
    },
  }],
};

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-kits-live-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

/** A code root that is the real one, except host/modules.json lists kits as live and kits/ holds the shipped Kits plus the test Kit. */
function codeRootWithKitsLive(): string {
  const root = tmp("vyre-kits-root-");
  for (const name of fs.readdirSync(CODE_ROOT)) {
    if (name.startsWith(".") || name === "host" || name === "kits") continue;
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
  fs.mkdirSync(path.join(root, "kits"));
  for (const name of fs.readdirSync(path.join(CODE_ROOT, "kits"))) fs.symlinkSync(path.join(CODE_ROOT, "kits", name), path.join(root, "kits", name));
  fs.mkdirSync(path.join(root, "kits", KIT.key));
  fs.writeFileSync(path.join(root, "kits", KIT.key, "kit.json"), JSON.stringify(KIT));
  return root;
}

async function boot(dir: string, codeRoot: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    codeRoot,
    platform: fakePlatform({
      os: "linux", hostname: "kits-live", free: 80e9,
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
  const r = await fetch(`${d.url}/v1/${cap.replace(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}

test("kits seam: createKitsHost reads the shipped Kits from kits/<key>/kit.json, finds a version, skips what is not a Kit, and has no working copy yet", async () => {
  const root = tmp("vyre-kits-seam-");
  fs.mkdirSync(path.join(root, "kits", "a"), { recursive: true });
  fs.mkdirSync(path.join(root, "kits", "empty"), { recursive: true });
  fs.mkdirSync(path.join(root, "kits", "broken"), { recursive: true });
  fs.mkdirSync(path.join(root, "kits", "Bad Name"), { recursive: true });
  fs.writeFileSync(path.join(root, "kits", "a", "kit.json"), JSON.stringify({ key: "a", version: "2.0.0" }));
  fs.writeFileSync(path.join(root, "kits", "broken", "kit.json"), "{not json");
  const { source } = createKitsHost({ root });
  assert.deepEqual(await source.catalog(), [{ key: "a", version: "2.0.0" }]);
  assert.deepEqual(await source.read("a", "2.0.0"), { key: "a", version: "2.0.0" });
  assert.equal(await source.read("a", "1.0.0"), null);
  assert.equal(await source.read("nope", "2.0.0"), null);
  assert.equal(await source.working("a"), null);
  assert.deepEqual(await createKitsHost({ root: path.join(root, "nowhere") }).source.catalog(), []);
});

test("kits live: a booted daemon wires setKitsHost, reports nothing as not set up, lists the shipped Kits, installs one over HTTP, applies its step and reads it back", async () => {
  const dir = seededDir();
  const root = codeRootWithKitsLive();
  const d = await boot(dir, root);
  try {
    assert.ok(d.seams?.wired.includes("setKitsHost"), "setKitsHost is wired by the generic loader and daemon");
    assert.deepEqual(d.seams?.missing, [], "no module is left without its driver");
    const row = (d.db!.all("SELECT detail FROM health_probe WHERE name = ?", "module_drivers")[0] ?? null) as { detail: string } | null;
    assert.equal(row, null, "health lists nothing as not set up");

    const listed = await call(d, "kits.list", {});
    assert.equal(listed.status, 200, JSON.stringify(listed.data));
    const keys = (listed.data.kits as { key: string }[]).map((k) => k.key);
    for (const k of ["default", "harbor-studio", "livekit"]) assert.ok(keys.includes(k), `${k} is shipped on this server`);
    const kit = (listed.data.kits as { key: string; kitId: string; installed: boolean }[]).find((k) => k.key === "livekit")!;
    assert.equal(kit.installed, false);

    const sheet = await call(d, "kits.install_sheet", { kitId: kit.kitId });
    assert.equal(sheet.status, 200, JSON.stringify(sheet.data));
    assert.deepEqual(sheet.data.sheet.tools, ["schema.apply"]);
    assert.deepEqual(sheet.data.sheet.recordTypes, ["live_note"]);

    const refused = await call(d, "kits.install", { kitId: kit.kitId });
    assert.notEqual(refused.status, 200, "an install is refused until the sheet is accepted");

    const done = await call(d, "kits.install", { kitId: kit.kitId, accepted: true });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    assert.equal(done.data.kit.installed, true);
    assert.equal(done.data.kit.version, "1.0.0");

    const read = await call(d, "kits.get", { kitId: kit.kitId });
    assert.equal(read.data.kit.installed, true, "kits.get reads the install back");
    const applied = d.db!.all("SELECT item_key FROM kits_applied WHERE kit_id = ?", kit.kitId) as { item_key: string }[];
    assert.deepEqual(applied.map((a) => a.item_key), ["rt.live_note"], "the ledger records the applied item");
    const types = await call(d, "schema.types.list", {});
    assert.equal(types.status, 200, JSON.stringify(types.data));
    assert.ok(JSON.stringify(types.data).includes("live_note"), "the Kit's step created its record type in the Space");

    const events = await d.log!.read({ type: "kit.installed" });
    assert.equal(events.length, 1, "kit.installed was emitted once");
  } finally { await d.stop(); }
});

test("kits live: each Kit becomes one resource in the access projection, once, and a reboot neither repeats it nor loses it", async () => {
  const dir = seededDir();
  const root = codeRootWithKitsLive();
  const kitResources = async (d: Daemon): Promise<string[]> =>
    (await d.log!.read({ type: "resource.created" })).map((e) => (e.payload instanceof Uint8Array ? JSON.parse(new TextDecoder().decode(e.payload)) : e.payload) as { id: string; type: string }).filter((p) => p.type === "kit").map((p) => p.id).sort();
  let first: string[] = [];
  const a = await boot(dir, root);
  try {
    const listed = await call(a, "kits.list", {});
    assert.equal(listed.status, 200, JSON.stringify(listed.data));
    first = await kitResources(a);
    assert.equal(first.length, listed.data.total, "one resource per Kit");
    assert.deepEqual([...new Set(first)], first, "no Kit twice");
    await call(a, "kits.list", {});
    assert.deepEqual(await kitResources(a), first, "listing again adds none");
  } finally { await a.stop(); }
  const b = await boot(dir, root);
  try {
    const listed = await call(b, "kits.list", {});
    assert.deepEqual(await kitResources(b), first, "a reboot adds none");
    const kit = (listed.data.kits as { kitId: string }[])[0]!;
    const got = await call(b, "kits.get", { kitId: kit.kitId });
    assert.equal(got.status, 200, "and the Kit is still visible to authorize after the reboot");
  } finally { await b.stop(); }
});
