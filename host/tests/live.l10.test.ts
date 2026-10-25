// P-L10_LIVE (rulings 27, 31, 32): lane L10 is live. kits is live in host/modules.json, a booted daemon wires its Kit source (setKitsHost) and reports nothing as not set up, and the module answers a read and a write
// through the gateway with a real token; a member without kits.install is refused. The full install, update and rollback path is proven in host/tests/kits.live.test.ts.
// Path mapping: the packet owns __live__/L10; this test sits in host/tests because it boots the daemon.
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

const OWNER_TOKEN = "tok-usr_olivia";
const MEMBER_TOKEN = "tok-usr_noah";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });

const KIT = {
  key: "livekit", title: "Live Kit", version: "1.0.0", channel: "stable", description: "One record type, to prove install on a booted daemon.",
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

/** The real code root, with one more shipped Kit (kits/livekit) that only applies schema.apply, a live module. Every other file is a symlink to the real one. */
function codeRootWithTestKit(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-l10-root-"));
  for (const name of fs.readdirSync(CODE_ROOT)) if (!name.startsWith(".") && name !== "kits") fs.symlinkSync(path.join(CODE_ROOT, name), path.join(root, name));
  fs.mkdirSync(path.join(root, "kits"));
  for (const name of fs.readdirSync(path.join(CODE_ROOT, "kits"))) fs.symlinkSync(path.join(CODE_ROOT, "kits", name), path.join(root, "kits", name));
  fs.mkdirSync(path.join(root, "kits", KIT.key));
  fs.writeFileSync(path.join(root, "kits", KIT.key, "kit.json"), JSON.stringify(KIT));
  return root;
}

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-l10-live-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

function boot(dir: string, codeRoot: string): Promise<Daemon> {
  return startDaemon({
    codeRoot,
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "l10-live", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    session: (h) => {
      const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
      const who = t === OWNER_TOKEN ? "usr_olivia" : t === MEMBER_TOKEN ? "usr_noah" : null;
      return who === null ? null : { space: "spc_core", principal: { kind: "person", id: who }, device: "l10-live" };
    },
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
}

let n = 0;
const post = (d: { url: string }, token: string, cap: string, body: Record<string, unknown> = {}) => {
  const [mod, name] = cap.split(".") as [string, string];
  const prefix = mod === "reports-client" ? "reports" : mod;
  return fetch(`${d.url}/v1/${prefix}/${name}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ idempotencyKey: `l10-live-${++n}`, ...body }),
  });
};
const ok = async (d: { url: string }, token: string, cap: string, body: Record<string, unknown> = {}): Promise<unknown> => {
  const r = await post(d, token, cap, body);
  const text = await r.text();
  assert.equal(r.status, 200, `${cap} answers through the live handler: ${text}`);
  return (JSON.parse(text) as { data: unknown }).data;
};

test("l10 live: kits is live in host/modules.json", () => {
  const file = JSON.parse(fs.readFileSync(new URL("../modules.json", import.meta.url), "utf8")) as { modules: { id: string; owner: string; status: string }[] };
  const mine = file.modules.filter((m) => m.owner === "L10");
  assert.deepEqual(mine.map((m) => m.id), ["kits"]);
  assert.equal(mine[0]!.status, "live");
});

test("l10 live: a booted daemon wires the Kit source, and kits answers reads and writes through the gateway; a member is refused", async () => {
  const dir = seededDir();
  const d = await boot(dir, codeRootWithTestKit());
  try {
    assert.ok((d.seams?.wired ?? []).includes("setKitsHost"), "setKitsHost is wired");
    assert.deepEqual((d.seams?.missing ?? []).filter((m) => m.module === "kits"), [], "kits is not reported as not set up");
    const listed = (await ok(d, OWNER_TOKEN, "kits.list", {})) as { kits: { key: string; kitId: string }[] };
    for (const k of ["default", "livekit"]) assert.ok(listed.kits.some((x) => x.key === k), `${k} is listed`);
    const kit = listed.kits.find((x) => x.key === "livekit")!;
    await ok(d, OWNER_TOKEN, "kits.install_sheet", { kitId: kit.kitId });
    // a member cannot install; the owner can, and the Kit's step lands in the Space
    const refused = await post(d, MEMBER_TOKEN, "kits.install", { kitId: kit.kitId, accepted: true });
    assert.equal(refused.status, 403, "kits.install refuses a member");
    const installed = (await ok(d, OWNER_TOKEN, "kits.install", { kitId: kit.kitId, accepted: true })) as { kit: { installed: boolean } };
    assert.equal(installed.kit.installed, true, "the Kit is installed");
    await ok(d, OWNER_TOKEN, "kits.choose", { kitId: kit.kitId, scope: "space" });
  } finally { await d.stop(); }
});
